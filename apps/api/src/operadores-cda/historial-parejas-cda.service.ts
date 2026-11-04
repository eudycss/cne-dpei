import { BadRequestException, Injectable } from '@nestjs/common';
import type { FormatoReporteCda, HistorialParejasCda, PropuestaParejasCda } from '@cne/shared-types';

import { PrismaService } from '../db/prisma.service';
import { diaDeFechaDb, fechaDb } from './dia-ecuador';
import { type PersonaBase, armarHistorial, reporteHistorial } from './historial-parejas-cda';
import { proponerParejas } from './propuesta-parejas-cda';
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

  /**
   * Propuesta para `fecha`: personal que no fue en `referencia` a los recintos
   * no visitados, más una pareja en cada recinto de `extras`. Solo lee.
   */
  async propuesta(fecha: string, referencia: string[], extras: string[]): Promise<PropuestaParejasCda> {
    const INTEGRANTES = { operadorCdaId: true, asistenteCdaId: true, recintoId: true } as const;
    const [personas, recintos, previas, delDia] = await Promise.all([
      this.prisma.operadorCda.findMany({
        where: { grupo: { in: ['OPERADOR', 'ASISTENTE'] }, activo: true },
        select: { id: true, apellidosNombres: true, cedula: true, grupo: true, dispositivo: true },
      }),
      this.prisma.recinto.findMany({ where: { tipo: 'CDA', activo: true }, select: RECINTO }),
      this.prisma.parejaCda.findMany({ where: { fecha: { in: referencia.map(fechaDb) } }, select: INTEGRANTES }),
      this.prisma.parejaCda.findMany({ where: { fecha: fechaDb(fecha) }, select: INTEGRANTES }),
    ]);
    const ids = new Set(recintos.map((r) => r.id));
    if (extras.some((id) => !ids.has(id))) throw new BadRequestException('Uno de los recintos marcados no es un recinto CDA activo');
    const integrantes = (xs: typeof previas) =>
      new Set(xs.flatMap((p) => [p.operadorCdaId, p.asistenteCdaId]).filter((x): x is string => !!x));
    const { filas, personas: disponibles } = proponerParejas({
      personas,
      recintos: recintos.map((r) => ({ id: r.id, codigo: r.codigoRecinto, nombre: r.nombre, ...(r.canton && { canton: r.canton.nombre }) })),
      fueron: integrantes(previas),
      visitados: new Set(previas.map((p) => p.recintoId)),
      personasDelDia: integrantes(delDia),
      recintosDelDia: new Set(delDia.map((p) => p.recintoId)),
      extras: new Set(extras),
    });
    return { fecha, referencia, filas, personas: disponibles };
  }

  async reporte(fechas: string[], formato: FormatoReporteCda): Promise<ArchivoReporte> {
    return generarReporte(reporteHistorial(await this.historial(fechas)), formato);
  }
}
