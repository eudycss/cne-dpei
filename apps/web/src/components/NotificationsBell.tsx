import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SlotText } from 'slot-text/react';
import 'slot-text/style.css';
import {
  describirNotificacion,
  formatearFechaHora,
  getMisNotificaciones,
  marcarNotificacionLeida,
} from '../lib/notifications';

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['notificaciones-mias'],
    queryFn: () => getMisNotificaciones({ pageSize: 10 }),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => marcarNotificacionLeida(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notificaciones-mias'] }),
  });

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const noLeidas = data?.noLeidas ?? 0;
  const items = data?.items ?? [];

  return (
    <div className="notif-wrap" ref={wrapRef}>
      <button
        type="button"
        className="notif-button"
        aria-label="Notificaciones"
        onClick={() => setOpen((v) => !v)}
      >
        <Bell size={18} />
        {noLeidas > 0 ? (
          <span className="notif-badge">
            <SlotText text={noLeidas > 99 ? '99+' : String(noLeidas)} />
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="notif-dropdown" role="dialog" aria-label="Notificaciones">
          <div className="notif-header">
            <strong>Notificaciones</strong>
            <span className="muted">{noLeidas} sin leer</span>
          </div>
          {items.length === 0 ? (
            <div className="notif-empty">No tienes notificaciones aún.</div>
          ) : (
            <ul className="notif-list">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={`notif-item ${n.leidaEn ? 'read' : 'unread'}`}
                  onClick={() => {
                    if (!n.leidaEn) markRead.mutate(n.id);
                  }}
                >
                  <div className="notif-text">{describirNotificacion(n)}</div>
                  <div className="notif-meta">{formatearFechaHora(n.creadoEn)}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
