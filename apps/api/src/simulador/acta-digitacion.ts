import { randomInt } from 'node:crypto';

/** Entero aleatorio en [min, max] (ambos incluidos). Inyectable en las pruebas. */
export type Azar = (min: number, max: number) => number;
export const azarSeguro: Azar = (min, max) => randomInt(min, max + 1);

export interface ConfigActa {
  filasPorActa: number;
  votoMin: number;
  votoMax: number;
  /** 0-100: probabilidad de que los dígitos de una fila no coincidan con las letras. */
  pctDigitosDistintos: number;
}

/**
 * Cambia un solo casillero (como un error de escritura en el acta): el número
 * mostrado siempre es distinto del correcto y sigue entre 000 y 999.
 */
export function digitoCambiado(valor: number, azar: Azar): number {
  const casilleros = String(valor).padStart(3, '0').split('').map(Number);
  const pos = azar(0, 2);
  casilleros[pos] = (casilleros[pos] + azar(1, 9)) % 10;
  return Number(casilleros.join(''));
}

/** Valores correctos (lo que dicen las letras) y lo que muestran los casilleros. */
export function generarActa(cfg: ConfigActa, azar: Azar = azarSeguro): { valores: number[]; digitos: number[] } {
  const valores: number[] = [];
  const digitos: number[] = [];
  for (let i = 0; i < cfg.filasPorActa; i++) {
    const v = azar(cfg.votoMin, cfg.votoMax);
    valores.push(v);
    const distinto = cfg.pctDigitosDistintos > 0 && azar(1, 100) <= cfg.pctDigitosDistintos;
    digitos.push(distinto ? digitoCambiado(v, azar) : v);
  }
  return { valores, digitos };
}

/** Índices de las filas que no coinciden con lo correcto (vacía o faltante = incorrecta). */
export function filasIncorrectas(correctos: readonly number[], digitado: readonly (number | null)[]): number[] {
  return correctos.flatMap((v, i) => (digitado[i] === v ? [] : [i]));
}

/** Registros de un acta: filas no vacías, y de esas las que coinciden con las letras. */
export function conteoFilas(
  correctos: readonly number[],
  digitado: readonly (number | null)[],
): { digitadas: number; correctas: number } {
  let digitadas = 0;
  let correctas = 0;
  correctos.forEach((v, i) => {
    const d = digitado[i];
    if (d === null || d === undefined || d < 0) return;
    digitadas++;
    if (d === v) correctas++;
  });
  return { digitadas, correctas };
}

/** Para guardar en Int[]: una casilla vacía o faltante queda como -1. */
export const comoGuardado = (filas: number, digitado: readonly (number | null)[]) =>
  Array.from({ length: filas }, (_, i) => digitado[i] ?? -1);
