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
 * Hoy solo se conoce SALIDA_DPI; otros tipos llegarán con HU3+.
 */
export function describirNotificacion(n: NotificacionItem): string {
  const p = n.payload ?? {};
  switch (n.tipoEvento) {
    case 'SALIDA_DPI': {
      const operador = (p.operadorNombre as string) ?? 'Un operador';
      const recinto = (p.recintoNombre as string) ?? 'su recinto';
      return `${operador} salió del DPI hacia ${recinto}`;
    }
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
