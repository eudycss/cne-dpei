import type { GrupoCda } from '@cne/shared-types';

import type { PrismaService } from '../db/prisma.service';
import { diaDeFechaDb, fechaDb } from './dia-ecuador';

/** Un cambio de cargo ya leído: rige desde `desde` (AAAA-MM-DD) inclusive. */
export interface CambioCargo {
  grupoAnterior: GrupoCda;
  grupoNuevo: GrupoCda;
  desde: string;
}

/** Días [desde, hasta] en un cargo; null = sin límite (antes del primer cambio / hasta hoy). */
export interface Tramo {
  desde: string | null;
  hasta: string | null;
}

function diaAnterior(dia: string): string {
  return diaDeFechaDb(new Date(fechaDb(dia).getTime() - 86_400_000));
}

/**
 * Tramos en que la persona estuvo en `grupo`. `cambios` en orden (desde y
 * luego creación). Sin cambios, todo su tiempo es del cargo actual. Dos
 * cambios el mismo día dejan un tramo vacío, que se descarta.
 */
export function tramosEnCargo(grupoActual: GrupoCda, cambios: CambioCargo[], grupo: GrupoCda): Tramo[] {
  const tramos: (Tramo & { grupo: GrupoCda })[] = [];
  let actual: Tramo & { grupo: GrupoCda } = { grupo: cambios[0]?.grupoAnterior ?? grupoActual, desde: null, hasta: null };
  for (const c of cambios) {
    tramos.push({ ...actual, hasta: diaAnterior(c.desde) });
    actual = { grupo: c.grupoNuevo, desde: c.desde, hasta: null };
  }
  tramos.push(actual);
  return tramos
    .filter((t) => t.grupo === grupo && !(t.desde && t.hasta && t.desde > t.hasta))
    .map(({ desde, hasta }) => ({ desde, hasta }));
}

export function enTramos(tramos: Tramo[], dia: string): boolean {
  return tramos.some((t) => (!t.desde || t.desde <= dia) && (!t.hasta || dia <= t.hasta));
}

/**
 * Personal activo que estuvo en `grupo` en algún momento (su cargo actual o
 * uno anterior), con los tramos de ese cargo. Los reportes usan esto para que
 * la asistencia anterior a un cambio quede en el cargo de antes.
 */
export async function personalDelCargo(prisma: PrismaService, grupo: GrupoCda) {
  const operadores = await prisma.operadorCda.findMany({
    where: {
      activo: true,
      OR: [{ grupo }, { cambiosCargo: { some: { OR: [{ grupoAnterior: grupo }, { grupoNuevo: grupo }] } } }],
    },
    orderBy: { apellidosNombres: 'asc' },
    include: { cambiosCargo: { orderBy: [{ desde: 'asc' }, { creadoEn: 'asc' }] } },
  });
  return operadores
    .map(({ cambiosCargo, ...o }) => ({
      operador: o,
      tramos: tramosEnCargo(
        o.grupo,
        cambiosCargo.map((c) => ({ grupoAnterior: c.grupoAnterior, grupoNuevo: c.grupoNuevo, desde: diaDeFechaDb(c.desde) })),
        grupo,
      ),
    }))
    .filter((p) => p.tramos.length > 0);
}
