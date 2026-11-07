import type { OrigenTiempoViaje, TiempoViajeRecinto } from '@cne/shared-types';

/** Viajes medidos de un recinto: el más largo (ida o vuelta) y cuántos hubo. */
export interface MedicionRecinto {
  maxMin: number;
  viajes: number;
}

export interface RecintoTiempo {
  id: string;
  codigo: string;
  nombre: string;
  canton: string;
  tiempoMin: number | null;
}

/** Hacia arriba al múltiplo de 5: 47 → 50 (un límite "redondo" es más fácil de leer y ajustar). */
export const redondearA5 = (min: number) => Math.ceil(min / 5) * 5;

/**
 * Tiempo sugerido de cada CDA: el viaje más largo medido + el margen; sin
 * historial, el promedio de lo medido en su cantón + el margen; si el cantón
 * tampoco tiene viajes, no hay sugerido.
 */
export function sugerirTiempos(
  recintos: RecintoTiempo[],
  medidos: Map<string, MedicionRecinto>,
  margenMin: number,
): TiempoViajeRecinto[] {
  const porCanton = new Map<string, number[]>();
  for (const r of recintos) {
    const m = medidos.get(r.id);
    if (!m) continue;
    porCanton.set(r.canton, [...(porCanton.get(r.canton) ?? []), m.maxMin]);
  }
  return recintos.map((r) => {
    const m = medidos.get(r.id);
    const delCanton = porCanton.get(r.canton);
    let sugeridoMin: number | null = null;
    let origenSugerido: OrigenTiempoViaje | null = null;
    if (m) {
      sugeridoMin = redondearA5(m.maxMin + margenMin);
      origenSugerido = 'MEDIDO';
    } else if (delCanton?.length) {
      const promedio = delCanton.reduce((a, b) => a + b, 0) / delCanton.length;
      sugeridoMin = redondearA5(promedio + margenMin);
      origenSugerido = 'CANTON';
    }
    return {
      ...r,
      medidoMaxMin: m ? Math.round(m.maxMin) : null,
      viajesMedidos: m?.viajes ?? 0,
      sugeridoMin,
      origenSugerido,
    };
  });
}
