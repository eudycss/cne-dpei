import type { CercaniaRetorno, EstadoOperadorCda, OperadorEnRetorno } from '@cne/shared-types';

export const ESTADO_INFO: Record<EstadoOperadorCda, { label: string; color: string }> = {
  EN_DPI: { label: 'En DPI', color: '#9ca3af' },
  EN_TRANSITO: { label: 'En tránsito', color: '#7c3aed' },
  EN_RECINTO: { label: 'En el recinto', color: '#f59e0b' },
  EN_RETORNO: { label: 'En retorno', color: '#2563eb' },
  RETORNADO: { label: 'Llegó al DPEI', color: '#16a34a' },
};

/**
 * En retorno, el color pasa del azul al cian y al lima a medida que se acerca (tonos bien separados,
 * también con daltonismo; quien ya llegó sale del mapa, así que el lima no se confunde con su verde).
 * Siempre va con su texto: el color nunca es la única pista (WCAG 1.4.1).
 * Los tramos (km al DPEI en línea recta) son los de la API: apps/api/src/tracking/cercania-retorno.ts.
 */
export const CERCANIA_INFO: Record<CercaniaRetorno, { label: string; color: string; rango: string }> = {
  LEJOS: { label: 'Lejos', color: '#1e40af', rango: 'más de 10 km' },
  CERCA: { label: 'Cerca', color: '#0891b2', rango: '3 a 10 km' },
  MUY_CERCA: { label: 'Muy cerca', color: '#65a30d', rango: '3 km o menos' },
};

export const ORDEN_CERCANIA: CercaniaRetorno[] = ['LEJOS', 'CERCA', 'MUY_CERCA'];

/** Orden de la jornada, de la salida a la llegada. */
export const ORDEN_ESTADOS = Object.keys(ESTADO_INFO) as EstadoOperadorCda[];

export type ConteoEstados = Partial<Record<EstadoOperadorCda, number>>;

type OperadorEnRuta = Pick<OperadorEnRetorno, 'estado' | 'cercania' | 'faltaMetros'>;

/** Color del operador en el mapa y la lista: en retorno, según qué tan cerca va del DPEI. */
export function colorOperador(o: OperadorEnRuta): string {
  return o.estado === 'EN_RETORNO' && o.cercania ? CERCANIA_INFO[o.cercania].color : ESTADO_INFO[o.estado].color;
}

/** "En retorno · Muy cerca (1,2 km del DPEI)"; sin datos para medir queda solo el estado. */
export function etiquetaOperador(o: OperadorEnRuta): string {
  const estado = ESTADO_INFO[o.estado].label;
  if (o.estado !== 'EN_RETORNO' || !o.cercania) return estado;
  const km = o.faltaMetros === null ? '' : ` (${(o.faltaMetros / 1000).toLocaleString('es-EC', { maximumFractionDigits: 1 })} km del DPEI)`;
  return `${estado} · ${CERCANIA_INFO[o.cercania].label}${km}`;
}
