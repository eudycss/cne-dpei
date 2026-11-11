import type { CercaniaRetorno } from '@cne/shared-types';

/** Le falta más de esta parte del camino recinto → DPEI: "Lejos". */
export const FRACCION_LEJOS = 0.5;
/** Le falta esta parte del camino o menos: "Muy cerca". */
export const FRACCION_MUY_CERCA = 0.15;
/** A esta distancia del DPEI o menos siempre es "Muy cerca", aunque el recinto quede al lado. */
export const METROS_MUY_CERCA = 2000;

/**
 * Qué tan cerca del DPEI va un operador en retorno, según la parte del camino
 * (en línea recta, desde su recinto) que le falta. Sin la distancia actual no
 * se puede medir; sin la del recinto solo vale el umbral fijo de metros.
 */
export function cercaniaRetorno(faltaMetros: number | null, totalMetros: number | null): CercaniaRetorno | null {
  if (faltaMetros === null || !Number.isFinite(faltaMetros)) return null;
  if (faltaMetros <= METROS_MUY_CERCA) return 'MUY_CERCA';
  if (totalMetros === null || !Number.isFinite(totalMetros) || totalMetros <= 0) return null;
  const fraccion = faltaMetros / totalMetros;
  if (fraccion <= FRACCION_MUY_CERCA) return 'MUY_CERCA';
  return fraccion > FRACCION_LEJOS ? 'LEJOS' : 'CERCA';
}
