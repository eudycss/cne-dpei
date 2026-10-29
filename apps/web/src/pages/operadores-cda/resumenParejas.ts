import type { AplicarParejasCdaResult } from '@cne/shared-types';

/** Resumen legible del paso de parejas a la app (para el aviso tras guardar). */
export function resumenApp(r: AplicarParejasCdaResult): { title: string; description?: string } {
  const partes = [`${r.enApp} en la app`];
  if (r.kitsCreados) partes.push(`${r.kitsCreados} kit(s) nuevo(s)`);
  if (r.sinKit) partes.push(`${r.sinKit} sin kit (faltan artículos)`);
  if (r.soloRegistradas) partes.push(`${r.soloRegistradas} solo registrada(s)`);
  return {
    title: partes.join(' · '),
    description: r.errores.length ? r.errores.map((e) => `${e.pareja}: ${e.error}`).join(' — ') : undefined,
  };
}
