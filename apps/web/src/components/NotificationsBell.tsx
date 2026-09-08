import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { SlotText } from 'slot-text/react';
import 'slot-text/style.css';
import type { NotificacionItem } from '@cne/shared-types';
import {
  describirNotificacion,
  formatearFechaHora,
  getMisNotificaciones,
  marcarNotificacionLeida,
} from '../lib/notifications';

const PAGE_SIZE = 10;

export function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [items, setItems] = useState<NotificacionItem[]>([]);
  const [noLeidas, setNoLeidas] = useState(0);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [cargandoMas, setCargandoMas] = useState(false);

  // Mientras el dropdown está abierto no pisamos la lista con el resultado
  // del polling/refetch-on-focus: si el usuario ya cargó más páginas con
  // "Cargar más", un refresh la recortaría de vuelta a la primera. Se usa un
  // ref (no el estado `open` en las deps) para que el sync solo se dispare
  // cuando llega un fetch nuevo, y no también al simplemente cerrar el
  // dropdown (lo que revertiría ediciones optimistas hechas mientras estaba
  // abierto, ej. marcar como leída).
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const { data } = useQuery({
    queryKey: ['notificaciones-mias'],
    queryFn: () => getMisNotificaciones({ pageSize: PAGE_SIZE }),
    refetchInterval: open ? false : 30_000,
    refetchOnWindowFocus: !open,
  });

  useEffect(() => {
    if (!data || openRef.current) return;
    setItems(data.items);
    setNoLeidas(data.noLeidas);
    setTotal(data.total);
    setPage(1);
  }, [data]);

  const markRead = useMutation({
    mutationFn: (id: string) => marcarNotificacionLeida(id),
  });

  function marcarLeida(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, leidaEn: new Date().toISOString() } : n)));
    setNoLeidas((prev) => Math.max(0, prev - 1));
    markRead.mutate(id);
  }

  async function cargarMas() {
    setCargandoMas(true);
    try {
      const siguiente = page + 1;
      const res = await getMisNotificaciones({ pageSize: PAGE_SIZE, page: siguiente });
      setItems((prev) => [...prev, ...res.items]);
      setTotal(res.total);
      setPage(siguiente);
    } catch {
      // el usuario puede reintentar tocando "Cargar más" de nuevo
    } finally {
      setCargandoMas(false);
    }
  }

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

  const hayMas = items.length < total;

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
            <>
              <ul className="notif-list">
                {items.map((n) => (
                  <li
                    key={n.id}
                    className={`notif-item ${n.leidaEn ? 'read' : 'unread'}`}
                    onClick={() => {
                      if (!n.leidaEn) marcarLeida(n.id);
                    }}
                  >
                    <div className="notif-text">{describirNotificacion(n)}</div>
                    <div className="notif-meta">{formatearFechaHora(n.creadoEn)}</div>
                  </li>
                ))}
              </ul>
              {hayMas ? (
                <button
                  type="button"
                  className="notif-cargar-mas"
                  onClick={cargarMas}
                  disabled={cargandoMas}
                  aria-busy={cargandoMas}
                >
                  {cargandoMas ? 'Cargando…' : 'Cargar más'}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
