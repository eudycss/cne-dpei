import type { NotificacionItem } from '@cne/shared-types';
import { api } from './api';

export interface NotificacionesMineResponse {
  items: NotificacionItem[];
  total: number;
  noLeidas: number;
}

export async function getMisNotificaciones(opts?: {
  soloNoLeidas?: boolean;
  pageSize?: number;
}): Promise<NotificacionesMineResponse> {
  const params = new URLSearchParams();
  if (opts?.soloNoLeidas) params.set('soloNoLeidas', 'true');
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize));
  const qs = params.toString();
  const { data } = await api.get<NotificacionesMineResponse>(
    `/notificaciones/mias${qs ? `?${qs}` : ''}`,
  );
  return data;
}

export async function marcarNotificacionLeida(id: string): Promise<void> {
  await api.patch(`/notificaciones/${id}/leida`);
}

/**
 * Formatea el payload de una notificación según su tipoEvento.
 * Conoce SALIDA_DPI (HU2), LLEGADA_RECINTO (HU3) y SALIDA_RECINTO (HU4).
 */
export function describirNotificacion(n: NotificacionItem): string {
  const p = n.payload ?? {};
  const operador = (p.operadorNombre as string) ?? 'Un operador';
  const recinto = (p.recintoNombre as string) ?? 'su recinto';
  switch (n.tipoEvento) {
    case 'SALIDA_DPI':
      return `${operador} salió del DPI hacia ${recinto}`;
    case 'LLEGADA_RECINTO': {
      const kits = p.kitsRecibidos as number | undefined;
      const sufijo = kits != null ? ` y recibió ${kits} kit${kits === 1 ? '' : 's'}` : '';
      return `${operador} llegó a ${recinto}${sufijo}`;
    }
    case 'SALIDA_RECINTO':
      return `${operador} salió de ${recinto} e inició el retorno al DPI`;
    default:
      return n.tipoEvento;
  }
}

export function formatearFechaHora(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('es-EC', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
