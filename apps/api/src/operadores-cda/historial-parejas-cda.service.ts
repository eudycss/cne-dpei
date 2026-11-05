import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { BusquedaAsignacionesCda, FormatoReporteCda, HistorialParejasCda, PropuestaParejasCda } from '@cne/shared-types';

import { PrismaService } from '../db/prisma.service';
import { idsPorBusqueda } from '../common/busqueda-sql';
import { MAX_RESULTADOS_ASIGNACIONES, armarBusquedaAsignaciones } from './busqueda-asignaciones-cda';
import { diaDeFechaDb, fechaDb } from './dia-ecuador';
import { type PersonaBase, armarHistorial, reporteHistorial } from './historial-parejas-cda';
import { proponerParejas } from './propuesta-parejas-cda';
import { type ArchivoReporte, generarReporte } from './reporte-cda';

const PERSONA = { id: true, apellidosNombres: true, cedula: true, grupo: true, dispositivo: true, activo: true } as const;
const RECINTO = { id: true, codigoRecinto: true, nombre: true, canton: { select: { nombre: true } } } as const;

/** Tope de parejas que lee una búsqueda (de la más reciente a la más antigua). */
const MAX_PAREJAS_BUSQUEDA = 500;

/** Recintos de las parejas, sin las de reserva (no tienen). */
const recintosDe = (parejas: { recintoId: string | null }[]) =>
  new Set(parejas.map((p) => p.recintoId).filter((id): id is string => !!id));

/** Pestaña "Historial" de Parejas: solo lee (no cambia listas ni kits). */
@Injectable()
export class HistorialParejasCdaService {
  constructor(private readonly prisma: PrismaService) {}

  async historial(fechas: string[]): Promise<HistorialParejasCda> {
    const [personas, recintos, parejas] = await Promise.all([
      this.prisma.operadorCda.findMany({ where: { grupo: { in: ['OPERADOR', 'ASISTENTE'] }, activo: true }, select: PERSONA }),
      this.prisma.recinto.findMany({ where: { tipo: 'CDA', activo: true }, select: RECINTO }),
      this.prisma.parejaCda.findMany({
        // Las de reserva no fueron a ningún recinto: no son visitas.
        where: { fecha: { in: fechas.map(fechaDb) }, recintoId: { not: null } },
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
        recinto: p.recinto as NonNullable<typeof p.recinto>,
        fecha: diaDeFechaDb(p.fecha),
        operador: p.operador as PersonaBase & { usuarioId: string | null },
        asistente: p.asistente as (PersonaBase & { usuarioId: string | null }) | null,
      })),
    );
  }

  /**
   * "¿Quién fue a dónde?": personas (Operador/Asistente CDA, por nombre o cédula)
   * y recintos CDA (por código o nombre; un NO CDA lleva a su CDA) que coinciden
   * con `q`, con todas sus parejas de cualquier fecha. Solo lee.
   */
  async buscar(q: string): Promise<BusquedaAsignacionesCda> {
    const [idsPersonas, idsRecintos] = await Promise.all([
      idsPorBusqueda(
        this.prisma,
        Prisma.sql`operadores_cda t`,
        [Prisma.raw('t.apellidos_nombres'), Prisma.raw('t.cedula')],
        q,
        Prisma.sql`t.grupo IN ('OPERADOR', 'ASISTENTE')`,
      ),
      idsPorBusqueda(this.prisma, Prisma.sql`recintos t`, [Prisma.raw('t.nombre'), Prisma.raw('t.codigo_recinto')], q, Prisma.sql`t.activo`),
    ]);
    const [personas, recintos] = await Promise.all([
      this.prisma.operadorCda.findMany({
        where: { id: { in: idsPersonas ?? [] } },
        select: { id: true, apellidosNombres: true, cedula: true, grupo: true },
        orderBy: { apellidosNombres: 'asc' },
        // Uno de más: así se sabe si hay más de los que se muestran.
        take: MAX_RESULTADOS_ASIGNACIONES + 1,
      }),
      this.prisma.recinto.findMany({
        where: { id: { in: idsRecintos ?? [] } },
        select: { id: true, codigoRecinto: true, nombre: true, tipo: true, cdaDestinoId: true },
        orderBy: { codigoRecinto: 'asc' },
      }),
    ]);

    // Un NO CDA buscado lleva a su CDA, con el NO CDA anotado.
    const noCdasPorCda = new Map<string, { codigo: string; nombre: string }[]>();
    for (const r of recintos) {
      if (r.tipo !== 'NO_CDA' || !r.cdaDestinoId) continue;
      noCdasPorCda.set(r.cdaDestinoId, [...(noCdasPorCda.get(r.cdaDestinoId) ?? []), { codigo: r.codigoRecinto, nombre: r.nombre }]);
    }
    const idsCda = new Set([...recintos.filter((r) => r.tipo === 'CDA').map((r) => r.id), ...noCdasPorCda.keys()]);
    const cdas = await this.prisma.recinto.findMany({
      where: { id: { in: [...idsCda] }, tipo: 'CDA' },
      select: { id: true, codigoRecinto: true, nombre: true },
      orderBy: { codigoRecinto: 'asc' },
      take: MAX_RESULTADOS_ASIGNACIONES + 1,
    });

    const idsPersona = personas.slice(0, MAX_RESULTADOS_ASIGNACIONES).map((p) => p.id);
    const idsCdaMostrados = cdas.slice(0, MAX_RESULTADOS_ASIGNACIONES).map((c) => c.id);
    const parejas =
      idsPersona.length + idsCdaMostrados.length === 0
        ? []
        : await this.prisma.parejaCda.findMany({
            where: {
              OR: [
                { operadorCdaId: { in: idsPersona } },
                { asistenteCdaId: { in: idsPersona } },
                { recintoId: { in: idsCdaMostrados } },
              ],
            },
            select: {
              fecha: true,
              recinto: { select: { id: true, codigoRecinto: true, nombre: true } },
              operador: { select: { id: true, apellidosNombres: true } },
              asistente: { select: { id: true, apellidosNombres: true } },
              kit: { select: { codigoUnico: true } },
            },
            orderBy: { fecha: 'desc' },
            take: MAX_PAREJAS_BUSQUEDA + 1,
          });
    return armarBusquedaAsignaciones(
      personas,
      cdas,
      noCdasPorCda,
      parejas.slice(0, MAX_PAREJAS_BUSQUEDA).map((p) => ({ ...p, fecha: diaDeFechaDb(p.fecha) })),
      parejas.length > MAX_PAREJAS_BUSQUEDA,
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
      visitados: recintosDe(previas),
      personasDelDia: integrantes(delDia),
      recintosDelDia: recintosDe(delDia),
      extras: new Set(extras),
    });
    return { fecha, referencia, filas, personas: disponibles };
  }

  async reporte(fechas: string[], formato: FormatoReporteCda): Promise<ArchivoReporte> {
    return generarReporte(reporteHistorial(await this.historial(fechas)), formato);
  }
}
