import { useState } from 'react';
import type { NotificacionItem } from '@cne/shared-types';
import { describirNotificacion, formatearFechaHora } from '../lib/notifications';

interface Props {
  items: NotificacionItem[];
  onConfirmar: () => Promise<void>;
}

/**
 * Aviso de enlaces caídos que no se cierra solo ni se puede descartar sin
 * confirmar, pero NO bloquea el resto de la app (a diferencia de un modal):
 * el usuario puede seguir navegando y usando otras pantallas mientras
 * resuelve la caída. Reaparece mientras la notificación siga sin leer en el
 * backend, así sobrevive a un F5.
 */
export function EnlaceCaidoBanner({ items, onConfirmar }: Props) {
  const [confirmando, setConfirmando] = useState(false);

  async function handleConfirmar() {
    setConfirmando(true);
    try {
      await onConfirmar();
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <div
      role="alert"
      style={{
        background: '#7f1d1d',
        color: '#fff',
        padding: '0.65rem 1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        flexWrap: 'wrap',
      }}
    >
      <strong style={{ whiteSpace: 'nowrap' }}>
        {items.length > 1 ? `${items.length} enlaces caídos` : 'Enlace caído'}
      </strong>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', gap: '1rem', flexWrap: 'wrap', flex: 1 }}>
        {items.map((n) => (
          <li key={n.id} style={{ fontSize: '0.85rem' }}>
            {describirNotificacion(n)}
            <span style={{ opacity: 0.8, marginLeft: '0.35rem' }}>({formatearFechaHora(n.creadoEn)})</span>
          </li>
        ))}
      </ul>
      <button
        className="btn"
        style={{ background: '#fff', color: '#7f1d1d', whiteSpace: 'nowrap' }}
        onClick={handleConfirmar}
        disabled={confirmando}
      >
        {confirmando ? 'Confirmando…' : 'Ya notifiqué'}
      </button>
    </div>
  );
}
