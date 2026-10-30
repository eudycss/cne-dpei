import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { ReporteFlujoItem, ResponsableInforme } from '@cne/shared-types';

import { PrismaService } from '../db/prisma.service';
import { StorageService } from '../storage/storage.service';
import { TrackingService } from './tracking.service';
import {
  DatosInformeOperador,
  generarInformesOperadorPdf,
  generarReporteGeneralPdf,
  JornadaOperador,
  Persona,
} from './informe-operador.pdf';

// Cada informe lleva 2 fotos: en el plan gratuito de Render (512 MB) un PDF
// enorme puede agotar la memoria. Por encima del tope se pide elegir cantón u
// operadores. El reporte general no lleva fotos y no tiene tope.
export const MAX_INFORMES_POR_PDF = 40;

// Quién puede firmar como responsable de la Unidad (se elige al descargar).
const ROLES_RESPONSABLE = ['ADMINISTRADOR', 'TECNICO_SUPERVISOR'];

/** Qué operadores entran en un PDF: los de un cantón, los elegidos o todos. */
export interface FiltroInformes {
  cantonId?: number;
  operadorIds?: string[];
}

/**
 * Informe del Operador CDA y reporte general en PDF: los hitos del reporte de
 * flujo, la prueba de conexión y las fotos de los reportes del recinto (solo el
 * día de elecciones, `incluirJornada`) y las firmas. Solo lectura.
 */
@Injectable()
export class InformeOperadorService {
  private readonly logger = new Logger(InformeOperadorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly tracking: TrackingService,
  ) {}

  async responsables(): Promise<ResponsableInforme[]> {
    const usuarios = await this.prisma.usuario.findMany({
      where: { activo: true, roles: { some: { rol: { nombre: { in: ROLES_RESPONSABLE } } } } },
      select: { id: true, nombres: true, apellidos: true, cedula: true },
      orderBy: [{ nombres: 'asc' }, { apellidos: 'asc' }],
    });
    return usuarios.map((u) => ({ id: u.id, nombre: `${u.nombres} ${u.apellidos}`, cedula: u.cedula }));
  }

  /** PDF de un solo operador. */
  async pdfOperador(operadorId: string, responsableId: string, incluirJornada: boolean): Promise<Buffer> {
    const responsable = await this.responsable(responsableId);
    const filas = (await this.tracking.reporteFlujoCdas()).filter((f) => f.operadorId === operadorId);
    if (filas.length === 0) throw new NotFoundException('El operador no tiene un CDA asignado en el evento activo');
    return generarInformesOperadorPdf(await this.datos(filas, incluirJornada), responsable, incluirJornada);
  }

  /** PDF con varios operadores (un cantón, los elegidos o todos), una sección por operador. */
  async pdfVarios(filtro: FiltroInformes, responsableId: string, incluirJornada: boolean): Promise<Buffer> {
    const responsable = await this.responsable(responsableId);
    const filas = await this.filas(filtro);
    if (filas.length > MAX_INFORMES_POR_PDF) {
      throw new BadRequestException(
        `Son ${filas.length} operadores; el máximo por archivo es ${MAX_INFORMES_POR_PDF}. Elige un cantón o menos operadores.`,
      );
    }
    return generarInformesOperadorPdf(await this.datos(filas, incluirJornada), responsable, incluirJornada);
  }

  /** Reporte general: una tabla con la jornada de todos los operadores (o de un cantón). */
  async pdfGeneral(cantonId: number | undefined, responsableId: string, incluirJornada: boolean): Promise<Buffer> {
    const responsable = await this.responsable(responsableId);
    const filas = await this.filas({ cantonId });
    return generarReporteGeneralPdf(filas.map(jornada), responsable, incluirJornada);
  }

  private async filas(filtro: FiltroInformes): Promise<ReporteFlujoItem[]> {
    const elegidos = filtro.operadorIds ? new Set(filtro.operadorIds) : null;
    return (await this.tracking.reporteFlujoCdas()).filter(
      (f) =>
        (filtro.cantonId === undefined || f.cantonId === filtro.cantonId) &&
        (!elegidos || elegidos.has(f.operadorId)),
    );
  }

  private async responsable(responsableId: string): Promise<Persona> {
    const u = await this.prisma.usuario.findFirst({
      where: {
        id: responsableId,
        activo: true,
        roles: { some: { rol: { nombre: { in: ROLES_RESPONSABLE } } } },
      },
      select: { nombres: true, apellidos: true, cedula: true },
    });
    if (!u) throw new BadRequestException('Elige un responsable que firme el informe');
    return { nombre: `${u.nombres} ${u.apellidos}`, cedula: u.cedula };
  }

  private async datos(filas: ReporteFlujoItem[], incluirJornada: boolean): Promise<DatosInformeOperador[]> {
    if (filas.length === 0) return [];
    // Sin la jornada (pruebas técnicas) no se buscan ni se descifran las fotos.
    const salidas: SalidaRecinto[] = incluirJornada ? await this.salidasRecinto(filas.map((f) => f.operadorId)) : [];
    // Tipos explícitos: con la versión de pnpm/TypeScript del CI el Map se infería como {}.
    const actasPorOperador = new Map<string, SalidaRecinto>(salidas.map((s) => [s.operadorId, s]));

    return filas.map((f) => {
      const actas = actasPorOperador.get(f.operadorId);
      return {
        ...jornada(f),
        actaInstalacion: () => this.foto(actas?.actaInstalacionUrl ?? null),
        actaEscrutinio: () => this.foto(actas?.actaEscrutinioUrl ?? null),
      };
    });
  }

  private async salidasRecinto(operadorIds: string[]): Promise<SalidaRecinto[]> {
    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
      select: { id: true },
    });
    if (!evento) return [];
    return this.prisma.eventoTracking.findMany({
      where: { eventoId: evento.id, operadorId: { in: operadorIds }, tipo: 'SALIDA_RECINTO' },
      select: { operadorId: true, actaInstalacionUrl: true, actaEscrutinioUrl: true },
    });
  }

  /** Foto del reporte descifrada; si falla, el informe sale sin esa foto. */
  private async foto(url: string | null): Promise<Buffer | null> {
    if (!url) return null;
    try {
      return await this.storage.readDecrypted(url);
    } catch (e) {
      this.logger.warn(`No se pudo leer la foto del reporte para el informe: ${(e as Error).message}`);
      return null;
    }
  }
}

/** Actas de la salida del recinto de un operador en el evento activo. */
interface SalidaRecinto {
  operadorId: string;
  actaInstalacionUrl: string | null;
  actaEscrutinioUrl: string | null;
}

function jornada(f: ReporteFlujoItem): JornadaOperador {
  const aFecha = (iso: string | null) => (iso ? new Date(iso) : null);
  return {
    operador: { nombre: f.operadorNombre, cedula: f.operadorCedula },
    cda: `${f.cdaCodigo} — ${f.cdaNombre}`,
    canton: f.cantonNombre,
    kits: f.kitsCodigos,
    salidaDpi: aFecha(f.salidaDpiEn),
    llegadaRecinto: aFecha(f.llegadaRecintoEn),
    pruebaConexion: aFecha(f.pruebaConexionEn),
    salidaRecinto: aFecha(f.salidaRecintoEn),
    llegadaDpi: aFecha(f.llegadaDpiEn),
    llegadaDpiManual: f.llegadaDpiManual,
  };
}
