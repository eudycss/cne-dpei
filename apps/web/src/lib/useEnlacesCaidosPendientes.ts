import { useQueryClient, useQuery } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { NotificacionItem } from '@cne/shared-types';
import {
  getMisNotificaciones,
  marcarNotificacionLeida,
  type NotificacionesMineResponse,
} from './notifications';

/**
 * Notificaciones ENLACE_CAIDO sin leer, para el banner persistente de
 * Layout.tsx. Consulta aparte de la lista paginada de la campanita (10
 * ítems, la más reciente primero): si el usuario acumula 10+ notificaciones
 * más nuevas que un enlace caído sin leer, este quedaría fuera de esa
 * página y el banner jamás lo mostraría. `soloNoLeidas` con un pageSize
 * amplio evita depender de esa paginación.
 */
export function useEnlacesCaidosPendientes(opts: { enabled: boolean }) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['notificaciones-enlace-caido-pendientes'],
    queryFn: () => getMisNotificaciones({ soloNoLeidas: true, pageSize: 100 }),
    refetchInterval: 30_000,
    enabled: opts.enabled,
  });

  const pendientes = (data?.items ?? []).filter(
    (n) => n.tipoEvento === 'ENLACE_CAIDO' && !n.leidaEn,
  );

  async function confirmar() {
    const objetivo = pendientes;
    // allSettled (no all): si un PATCH falla no debe perderse la confirmación
    // de los demás — las que sí se confirman se cierran, las que fallan
    // siguen en el banner (nunca se descartan silenciosamente).
    const resultados = await Promise.allSettled(
      objetivo.map((n) => marcarNotificacionLeida(n.id).then(() => n.id)),
    );
    const confirmadas = new Set(
      resultados
        .filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled')
        .map((r) => r.value),
    );
    const marcarComoLeida = (n: NotificacionItem) =>
      confirmadas.has(n.id) ? { ...n, leidaEn: new Date().toISOString() } : n;

    // También actualiza la cache de la lista paginada de la campanita: comparten
    // notificaciones, así que confirmar aquí debe reflejarse ahí también.
    queryClient.setQueryData<NotificacionesMineResponse>(['notificaciones-mias'], (prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map(marcarComoLeida),
            noLeidas: Math.max(0, prev.noLeidas - confirmadas.size),
          }
        : prev,
    );
    queryClient.setQueryData<NotificacionesMineResponse>(
      ['notificaciones-enlace-caido-pendientes'],
      (prev) =>
        prev
          ? {
              ...prev,
              items: prev.items.map(marcarComoLeida),
              noLeidas: Math.max(0, prev.noLeidas - confirmadas.size),
            }
          : prev,
    );

    if (confirmadas.size < objetivo.length) {
      sileo.error({ title: 'No se pudieron confirmar todos los enlaces. Volvé a intentar.' });
    }
  }

  return { pendientes, confirmar };
}
