import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as crypto from 'node:crypto';
import type { EnlaceFotoCdaCreado, EnlaceFotoCdaPublico, FotoCdaPorCedula } from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { StorageService } from '../storage/storage.service';
import { limpiarJpeg } from './jpeg';
import { nombreCortoDeApellidosNombres } from '../evatics/nombre-evatics';

export const VIGENCIA_ENLACE_MS = 48 * 60 * 60 * 1000;
/** Tras subir, la persona puede cambiar su foto desde el mismo celular durante este tiempo. */
export const VIGENCIA_CAMBIO_MS = 30 * 60 * 1000;
export const MAX_INTENTOS_FOTO = 5;
/** La página la reduce a ~200 KB; 1 MB deja margen sin aceptar fotos crudas de 8 MB. */
export const MAX_FOTO_BYTES = 1024 * 1024;
const CATEGORIA = 'fotos-operadores-cda';
const ENLACE_INACTIVO = 'Este enlace ya no está activo. Pida uno nuevo a la Delegación.';
export const CEDULA_NO_REGISTRADA_FOTO = 'Cédula no registrada en el personal CDA ni CPE';
export const FOTO_CAMBIO_SIMULTANEO = 'Su foto se actualizó mientras subía la nueva. Recargue la página e intente de nuevo.';
export const SIN_FOTO_PENDIENTE = 'No hay una foto nueva por revisar';
const PENDIENTE_CAMBIO = 'La persona subió otra foto mientras la revisaba. Ábrala de nuevo.';
const FOTO_INVALIDA = 'La foto debe ser una imagen JPG válida de hasta 1 MB. Intente de nuevo.';

/** En la BD solo se guarda el hash: quien lea la tabla no puede usar los enlaces. */
export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** 1050123412 → 1050xxxx12 */
export function enmascararCedula(cedula: string): string {
  return cedula.length >= 6 ? `${cedula.slice(0, 4)}xxxx${cedula.slice(-2)}` : 'xxxx';
}

/** 0968333444 → 0968 xxx 444 */
export function enmascararTelefono(telefono: string | null): string | null {
  const digitos = (telefono ?? '').replace(/\D/g, '');
  if (digitos.length < 7) return null;
  return `${digitos.slice(0, 4)} xxx ${digitos.slice(-3)}`;
}

interface EnlaceGuardado {
  usadoEn: Date | null;
  revocadoEn: Date | null;
  expiraEn: Date;
  intentos: number;
}

function estaActivo(e: EnlaceGuardado, ahora: Date): boolean {
  return !e.usadoEn && !e.revocadoEn && e.expiraEn > ahora && e.intentos < MAX_INTENTOS_FOTO;
}

/**
 * Enlace personal de un solo uso para que el operador suba su foto desde el
 * celular, sin cuenta. Solo vale el último enlace generado para cada operador.
 */
@Injectable()
export class FotoCdaService {
  private readonly log = new Logger(FotoCdaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async crearEnlace(operadorId: string, usuarioId: string): Promise<EnlaceFotoCdaCreado> {
    const operador = await this.prisma.operadorCda.findUnique({ where: { id: operadorId } });
    if (!operador?.activo) throw new NotFoundException('Operador no encontrado');

    const token = crypto.randomBytes(32).toString('base64url');
    const ahora = new Date();
    const expiraEn = new Date(ahora.getTime() + VIGENCIA_ENLACE_MS);
    await this.prisma.$transaction([
      this.prisma.enlaceFotoCda.updateMany({
        where: { operadorId, usadoEn: null, revocadoEn: null },
        data: { revocadoEn: ahora },
      }),
      this.prisma.enlaceFotoCda.create({
        data: { operadorId, tokenHash: hashToken(token), expiraEn, creadoPorId: usuarioId },
      }),
    ]);
    return { token, expiraEn: expiraEn.toISOString() };
  }

  /** Lo que ve el operador al abrir el enlace. Cualquier enlace no usable es INACTIVO. */
  async consultar(token: string): Promise<EnlaceFotoCdaPublico> {
    const enlace = await this.enlaceActivo(token);
    if (!enlace) return { estado: 'INACTIVO' };
    const { operador } = enlace;
    return {
      estado: 'ACTIVO',
      apellidosNombres: operador.apellidosNombres,
      cedula: enmascararCedula(operador.cedula),
      telefono: enmascararTelefono(operador.telefono),
      cargo: operador.cargo,
      expiraEn: enlace.expiraEn.toISOString(),
    };
  }

  /**
   * Guarda la foto (sin metadatos y cifrada) y gasta el enlace. Un archivo
   * inválido suma un intento; al quinto el enlace se bloquea.
   */
  async subir(
    token: string,
    file: Express.Multer.File | undefined,
    version: string,
  ): Promise<{ operadorId: string; cambio: EnlaceFotoCdaCreado }> {
    const enlace = await this.enlaceActivo(token);
    if (!enlace) throw new GoneException(ENLACE_INACTIVO);

    const jpeg = file?.buffer && file.size <= MAX_FOTO_BYTES ? limpiarJpeg(file.buffer) : null;
    if (!jpeg) {
      await this.prisma.enlaceFotoCda.updateMany({
        where: { id: enlace.id, intentos: { lt: MAX_INTENTOS_FOTO } },
        data: { intentos: { increment: 1 } },
      });
      if (enlace.intentos + 1 >= MAX_INTENTOS_FOTO) await this.registrarBloqueo(enlace.operadorId);
      throw new BadRequestException(FOTO_INVALIDA);
    }

    const fotoKey = await this.storage.saveEncrypted({
      categoria: CATEGORIA,
      buffer: jpeg.limpio,
      maxBytes: MAX_FOTO_BYTES,
    });
    const ahora = new Date();
    let anterior: { fotoKey: string | null; fotoPendienteKey: string | null };
    let cambio: EnlaceFotoCdaCreado;
    try {
      [anterior, cambio] = await this.prisma.$transaction(async (tx) => {
        // Condicionado: si dos envíos llegan a la vez, solo uno gasta el enlace.
        const gastado = await tx.enlaceFotoCda.updateMany({
          where: {
            id: enlace.id,
            usadoEn: null,
            revocadoEn: null,
            expiraEn: { gt: ahora },
            intentos: { lt: MAX_INTENTOS_FOTO },
          },
          data: { usadoEn: ahora, consentidoEn: ahora, consentimientoVersion: version },
        });
        if (gastado.count === 0) throw new GoneException(ENLACE_INACTIVO);
        const previa = await tx.operadorCda.findUniqueOrThrow({
          where: { id: enlace.operadorId },
          select: { fotoKey: true, fotoPendienteKey: true },
        });
        // Una foto pendiente de revisión queda superada por esta: se descarta. Condicionado a
        // la pendiente leída: si llegó otra a la vez, su archivo no debe quedar huérfano.
        const guardada = await tx.operadorCda.updateMany({
          where: { id: enlace.operadorId, fotoPendienteKey: previa.fotoPendienteKey },
          data: { fotoKey, fotoSubidaEn: ahora, fotoPendienteKey: null, fotoPendienteEn: null },
        });
        if (guardada.count === 0) throw new ConflictException(FOTO_CAMBIO_SIMULTANEO);
        return [previa, await this.crearEnlaceCambio(tx, enlace.operadorId, ahora)] as const;
      });
    } catch (e) {
      await this.borrarArchivo(fotoKey);
      throw e;
    }
    for (const key of [anterior.fotoKey, anterior.fotoPendienteKey]) if (key) await this.borrarArchivo(key);
    return { operadorId: enlace.operadorId, cambio };
  }

  /**
   * Enlace de un uso para cambiar la foto recién subida (30 min). Solo lo
   * recibe el celular que subió la foto; nunca se muestra la foto a quien
   * solo escribe una cédula.
   */
  private async crearEnlaceCambio(
    tx: Pick<PrismaService, 'enlaceFotoCda'>,
    operadorId: string,
    ahora: Date,
  ): Promise<EnlaceFotoCdaCreado> {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiraEn = new Date(ahora.getTime() + VIGENCIA_CAMBIO_MS);
    await tx.enlaceFotoCda.create({ data: { operadorId, tokenHash: hashToken(token), expiraEn } });
    return { token, expiraEn: expiraEn.toISOString() };
  }

  // ---------- Enlace único: la persona escribe su cédula ----------

  /** Solo el nombre corto y la cédula enmascarada (nunca la foto): cualquiera puede escribir una cédula ajena. */
  async consultarPorCedula(cedula: string): Promise<FotoCdaPorCedula> {
    const operador = await this.operadorActivo(cedula);
    return {
      nombreCorto: nombreCortoDeApellidosNombres(operador.apellidosNombres),
      cedula: enmascararCedula(operador.cedula),
      cargo: operador.cargo,
      tieneFoto: !!operador.fotoKey,
    };
  }

  /**
   * La primera foto se guarda directo (y devuelve el enlace de cambio de 30
   * min). Si ya tiene una, la nueva queda PENDIENTE: la credencial sigue con
   * la actual hasta que la Delegación la apruebe, así nadie cambia la foto de
   * otro con solo saber su cédula. Una nueva pendiente reemplaza a la anterior.
   * El consentimiento queda en enlaces_foto_cda como un enlace ya usado.
   */
  async subirPorCedula(
    cedula: string,
    file: Express.Multer.File | undefined,
    version: string,
  ): Promise<{ operadorId: string; cambio: EnlaceFotoCdaCreado | null; pendiente: boolean }> {
    const operador = await this.operadorActivo(cedula);
    const pendiente = !!operador.fotoKey;

    const jpeg = file?.buffer && file.size <= MAX_FOTO_BYTES ? limpiarJpeg(file.buffer) : null;
    if (!jpeg) throw new BadRequestException(FOTO_INVALIDA);

    const fotoKey = await this.storage.saveEncrypted({
      categoria: CATEGORIA,
      buffer: jpeg.limpio,
      maxBytes: MAX_FOTO_BYTES,
    });
    const ahora = new Date();
    let resultado: { cambio: EnlaceFotoCdaCreado | null; pendienteAnterior: string | null };
    try {
      resultado = await this.prisma.$transaction(async (tx) => {
        let pendienteAnterior: string | null = null;
        if (pendiente) {
          const actual = await tx.operadorCda.findUniqueOrThrow({
            where: { id: operador.id },
            select: { fotoPendienteKey: true },
          });
          pendienteAnterior = actual.fotoPendienteKey;
          // Condicionado: si otra subida o una revisión llegó a la vez, se pide repetir.
          const guardada = await tx.operadorCda.updateMany({
            where: { id: operador.id, activo: true, fotoKey: { not: null }, fotoPendienteKey: pendienteAnterior },
            data: { fotoPendienteKey: fotoKey, fotoPendienteEn: ahora },
          });
          if (guardada.count === 0) throw new ConflictException(FOTO_CAMBIO_SIMULTANEO);
        } else {
          // Condicionado: si dos envíos llegan a la vez, o justo se ocultó, solo vale uno.
          const guardada = await tx.operadorCda.updateMany({
            where: { id: operador.id, activo: true, fotoKey: null },
            data: { fotoKey, fotoSubidaEn: ahora },
          });
          if (guardada.count === 0) throw new ConflictException(FOTO_CAMBIO_SIMULTANEO);
        }
        await tx.enlaceFotoCda.create({
          data: {
            operadorId: operador.id,
            tokenHash: hashToken(crypto.randomBytes(32).toString('base64url')),
            expiraEn: ahora,
            usadoEn: ahora,
            consentidoEn: ahora,
            consentimientoVersion: version,
          },
        });
        const cambio = pendiente ? null : await this.crearEnlaceCambio(tx, operador.id, ahora);
        return { cambio, pendienteAnterior };
      });
    } catch (e) {
      await this.borrarArchivo(fotoKey);
      throw e;
    }
    if (resultado.pendienteAnterior) await this.borrarArchivo(resultado.pendienteAnterior);
    return { operadorId: operador.id, cambio: resultado.cambio, pendiente };
  }

  // ---------- Revisión de la foto pendiente (Delegación) ----------

  async fotoPendiente(operadorId: string): Promise<Buffer> {
    const operador = await this.prisma.operadorCda.findUnique({
      where: { id: operadorId },
      select: { fotoPendienteKey: true },
    });
    if (!operador?.fotoPendienteKey) throw new NotFoundException(SIN_FOTO_PENDIENTE);
    return this.storage.readDecrypted(operador.fotoPendienteKey);
  }

  /** La foto nueva pasa a la credencial y se borra la anterior. */
  async aprobarFotoPendiente(operadorId: string): Promise<{ id: string }> {
    const operador = await this.prisma.operadorCda.findUnique({
      where: { id: operadorId },
      select: { fotoKey: true, fotoPendienteKey: true },
    });
    const nueva = operador?.fotoPendienteKey;
    if (!nueva) throw new NotFoundException(SIN_FOTO_PENDIENTE);
    // Condicionado: si la persona subió otra mientras se revisaba, no se aprueba la que no se vio.
    const r = await this.prisma.operadorCda.updateMany({
      where: { id: operadorId, fotoKey: operador.fotoKey, fotoPendienteKey: nueva },
      data: { fotoKey: nueva, fotoSubidaEn: new Date(), fotoPendienteKey: null, fotoPendienteEn: null },
    });
    if (r.count === 0) throw new ConflictException(PENDIENTE_CAMBIO);
    if (operador.fotoKey) await this.borrarArchivo(operador.fotoKey);
    return { id: operadorId };
  }

  /** Se descarta la foto nueva; la credencial sigue con la actual. */
  async rechazarFotoPendiente(operadorId: string): Promise<{ id: string }> {
    const operador = await this.prisma.operadorCda.findUnique({
      where: { id: operadorId },
      select: { fotoPendienteKey: true },
    });
    const nueva = operador?.fotoPendienteKey;
    if (!nueva) throw new NotFoundException(SIN_FOTO_PENDIENTE);
    const r = await this.prisma.operadorCda.updateMany({
      where: { id: operadorId, fotoPendienteKey: nueva },
      data: { fotoPendienteKey: null, fotoPendienteEn: null },
    });
    if (r.count === 0) throw new ConflictException(PENDIENTE_CAMBIO);
    await this.borrarArchivo(nueva);
    return { id: operadorId };
  }

  private async operadorActivo(cedula: string) {
    const operador = await this.prisma.operadorCda.findUnique({
      where: { cedula },
      select: { id: true, cedula: true, apellidosNombres: true, cargo: true, fotoKey: true, activo: true },
    });
    if (!operador?.activo) throw new NotFoundException(CEDULA_NO_REGISTRADA_FOTO);
    return operador;
  }

  /**
   * Ids de quienes tienen foto (también inactivos, igual que `foto()`): así
   * cualquier listado sabe a quién pedirle la miniatura sin tocar su respuesta.
   */
  async idsConFoto(): Promise<string[]> {
    const filas = await this.prisma.operadorCda.findMany({ where: { fotoKey: { not: null } }, select: { id: true } });
    return filas.map((f) => f.id);
  }

  /** La foto descifrada, para el listado y las actas. */
  async foto(operadorId: string): Promise<Buffer> {
    const operador = await this.prisma.operadorCda.findUnique({
      where: { id: operadorId },
      select: { fotoKey: true },
    });
    if (!operador?.fotoKey) throw new NotFoundException('El operador aún no tiene foto');
    return this.storage.readDecrypted(operador.fotoKey);
  }

  /**
   * Conservación (LOPDP): la foto se guarda solo mientras la persona sea
   * operador CDA. Cada madrugada se borran las de quienes pasaron a inactivos.
   */
  @Cron('0 3 * * *', { name: 'borrar-fotos-cda-inactivos', timeZone: 'America/Guayaquil' })
  async borrarFotosDeInactivos(): Promise<number> {
    const inactivos = await this.prisma.operadorCda.findMany({
      where: { activo: false, OR: [{ fotoKey: { not: null } }, { fotoPendienteKey: { not: null } }] },
      select: { id: true, fotoKey: true, fotoPendienteKey: true },
    });
    let borradas = 0;
    for (const { id, fotoKey, fotoPendienteKey } of inactivos) {
      // Condicionado: si justo se reactivó o cambió de foto, no se toca.
      const r = await this.prisma.operadorCda.updateMany({
        where: { id, activo: false, fotoKey, fotoPendienteKey },
        data: { fotoKey: null, fotoSubidaEn: null, fotoPendienteKey: null, fotoPendienteEn: null },
      });
      if (r.count === 0) continue;
      for (const key of [fotoKey, fotoPendienteKey]) if (key) await this.borrarArchivo(key);
      await this.prisma.bitacoraAuditoria.create({
        data: { accion: 'FOTO_CDA_ELIMINADA_INACTIVO', entidad: 'operador_cda', entidadId: id },
      });
      borradas++;
    }
    if (borradas > 0) this.log.log(`Fotos de operadores CDA inactivos eliminadas: ${borradas}`);
    return borradas;
  }

  /** Quinto archivo inválido: el enlace queda bloqueado. Queda en la bitácora (sin el token). */
  private async registrarBloqueo(operadorId: string): Promise<void> {
    this.log.warn(`Enlace de foto bloqueado por intentos fallidos (operador ${operadorId})`);
    await this.prisma.bitacoraAuditoria.create({
      data: {
        accion: 'FOTO_CDA_BLOQUEADO',
        entidad: 'operador_cda',
        entidadId: operadorId,
        datosDespues: { intentos: MAX_INTENTOS_FOTO },
      },
    });
  }

  private async enlaceActivo(token: string) {
    const enlace = await this.prisma.enlaceFotoCda.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { operador: true },
    });
    if (!enlace || !estaActivo(enlace, new Date()) || !enlace.operador.activo) return null;
    return enlace;
  }

  /** Un archivo huérfano no debe tumbar la respuesta: se registra y se sigue. */
  private async borrarArchivo(fileId: string): Promise<void> {
    try {
      await this.storage.remove(fileId);
    } catch (e) {
      this.log.warn(`No se pudo borrar ${fileId}: ${(e as Error).message}`);
    }
  }
}
