import {
  BadRequestException,
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import type { AvanceInformeCda, EstadoFotoInformeCda, VisitaInformeCdaPublica } from '@cne/shared-types';
import { FOTO_INFORME_PEQUENA, FOTOS_INFORME_CDA, fotoInformeTieneTamano } from '@cne/shared-validation';

import { PrismaService } from '../db/prisma.service';
import { StorageService } from '../storage/storage.service';
import { limpiarJpeg } from './jpeg';
import { CEDULA_NO_REGISTRADA_FOTO, enmascararCedula, hashToken, MAX_FOTO_BYTES } from './foto-cda.service';
import { nombreCortoDeApellidosNombres } from '../evatics/nombre-evatics';
import { FotoAnexo, generarWordInformeProductos, nombreArchivoInforme, tieneInforme } from './informe-productos.documento';

/** Lo que dura una visita a la página: tiempo de sobra para subir 6 fotos y descargar. */
export const VIGENCIA_VISITA_MS = 2 * 60 * 60 * 1000;
const CATEGORIA = 'fotos-informe-cda';
/**
 * Visitas abiertas con una misma cédula en los últimos 15 min: frena el uso
 * con IP rotadas, y si alguien la usa de mala fe, el bloqueo dura poco.
 */
export const MAX_VISITAS_ACTIVAS = 10;
const VENTANA_VISITAS_MS = 15 * 60 * 1000;
const DEMASIADAS_VISITAS = 'Se ingresó muchas veces con esta cédula. Espere 15 minutos e intente de nuevo.';
export const VISITA_VENCIDA = 'La visita venció: escriba su cédula de nuevo.';
const FOTO_INVALIDA = 'La foto debe ser una imagen JPG válida de hasta 1 MB. Intente de nuevo.';
export const FALTAN_FOTOS =
  'Para descargar el informe aquí, las 6 fotos deben subirse en esta visita. Reemplace las que subió antes o pida el informe a la Delegación.';
const SIN_INFORME = 'Su cargo aún no tiene formato de informe. Consulte a la Delegación.';

export interface ArchivoInforme {
  nombre: string;
  contenido: Buffer;
}

/**
 * Informe de productos del personal CDA/CPE con su registro fotográfico.
 * Enlace público por cédula: como cualquiera puede escribir una cédula ajena,
 * solo dentro de la misma visita se ven las fotos subidas y se descarga el
 * informe; el informe con fotos de visitas anteriores lo baja la Delegación.
 */
@Injectable()
export class InformeProductosService {
  private readonly log = new Logger(InformeProductosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ---------- Página pública ----------

  async consultar(cedula: string): Promise<VisitaInformeCdaPublica> {
    const operador = await this.prisma.operadorCda.findUnique({
      where: { cedula },
      select: { id: true, cedula: true, apellidosNombres: true, cargo: true, grupo: true, activo: true },
    });
    if (!operador?.activo) throw new NotFoundException(CEDULA_NO_REGISTRADA_FOTO);

    const ahora = new Date();
    const activas = await this.prisma.visitaInformeCda.count({
      where: { operadorId: operador.id, expiraEn: { gt: ahora }, creadoEn: { gt: new Date(ahora.getTime() - VENTANA_VISITAS_MS) } },
    });
    if (activas >= MAX_VISITAS_ACTIVAS) throw new HttpException(DEMASIADAS_VISITAS, HttpStatus.TOO_MANY_REQUESTS);
    const token = crypto.randomBytes(32).toString('base64url');
    const expiraEn = new Date(ahora.getTime() + VIGENCIA_VISITA_MS);
    const [, visita] = await this.prisma.$transaction([
      // Limpieza de paso: las visitas vencidas no sirven para nada.
      this.prisma.visitaInformeCda.deleteMany({ where: { expiraEn: { lt: ahora } } }),
      this.prisma.visitaInformeCda.create({
        data: { operadorId: operador.id, tokenHash: hashToken(token), expiraEn },
        select: { id: true },
      }),
    ]);
    return {
      token,
      expiraEn: expiraEn.toISOString(),
      nombreCorto: nombreCortoDeApellidosNombres(operador.apellidosNombres),
      cedula: enmascararCedula(operador.cedula),
      cargo: operador.cargo,
      tieneInforme: tieneInforme(operador.grupo),
      fotos: await this.estadoFotos(operador.id, visita.id),
    };
  }

  /** Sube o reemplaza la foto de una posición; la anterior se borra. */
  async subirFoto(
    token: string,
    posicion: number,
    file: Express.Multer.File | undefined,
    version: string,
  ): Promise<{ operadorId: string; fotos: EstadoFotoInformeCda[] }> {
    const visita = await this.visita(token);
    const jpeg = file?.buffer && file.size <= MAX_FOTO_BYTES ? limpiarJpeg(file.buffer) : null;
    if (!jpeg || !jpeg.ancho || !jpeg.alto) throw new BadRequestException(FOTO_INVALIDA);
    if (!fotoInformeTieneTamano(jpeg.ancho, jpeg.alto)) throw new BadRequestException(FOTO_INFORME_PEQUENA);

    const fotoKey = await this.storage.saveEncrypted({ categoria: CATEGORIA, buffer: jpeg.limpio, maxBytes: MAX_FOTO_BYTES });
    let anterior: string | null = null;
    try {
      anterior = await this.prisma.$transaction(async (tx) => {
        const previa = await tx.fotoInformeCda.findUnique({
          where: { operadorId_posicion: { operadorId: visita.operadorId, posicion } },
          select: { fotoKey: true },
        });
        const datos = {
          fotoKey,
          ancho: jpeg.ancho,
          alto: jpeg.alto,
          visitaId: visita.id,
          consentimientoVersion: version,
          subidoEn: new Date(),
        };
        await tx.fotoInformeCda.upsert({
          where: { operadorId_posicion: { operadorId: visita.operadorId, posicion } },
          create: { operadorId: visita.operadorId, posicion, ...datos },
          update: datos,
        });
        return previa?.fotoKey ?? null;
      });
    } catch (e) {
      await this.borrarArchivo(fotoKey);
      throw e;
    }
    if (anterior) await this.borrarArchivo(anterior);
    return { operadorId: visita.operadorId, fotos: await this.estadoFotos(visita.operadorId, visita.id) };
  }

  /** Solo una foto subida en esta misma visita (nunca una anterior). */
  async verFoto(token: string, posicion: number): Promise<Buffer> {
    const visita = await this.visita(token);
    const foto = await this.prisma.fotoInformeCda.findUnique({
      where: { operadorId_posicion: { operadorId: visita.operadorId, posicion } },
      select: { fotoKey: true, visitaId: true },
    });
    if (!foto || foto.visitaId !== visita.id) throw new NotFoundException('Esa foto no se subió en esta visita');
    return this.storage.readDecrypted(foto.fotoKey);
  }

  /** El informe con las 6 fotos, solo si todas se subieron en esta visita. */
  async generarPublico(token: string): Promise<ArchivoInforme & { operadorId: string }> {
    const visita = await this.visita(token);
    const fotos = await this.prisma.fotoInformeCda.findMany({
      where: { operadorId: visita.operadorId },
      select: { visitaId: true },
    });
    if (fotos.length < FOTOS_INFORME_CDA || fotos.some((f) => f.visitaId !== visita.id)) {
      throw new ConflictException(FALTAN_FOTOS);
    }
    return { operadorId: visita.operadorId, ...(await this.informe(visita.operadorId)) };
  }

  // ---------- Delegación ----------

  /** Cuántas fotos lleva cada persona (solo quienes subieron alguna). */
  async avance(): Promise<AvanceInformeCda[]> {
    const filas = await this.prisma.fotoInformeCda.groupBy({ by: ['operadorId'], _count: { _all: true } });
    return filas.map((f) => ({ operadorId: f.operadorId, fotos: f._count._all }));
  }

  /** El informe de una persona con las fotos que tenga (las que falten quedan en blanco). */
  async informe(operadorId: string): Promise<ArchivoInforme> {
    const operador = await this.prisma.operadorCda.findUnique({
      where: { id: operadorId },
      select: { cedula: true, apellidosNombres: true, grupo: true },
    });
    if (!operador) throw new NotFoundException('Persona no encontrada');
    if (!tieneInforme(operador.grupo)) throw new BadRequestException(SIN_INFORME);

    const filas = await this.prisma.fotoInformeCda.findMany({
      where: { operadorId },
      select: { posicion: true, fotoKey: true, ancho: true, alto: true },
      orderBy: { posicion: 'asc' },
    });
    const fotos: FotoAnexo[] = [];
    for (const f of filas) {
      // Una a la vez: Render tiene poca memoria.
      fotos.push({ posicion: f.posicion, ancho: f.ancho, alto: f.alto, jpeg: await this.storage.readDecrypted(f.fotoKey) });
    }
    return {
      nombre: nombreArchivoInforme(operador.cedula),
      contenido: generarWordInformeProductos(operador.grupo, operador.apellidosNombres, fotos),
    };
  }

  // ---------- internos ----------

  private async visita(token: string): Promise<{ id: string; operadorId: string }> {
    const visita = await this.prisma.visitaInformeCda.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, operadorId: true, expiraEn: true, operador: { select: { activo: true } } },
    });
    if (!visita || visita.expiraEn <= new Date() || !visita.operador.activo) throw new GoneException(VISITA_VENCIDA);
    return { id: visita.id, operadorId: visita.operadorId };
  }

  private async estadoFotos(operadorId: string, visitaId: string): Promise<EstadoFotoInformeCda[]> {
    const filas = await this.prisma.fotoInformeCda.findMany({
      where: { operadorId },
      select: { posicion: true, visitaId: true },
    });
    const porPosicion = new Map<number, string | null>(filas.map((f) => [f.posicion, f.visitaId]));
    return Array.from({ length: FOTOS_INFORME_CDA }, (_, i) => {
      const posicion = i + 1;
      return { posicion, cargada: porPosicion.has(posicion), deEstaVisita: porPosicion.get(posicion) === visitaId };
    });
  }

  private async borrarArchivo(fileId: string): Promise<void> {
    try {
      await this.storage.remove(fileId);
    } catch (e) {
      this.log.warn(`No se pudo borrar ${fileId}: ${(e as Error).message}`);
    }
  }
}
