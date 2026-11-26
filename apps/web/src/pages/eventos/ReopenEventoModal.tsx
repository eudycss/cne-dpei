import { FormEvent, useState } from 'react';
import type { EventoElectoral } from '@cne/shared-types';
import { reopenEventoSchema } from '@cne/shared-validation';
import { api } from '../../lib/api';
import { Modal } from '../../components/Modal';

// ─── Modal reabrir evento (solo consulta) ─────────────────────────────────────

export function ReopenEventoModal({
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
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = reopenEventoSchema.safeParse({ justificacion });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Justificación inválida');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/eventos/${evento.id}/reopen`, parsed.data);
      onDone();
    } catch (err: any) {
      const m = err?.response?.data?.message;
      setError(Array.isArray(m) ? m.join(' ') : typeof m === 'string' ? m : 'No se pudo reabrir el evento');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal labelledBy="reabrir-titulo" onClose={onClose}>
      <form className="login-card" style={{ width: '100%' }} onSubmit={onSubmit}>
        <h1 id="reabrir-titulo">Reabrir evento</h1>
        <p>
          El evento <strong>"{evento.nombre}"</strong> volverá a estar activo solo para
          consultar sus datos e informes.
        </p>
        <div id="reabrir-aviso" className="banner" role="note">
          Mientras esté reabierto, la app móvil no podrá registrar acciones y no se generarán
          alertas. Ciérrelo de nuevo cuando termine.
        </div>

        <div className="field">
          <label htmlFor="reabrir-justificacion">Justificación (requerida)</label>
          <div id="reabrir-ayuda" className="muted" style={{ fontSize: '0.78rem' }}>
            Entre 10 y 500 caracteres.
          </div>
          <textarea
            id="reabrir-justificacion"
            value={justificacion}
            onChange={(e) => setJustificacion(e.target.value)}
            rows={3}
            maxLength={500}
            required
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={`reabrir-ayuda reabrir-aviso${error ? ' reabrir-error' : ''}`}
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

        {error && (
          <div id="reabrir-error" className="banner error" role="alert">
            {error}
          </div>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Reabriendo…' : 'Reabrir'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
