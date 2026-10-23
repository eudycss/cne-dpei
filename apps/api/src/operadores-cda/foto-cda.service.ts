import {
  BadRequestException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as crypto from 'node:crypto';
import type { EnlaceFotoCdaCreado, EnlaceFotoCdaPublico } from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { StorageService } from '../storage/storage.service';
import { limpiarJpeg } from './jpeg';

export const VIGENCIA_ENLACE_MS = 48 * 60 * 60 * 1000;
export const MAX_INTENTOS_FOTO = 5;
/** La página la reduce a ~200 KB; 1 MB deja margen sin aceptar fotos crudas de 8 MB. */
export const MAX_FOTO_BYTES = 1024 * 1024;
const CATEGORIA = 'fotos-operadores-cda';
const ENLACE_INACTIVO = 'Este enlace ya no está activo. Pida uno nuevo a la Delegación.';

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
  ): Promise<{ operadorId: string }> {
    const enlace = await this.enlaceActivo(token);
    if (!enlace) throw new GoneException(ENLACE_INACTIVO);

    const jpeg = file?.buffer && file.size <= MAX_FOTO_BYTES ? limpiarJpeg(file.buffer) : null;
    if (!jpeg) {
      await this.prisma.enlaceFotoCda.updateMany({
        where: { id: enlace.id, intentos: { lt: MAX_INTENTOS_FOTO } },
        data: { intentos: { increment: 1 } },
      });
      if (enlace.intentos + 1 >= MAX_INTENTOS_FOTO) await this.registrarBloqueo(enlace.operadorId);
      throw new BadRequestException('La foto debe ser una imagen JPG válida de hasta 1 MB. Intente de nuevo.');
    }

    const fotoKey = await this.storage.saveEncrypted({
      categoria: CATEGORIA,
      buffer: jpeg.limpio,
      maxBytes: MAX_FOTO_BYTES,
    });
    const ahora = new Date();
    let anterior: string | null;
    try {
      anterior = await this.prisma.$transaction(async (tx) => {
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
        const { fotoKey: previa } = await tx.operadorCda.findUniqueOrThrow({
          where: { id: enlace.operadorId },
          select: { fotoKey: true },
        });
        await tx.operadorCda.update({
          where: { id: enlace.operadorId },
          data: { fotoKey, fotoSubidaEn: ahora },
        });
        return previa;
      });
    } catch (e) {
      await this.borrarArchivo(fotoKey);
      throw e;
    }
    if (anterior) await this.borrarArchivo(anterior);
    return { operadorId: enlace.operadorId };
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
      where: { activo: false, fotoKey: { not: null } },
      select: { id: true, fotoKey: true },
    });
    let borradas = 0;
    for (const { id, fotoKey } of inactivos) {
      // Condicionado: si justo se reactivó o cambió de foto, no se toca.
      const r = await this.prisma.operadorCda.updateMany({
        where: { id, activo: false, fotoKey },
        data: { fotoKey: null, fotoSubidaEn: null },
      });
      if (r.count === 0 || !fotoKey) continue;
      await this.borrarArchivo(fotoKey);
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
