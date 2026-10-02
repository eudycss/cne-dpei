import type { EstadoOperadorCda } from '@cne/shared-types';

export const ESTADO_INFO: Record<EstadoOperadorCda, { label: string; color: string }> = {
  EN_DPI: { label: 'En DPI', color: '#9ca3af' },
  EN_TRANSITO: { label: 'En tránsito', color: '#7c3aed' },
  EN_RECINTO: { label: 'En el recinto', color: '#f59e0b' },
  EN_RETORNO: { label: 'En retorno', color: '#2563eb' },
  RETORNADO: { label: 'Llegó al DPEI', color: '#16a34a' },
};

/** Orden de la jornada, de la salida a la llegada. */
export const ORDEN_ESTADOS = Object.keys(ESTADO_INFO) as EstadoOperadorCda[];

export type ConteoEstados = Partial<Record<EstadoOperadorCda, number>>;
