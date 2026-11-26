import { FormEvent, useMemo, useState } from 'react';
import type { Kit, Recinto, User } from '@cne/shared-types';
import { asignarKitSchema } from '@cne/shared-validation';
import { api } from '../../lib/api';
import { SearchableSelect } from '../../components/SearchableSelect';

// ─── Modal asignar kit ────────────────────────────────────────────────────────

export function AsignarKitModal({
  kit,
  operadores,
  recintoLabel,
  onClose,
  onDone,
}: {
  kit: Kit;
  operadores: User[];
  recintoLabel: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [operadorId, setOperadorId] = useState(kit.operadorId ?? '');
  const [justificacion, setJustificacion] = useState('');
  const [frozen, setFrozen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const operadorOptions = useMemo(
    () =>
      operadores.map((u) => ({
        value: u.id,
        label: `${u.nombres} ${u.apellidos}`,
        sublabel: u.cedula,
      })),
    [operadores],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = asignarKitSchema.safeParse({
      operadorId,
      justificacion: justificacion.trim() || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/kits/${kit.id}/asignar`, parsed.data);
      onDone();
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.frozen) setFrozen(true);
      setError(data?.message ?? 'No se pudo asignar el kit');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="center modal-desplazable" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10 }}>
      <form className="login-card" style={{ maxWidth: 480, width: '100%' }} onSubmit={onSubmit}>
        <h1>Asignar kit</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Kit <strong>{kit.codigoUnico}</strong> — {kit.nombre}
        </p>
        <p className="muted" style={{ marginTop: 0 }}>
          Recinto: <strong>{recintoLabel ?? '—'}</strong>
        </p>

        <div className="field">
          <label id="kits-operador">Operador</label>
          <SearchableSelect labelId="kits-operador"
            options={operadorOptions}
            value={operadorId}
            onChange={setOperadorId}
            placeholder="— Selecciona un operador —"
            searchPlaceholder="Busca por nombre o cédula…"
            required
          />
        </div>

        {frozen && (
          <div className="field">
            <label htmlFor="kits-justificacion-requerida">Justificación (requerida)</label>
            <textarea id="kits-justificacion-requerida"
              value={justificacion}
              onChange={(e) => setJustificacion(e.target.value)}
              rows={3}
              maxLength={500}
              required
              placeholder="La jornada electoral ya inició: explica por qué se necesita este cambio…"
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
        )}

        {error && <div className="banner error">{error}</div>}

        <div className="modal-acciones">
          <button type="button" className="btn secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Guardando…' : 'Asignar'}
          </button>
        </div>
      </form>
    </div>
  );
}
