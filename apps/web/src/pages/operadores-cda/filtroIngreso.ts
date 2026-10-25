import type { OperadorCda } from '@cne/shared-types';

/** Parámetros de la URL del filtro por fecha de ingreso del listado. */
export const FILTROS_INGRESO = ['ingresoDesde', 'ingresoHasta', 'sinFecha'] as const;

/** Valor de la URL -> fecha AAAA-MM-DD, o '' si falta o no tiene ese formato (enlace editado a mano). */
export function fechaDeUrl(v: string | null): string {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

export interface FiltroIngreso {
  /** AAAA-MM-DD o '' (sin límite). */
  desde: string;
  hasta: string;
  /** Con un rango activo, incluir también a quienes no tienen fecha de ingreso. */
  incluirSinFecha: boolean;
}

/** "desde" posterior a "hasta": no se filtra y se avisa. */
export function rangoIngresoInvalido({ desde, hasta }: FiltroIngreso): boolean {
  return desde !== '' && hasta !== '' && desde > hasta;
}

/**
 * ¿Pasa el filtro? Sin rango (o con rango inválido) pasan todos. Las fechas
 * AAAA-MM-DD se comparan como texto: el orden alfabético es el cronológico.
 */
export function cumpleIngreso(o: Pick<OperadorCda, 'fechaInicio'>, f: FiltroIngreso): boolean {
  if ((!f.desde && !f.hasta) || rangoIngresoInvalido(f)) return true;
  if (!o.fechaInicio) return f.incluirSinFecha;
  return (!f.desde || o.fechaInicio >= f.desde) && (!f.hasta || o.fechaInicio <= f.hasta);
}

export type OrdenListado = 'lista' | 'ingreso-reciente' | 'ingreso-antiguo';

/** Ordena por fecha de ingreso (los sin fecha al final); 'lista' deja el orden de la API. */
export function ordenarPorIngreso<T extends Pick<OperadorCda, 'fechaInicio'>>(lista: T[], orden: OrdenListado): T[] {
  if (orden === 'lista') return lista;
  const signo = orden === 'ingreso-reciente' ? -1 : 1;
  return [...lista].sort((a, b) => {
    if (!a.fechaInicio || !b.fechaInicio) return (a.fechaInicio ? 0 : 1) - (b.fechaInicio ? 0 : 1);
    return a.fechaInicio === b.fechaInicio ? 0 : (a.fechaInicio < b.fechaInicio ? -1 : 1) * signo;
  });
}
