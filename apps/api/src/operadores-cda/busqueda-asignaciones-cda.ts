import type { AsignacionPersonaCda, BusquedaAsignacionesCda, GrupoCda } from '@cne/shared-types';

/** Hasta tantas personas y tantos recintos por búsqueda. */
export const MAX_RESULTADOS_ASIGNACIONES = 20;

export interface PersonaBuscada {
  id: string;
  apellidosNombres: string;
  cedula: string;
  grupo: GrupoCda;
}

export interface RecintoBuscado {
  id: string;
  codigoRecinto: string;
  nombre: string;
}

/** Una pareja de cualquier fecha, con la fecha ya en "AAAA-MM-DD". */
export interface ParejaBuscada {
  fecha: string;
  recinto: RecintoBuscado | null;
  operador: { id: string; apellidosNombres: string };
  asistente: { id: string; apellidosNombres: string } | null;
  kit: { codigoUnico: string } | null;
}

const porFechaDesc = (a: { fecha: string }, b: { fecha: string }) => b.fecha.localeCompare(a.fecha);

/**
 * Arma "¿Quién fue a dónde?": cada persona con las veces que estuvo en una
 * pareja (dónde, con quién y si fue de operador o asistente) y cada CDA con
 * quiénes fueron. `noCdasPorCda`: los NO CDA buscados, bajo su CDA.
 */
export function armarBusquedaAsignaciones(
  personas: PersonaBuscada[],
  cdas: RecintoBuscado[],
  noCdasPorCda: Map<string, { codigo: string; nombre: string }[]>,
  parejas: ParejaBuscada[],
  truncado = false,
): BusquedaAsignacionesCda {
  const ordenadas = [...parejas].sort(porFechaDesc);
  const recintoDe = (p: ParejaBuscada) => (p.recinto ? { codigo: p.recinto.codigoRecinto, nombre: p.recinto.nombre } : null);
  return {
    truncado: truncado || personas.length > MAX_RESULTADOS_ASIGNACIONES || cdas.length > MAX_RESULTADOS_ASIGNACIONES,
    personas: personas.slice(0, MAX_RESULTADOS_ASIGNACIONES).map((persona) => ({
      ...persona,
      asignaciones: ordenadas.flatMap((p): AsignacionPersonaCda[] => {
        if (p.operador.id === persona.id) {
          return [{ fecha: p.fecha, recinto: recintoDe(p), como: 'OPERADOR', pareja: p.asistente?.apellidosNombres ?? null }];
        }
        if (p.asistente?.id === persona.id) {
          return [{ fecha: p.fecha, recinto: recintoDe(p), como: 'ASISTENTE', pareja: p.operador.apellidosNombres }];
        }
        return [];
      }),
    })),
    recintos: cdas.slice(0, MAX_RESULTADOS_ASIGNACIONES).map((cda) => ({
      id: cda.id,
      codigo: cda.codigoRecinto,
      nombre: cda.nombre,
      noCdas: noCdasPorCda.get(cda.id) ?? [],
      asignaciones: ordenadas
        .filter((p) => p.recinto?.id === cda.id)
        .map((p) => ({
          fecha: p.fecha,
          operador: p.operador.apellidosNombres,
          asistente: p.asistente?.apellidosNombres ?? null,
          kit: p.kit?.codigoUnico ?? null,
        })),
    })),
  };
}
