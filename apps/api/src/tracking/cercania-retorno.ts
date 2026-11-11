import type { CercaniaRetorno } from '@cne/shared-types';

/** A esta distancia del DPEI o menos: "Muy cerca" (ya dentro de Ibarra). */
export const METROS_MUY_CERCA = 3_000;
/** A esta distancia del DPEI o menos: "Cerca" (entrando a Ibarra). Más lejos: "Lejos". */
export const METROS_CERCA = 10_000;

/**
 * Qué tan cerca del DPEI va un operador en retorno, por los metros que le faltan
 * (en línea recta). Los tramos son los mismos para todos, venga del recinto que venga,
 * para que el color diga quién llega pronto. Sin la distancia no se puede medir.
 */
export function cercaniaRetorno(faltaMetros: number | null): CercaniaRetorno | null {
  if (faltaMetros === null || !Number.isFinite(faltaMetros) || faltaMetros < 0) return null;
  if (faltaMetros <= METROS_MUY_CERCA) return 'MUY_CERCA';
  if (faltaMetros <= METROS_CERCA) return 'CERCA';
  return 'LEJOS';
}
