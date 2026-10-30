import { FormEvent, useState } from 'react';
import { llegadaDpiManualSchema } from '@cne/shared-validation';

import { Modal } from '../../components/Modal';
import { registrarLlegadaDpiManual } from '../../lib/queries/monitoreo';

/**
 * El operador olvidó marcar "Llegada al DPEI" y sigue en el mapa: el
 * administrador la registra con un motivo. A diferencia de "Resetear estado",
 * no borra el recorrido; la llegada queda marcada como registrada por él.
 */
export function RegistrarLlegadaDpiModal({
  operador,
  onClose,
  onDone,
}: {
  /** id = usuario del operador. */
  operador: { id: string; nombre: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = llegadaDpiManualSchema.safeParse({ motivo });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Motivo inválido');
      return;
    }
    setSaving(true);
    try {
      await registrarLlegadaDpiManual(operador.id, parsed.data.motivo);
      onDone();
    } catch (err: unknown) {
      const mensaje = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(mensaje ?? 'No se pudo registrar la llegada');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal labelledBy="llegada-dpi-titulo" onClose={onClose}>
      <form className="login-card" style={{ width: '100%' }} onSubmit={onSubmit} noValidate>
        <h1 id="llegada-dpi-titulo">Registrar llegada al DPEI</h1>
        <p>
          <strong>{operador.nombre}</strong> no marcó su llegada en la app. Se registrará con la hora actual y
          saldrá del mapa.
        </p>
        <div id="llegada-dpi-aviso" className="banner" role="note">
          No se borra su recorrido: la llegada queda en el historial y en el informe como registrada por el
          administrador, y sus kits pasan a "Llegó al DPEI".
        </div>

        <div className="field">
          <label htmlFor="llegada-dpi-motivo">Motivo (requerido)</label>
          <div id="llegada-dpi-ayuda" className="muted" style={{ fontSize: '0.78rem' }}>
            Entre 5 y 500 caracteres.
          </div>
          <textarea
            id="llegada-dpi-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={3}
            maxLength={500}
            required
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={`llegada-dpi-ayuda llegada-dpi-aviso${error ? ' llegada-dpi-error' : ''}`}
            placeholder="Ej.: llegó a la Delegación y entregó el kit, pero olvidó marcarlo en la app"
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
          <div id="llegada-dpi-error" className="banner error" role="alert">
            {error}
          </div>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Registrando…' : 'Registrar llegada'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
