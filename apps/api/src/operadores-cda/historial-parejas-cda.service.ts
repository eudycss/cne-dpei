import { Injectable } from '@nestjs/common';
import type { FormatoReporteCda, HistorialParejasCda } from '@cne/shared-types';

import { PrismaService } from '../db/prisma.service';
import { diaDeFechaDb, fechaDb } from './dia-ecuador';
import { type PersonaBase, armarHistorial, reporteHistorial } from './historial-parejas-cda';
import { type ArchivoReporte, generarReporte } from './reporte-cda';

const PERSONA = { id: true, apellidosNombres: true, cedula: true, grupo: true, dispositivo: true, activo: true } as const;
const RECINTO = { id: true, codigoRecinto: true, nombre: true, canton: { select: { nombre: true } } } as const;

/** Pestaña "Historial" de Parejas: solo lee (no cambia listas ni kits). */
@Injectable()
export class HistorialParejasCdaService {
  constructor(private readonly prisma: PrismaService) {}

  async historial(fechas: string[]): Promise<HistorialParejasCda> {
    const [personas, recintos, parejas] = await Promise.all([
      this.prisma.operadorCda.findMany({ where: { grupo: { in: ['OPERADOR', 'ASISTENTE'] }, activo: true }, select: PERSONA }),
      this.prisma.recinto.findMany({ where: { tipo: 'CDA', activo: true }, select: RECINTO }),
      this.prisma.parejaCda.findMany({
        where: { fecha: { in: fechas.map(fechaDb) } },
        select: {
          fecha: true,
          recinto: { select: RECINTO },
          operador: { select: { ...PERSONA, usuarioId: true } },
          asistente: { select: { ...PERSONA, usuarioId: true } },
          kit: { select: { codigoUnico: true, operadorId: true } },
        },
        orderBy: { creadoEn: 'asc' },
      }),
    ]);
    return armarHistorial(
      fechas,
      personas as PersonaBase[],
      recintos,
      parejas.map((p) => ({
        ...p,
        fecha: diaDeFechaDb(p.fecha),
        operador: p.operador as PersonaBase & { usuarioId: string | null },
        asistente: p.asistente as (PersonaBase & { usuarioId: string | null }) | null,
      })),
    );
  }

  async reporte(fechas: string[], formato: FormatoReporteCda): Promise<ArchivoReporte> {
    return generarReporte(reporteHistorial(await this.historial(fechas)), formato);
  }
}
