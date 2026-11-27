import { FormEvent, useState } from 'react';
import type { EventoElectoral } from '@cne/shared-types';
import { api } from '../../lib/api';
import { Modal } from '../../components/Modal';

// ─── Modal cerrar evento ──────────────────────────────────────────────────────

export function CloseEventoModal({
  evento,
  onClose,
  onDone,
}: {
  evento: EventoElectoral;
  onClose: () => void;
  onDone: () => void;
}) {
  const [justificacion, setJustificacion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendientes, setPendientes] = useState<Array<{ id: string; nombre: string }>>([]);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPendientes([]);
    setSaving(true);
    try {
      await api.post(`/eventos/${evento.id}/close`, {
        confirmar: true,
        justificacion: justificacion.trim() || undefined,
      });
      onDone();
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.pendientes) {
        setPendientes(data.pendientes);
        setError(data.message);
      } else {
        setError(data?.message ?? 'No se pudo cerrar el evento');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal labelledBy="cerrar-evento-titulo" onClose={onClose}>
      <form className="login-card" style={{ width: '100%' }} onSubmit={onSubmit}>
        <h1 id="cerrar-evento-titulo">Cerrar evento</h1>
        <p>
          Estás a punto de cerrar el evento{' '}
          <strong>"{evento.nombre}"</strong>. Después solo podrá reabrirse para consulta.
        </p>

        {pendientes.length > 0 && (
          <div className="banner error">
            <strong>{pendientes.length} operador(es) sin llegada a la DPEI:</strong>
            <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
              {pendientes.map((p) => (
                <li key={p.id}>{p.nombre}</li>
              ))}
            </ul>
            <p style={{ margin: '0.5rem 0 0' }}>
              Proporciona una justificación para continuar el cierre.
            </p>
          </div>
        )}

        <div className="field">
          <label>
            Justificación{pendientes.length > 0 ? ' (requerida)' : ' (opcional)'}
          </label>
          <textarea
            value={justificacion}
            onChange={(e) => setJustificacion(e.target.value)}
            rows={3}
            maxLength={1000}
            required={pendientes.length > 0}
            style={{
              width: '100%',
              padding: '0.5rem 0.65rem',
              border: '1px solid var(--border-input)',
              borderRadius: 6,
              fontSize: '0.9rem',
              resize: 'vertical',
            }}
          />
        </div>

        {error && pendientes.length === 0 && (
          <div className="banner error">{error}</div>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn danger" disabled={saving}>
            {saving ? 'Cerrando…' : 'Confirmar cierre'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
