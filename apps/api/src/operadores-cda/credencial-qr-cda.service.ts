import { ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import * as crypto from 'crypto';
import type {
  AsistenciaCdaFila,
  ConsultaQrCda,
  CredencialQrCdaVigente,
  OperadorCda,
  TipoMarcaAsistenciaCda,
} from '@cne/shared-types';

import { PrismaService } from '../db/prisma.service';
import { StorageService } from '../storage/storage.service';
import { carnetsPdf } from './carnet-cda.pdf';
import { CifradoTokenCarnet } from './cifrado-token-carnet';
import { AsistenciaCdaService } from './asistencia-cda.service';
import { diaEcuador, fechaDb, horaEcuador } from './dia-ecuador';
import { hashToken } from './foto-cda.service';
import { toOperadorCdaDto } from './operadores-cda.service';
import { TEXTOS_GRUPO } from './grupo-cda';

const PREFIJO = 'CDA1';
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
/** Entre la entrada y la salida por QR: evita que un segundo escaneo seguido marque la salida. */
export const MIN_MINUTOS_SALIDA_QR = 5;
// Mismo mensaje para "no existe", "anulada" u "operador oculto": no revela cuál es.
const NO_VALIDA = 'Credencial no válida o anulada';
/** Descargas de fotos en paralelo al armar los carnets (Storage remoto). */
const FOTOS_EN_PARALELO = 5;

/** RFC 4648 sin relleno: 16 bytes → 26 caracteres. */
function base32(bytes: Buffer): string {
  let bits = 0;
  let valor = 0;
  let salida = '';
  for (const b of bytes) {
    valor = (valor << 8) | b;
    bits += 8;
    while (bits >= 5) {
      salida += BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += BASE32[(valor << (5 - bits)) & 31];
  return salida;
}

/** 128 bits aleatorios; ver `tokenCredencialQrCdaSchema` (solo A-Z y 2-7). */
export function generarTokenCredencial(): string {
  return PREFIJO + base32(crypto.randomBytes(16));
}

interface CredencialEmitida {
  operador: OperadorCda;
  token: string;
  /** Clave de la foto en Storage (para el carnet). */
  fotoKey: string | null;
  /** Solo al reimprimir: la fecha de emisión original. */
  emitidaEn?: Date;
}

/**
 * Carnet QR de los operadores CDA. En la BD queda el SHA-256 del token (para
 * reconocerlo) y, si hay CARNET_TOKEN_KEY, el token cifrado (para reimprimirlo
 * sin anularlo); en claro solo existe dentro del PDF que se imprime.
 * Escanear no marca nada: `consultar` devuelve a quién pertenece (con su foto
 * para confirmar que es la persona) y `marcar` registra con el mismo servicio
 * que el check manual.
 */
@Injectable()
export class CredencialQrCdaService {
  private readonly logger = new Logger(CredencialQrCdaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asistencia: AsistenciaCdaService,
    private readonly storage: StorageService,
    private readonly cifrado: CifradoTokenCarnet,
  ) {}

  /**
   * Emite los carnets y devuelve el PDF para imprimir: es la única vez que el
   * token sale en claro. Una foto que no se puede leer no frena el resto.
   */
  async carnetsPdf(operadorIds: string[], usuarioId: string): Promise<Buffer> {
    const operadores = await this.prisma.operadorCda.findMany({
      where: { id: { in: [...new Set(operadorIds)] }, activo: true },
      orderBy: { apellidosNombres: 'asc' },
    });
    if (operadores.length === 0) throw new NotFoundException('Ninguna de las personas elegidas está activa');
    const emitidas: CredencialEmitida[] = operadores.map((o) => ({
      operador: toOperadorCdaDto(o),
      token: generarTokenCredencial(),
      fotoKey: o.fotoKey,
    }));
    const pdf = await this.armarPdf(emitidas);
    // Se guarda solo con el PDF listo: si algo falla antes, los carnets vigentes
    // siguen sirviendo (si no, quedarían anulados y los nuevos sin imprimir).
    await this.guardar(emitidas, usuarioId);
    return pdf;
  }

  /**
   * Vuelve a imprimir el carnet vigente de cada uno, con el mismo código y su
   * fecha de emisión: nada se anula. El nombre, el cargo y la foto son los de
   * hoy (sirve tras un cambio de cargo). Si alguno no se puede, no sale ninguno.
   */
  async reimprimirPdf(operadorIds: string[]): Promise<Buffer> {
    if (!this.cifrado.disponible) {
      throw new ServiceUnavailableException('Reimprimir carnets no está configurado en el servidor');
    }
    const ids = [...new Set(operadorIds)];
    const operadores = await this.prisma.operadorCda.findMany({
      where: { id: { in: ids }, activo: true },
      orderBy: { apellidosNombres: 'asc' },
      include: { credenciales: { where: { revocadaEn: null }, take: 1 } },
    });
    if (operadores.length === 0) throw new NotFoundException('Ninguna de las personas elegidas está activa');
    if (operadores.length < ids.length) {
      throw new NotFoundException(
        `${ids.length - operadores.length} de las personas elegidas ya no está activa: recargue la lista`,
      );
    }

    const emitidas: CredencialEmitida[] = [];
    const sinCarnet: string[] = [];
    const noReimprimibles: string[] = [];
    for (const o of operadores) {
      const c = o.credenciales[0];
      if (!c) {
        sinCarnet.push(o.apellidosNombres);
        continue;
      }
      const token = c.tokenCifrado ? this.cifrado.descifrar(c.tokenCifrado, o.id) : null;
      // Además del cifrado autenticado, el token tiene que ser el del hash vigente.
      if (!token || hashToken(token) !== c.tokenHash) {
        noReimprimibles.push(o.apellidosNombres);
        continue;
      }
      emitidas.push({ operador: toOperadorCdaDto(o), token, fotoKey: o.fotoKey, emitidaEn: c.emitidaEn });
    }
    if (sinCarnet.length) throw new ConflictException(`Sin carnet vigente (emítalo primero): ${sinCarnet.join(', ')}`);
    if (noReimprimibles.length) {
      throw new ConflictException(
        `Estos carnets no se pueden reimprimir (son de antes de esta función o de otra clave del servidor); ` +
          `emítalos de nuevo una última vez: ${noReimprimibles.join(', ')}`,
      );
    }
    return this.armarPdf(emitidas);
  }

  private async armarPdf(emitidas: CredencialEmitida[]): Promise<Buffer> {
    const fotos: (Buffer | null)[] = [];
    for (let i = 0; i < emitidas.length; i += FOTOS_EN_PARALELO) {
      const lote = emitidas.slice(i, i + FOTOS_EN_PARALELO);
      fotos.push(...(await Promise.all(lote.map((e) => this.fotoOpcional(e)))));
    }
    return carnetsPdf(
      emitidas.map((e, i) => ({
        grupo: TEXTOS_GRUPO[e.operador.grupo].cargo,
        nombre: e.operador.apellidosNombres,
        cargo: e.operador.cargo.split(' - ')[0],
        token: e.token,
        foto: fotos[i],
        emitidoEn: e.emitidaEn,
      })),
      new Date(),
    );
  }

  private async fotoOpcional(e: CredencialEmitida): Promise<Buffer | null> {
    if (!e.fotoKey) return null;
    try {
      return await this.storage.readDecrypted(e.fotoKey);
    } catch (err) {
      this.logger.warn(`Carnet sin foto: no se pudo leer la del operador ${e.operador.id}: ${(err as Error).message}`);
      return null;
    }
  }

  /** Anula el carnet vigente de cada uno y guarda el hash del nuevo, todo o nada. */
  private async guardar(emitidas: CredencialEmitida[], usuarioId: string): Promise<void> {
    const ahora = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.credencialQrCda.updateMany({
          where: { operadorId: { in: emitidas.map((e) => e.operador.id) }, revocadaEn: null },
          data: { revocadaEn: ahora, motivoRevocacion: 'REEMITIDA' },
        });
        await tx.credencialQrCda.createMany({
          data: emitidas.map((e) => ({
            operadorId: e.operador.id,
            tokenHash: hashToken(e.token),
            tokenCifrado: this.cifrado.cifrar(e.token, e.operador.id),
            emitidaEn: ahora,
            emitidaPorId: usuarioId,
          })),
        });
      });
    } catch (e) {
      // uq_credenciales_qr_cda_vigente: otro administrador emitió a la vez para el mismo operador.
      if ((e as { code?: string } | null)?.code === 'P2002') {
        throw new ConflictException('Otro usuario emitió carnets al mismo tiempo; vuelva a intentarlo');
      }
      throw e;
    }
  }

  async vigentes(): Promise<CredencialQrCdaVigente[]> {
    const filas = await this.prisma.credencialQrCda.findMany({
      where: { revocadaEn: null },
      select: { operadorId: true, emitidaEn: true, tokenCifrado: true },
    });
    const reimprimir = this.cifrado.disponible;
    return filas.map((f) => ({
      operadorId: f.operadorId,
      emitidaEn: f.emitidaEn.toISOString(),
      reimprimible: reimprimir && f.tokenCifrado !== null,
    }));
  }

  /** Anula el carnet vigente (perdido o robado) sin emitir otro. */
  async revocar(operadorId: string): Promise<{ revocada: true }> {
    const { count } = await this.prisma.credencialQrCda.updateMany({
      where: { operadorId, revocadaEn: null },
      data: { revocadaEn: new Date(), motivoRevocacion: 'REVOCADA' },
    });
    if (count === 0) throw new NotFoundException('El operador no tiene un carnet vigente');
    return { revocada: true };
  }

  async consultar(token: string): Promise<ConsultaQrCda> {
    const operador = await this.operadorDelToken(token);
    const hoy = await this.prisma.asistenciaCda.findUnique({
      where: { operadorId_fecha: { operadorId: operador.id, fecha: fechaDb(diaEcuador()) } },
      select: { entradaEn: true, salidaEn: true },
    });
    const entradaEn = hoy?.entradaEn ?? null;
    const salidaEn = hoy?.salidaEn ?? null;
    return {
      operador: toOperadorCdaDto(operador),
      siguiente: !entradaEn ? 'ENTRADA' : !salidaEn ? 'SALIDA' : 'COMPLETO',
      entradaEn: entradaEn?.toISOString() ?? null,
      salidaEn: salidaEn?.toISOString() ?? null,
      salidaDesde: entradaEn && !salidaEn ? salidaPermitidaDesde(entradaEn).toISOString() : null,
    };
  }

  /**
   * Registra la marca confirmada. `tipo` es lo que vio quien escaneó: si otro
   * técnico marcó entretanto, `AsistenciaCdaService.marcar` responde 409.
   */
  async marcar(token: string, tipo: TipoMarcaAsistenciaCda, usuarioId: string): Promise<AsistenciaCdaFila> {
    const operador = await this.operadorDelToken(token);
    if (tipo === 'SALIDA') {
      const hoy = await this.prisma.asistenciaCda.findUnique({
        where: { operadorId_fecha: { operadorId: operador.id, fecha: fechaDb(diaEcuador()) } },
        select: { entradaEn: true },
      });
      const desde = hoy?.entradaEn ? salidaPermitidaDesde(hoy.entradaEn) : null;
      if (desde && desde > new Date()) {
        throw new ConflictException(
          `La entrada se registró a las ${horaEcuador(hoy!.entradaEn!)}: ` +
            `la salida con el carnet se acepta desde las ${horaEcuador(desde)}`,
        );
      }
    }
    return this.asistencia.marcar(operador.id, tipo, usuarioId, 'QR');
  }

  private async operadorDelToken(token: string) {
    const credencial = await this.prisma.credencialQrCda.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { operador: true },
    });
    if (!credencial || credencial.revocadaEn || !credencial.operador.activo) throw new NotFoundException(NO_VALIDA);
    return credencial.operador;
  }
}

function salidaPermitidaDesde(entradaEn: Date): Date {
  return new Date(entradaEn.getTime() + MIN_MINUTOS_SALIDA_QR * 60_000);
}
