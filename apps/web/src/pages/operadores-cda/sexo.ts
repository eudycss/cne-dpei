import type { OperadorCda, SexoCda } from '@cne/shared-types';

export const SEXO: Record<SexoCda, string> = { M: 'Hombre', F: 'Mujer' };

/** '' = todos; SIN = sin registrar. */
export type FiltroSexo = '' | SexoCda | 'SIN';

export function cumpleSexo(o: Pick<OperadorCda, 'sexo'>, filtro: FiltroSexo): boolean {
  if (!filtro) return true;
  return filtro === 'SIN' ? !o.sexo : o.sexo === filtro;
}

export interface ConteoSexo {
  hombres: number;
  mujeres: number;
  sinRegistrar: number;
}

/** Solo personal activo (los ocultos no cuentan en el resumen). */
export function contarSexo(lista: Pick<OperadorCda, 'sexo' | 'activo'>[]): ConteoSexo {
  const c: ConteoSexo = { hombres: 0, mujeres: 0, sinRegistrar: 0 };
  for (const o of lista) {
    if (!o.activo) continue;
    if (o.sexo === 'M') c.hombres++;
    else if (o.sexo === 'F') c.mujeres++;
    else c.sinRegistrar++;
  }
  return c;
}

export function textoSexo(c: ConteoSexo): string {
  const base = `${c.hombres} hombre${c.hombres === 1 ? '' : 's'} · ${c.mujeres} mujer${c.mujeres === 1 ? '' : 'es'}`;
  return c.sinRegistrar ? `${base} · ${c.sinRegistrar} sin sexo registrado` : base;
}
