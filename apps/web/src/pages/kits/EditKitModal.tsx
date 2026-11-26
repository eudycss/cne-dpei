import { FormEvent, useMemo, useState } from 'react';
import type { ItemKitCatalog, Kit, Recinto } from '@cne/shared-types';
import { editKitSchema } from '@cne/shared-validation';
import { SearchableSelect } from '../../components/SearchableSelect';
import { ContenidosKitField, aDetalleItems, contenidosDesdeKit, firmaContenidos, type ContenidosKit } from './ContenidosKitField';
import { editKit } from '../../lib/queries/kits';

// ─── Modal editar kit ─────────────────────────────────────────────────────────

export function EditKitModal({
  kit,
  recintos,
  recintosOcupados,
  itemsCatalog,
  onCatalogChanged,
  onClose,
  onDone,
}: {
  kit: Kit;
  recintos: Recinto[];
  recintosOcupados: string[];
  itemsCatalog: ItemKitCatalog[];
  onCatalogChanged: () => void;
  onClose: () => void;
  onDone: () => void;
}) {
  const [recintoId, setRecintoId] = useState(kit.recintoId ?? '');
  const [contenidos, setContenidos] = useState<ContenidosKit>(() => contenidosDesdeKit(kit));
  const [justificacion, setJustificacion] = useState('');
  const [frozen, setFrozen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const recintoOptions = useMemo(() => {
    const ocupados = new Set(recintosOcupados);
    return recintos
      .filter((r) => r.id === kit.recintoId || !ocupados.has(r.id))
      .map((r) => ({
        value: r.id,
        label: `${r.codigoRecinto} — ${r.nombre}`,
      }));
  }, [recintos, recintosOcupados, kit.recintoId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const payload: {
      recintoId?: string;
      detalleItems?: ReturnType<typeof aDetalleItems>;
      justificacion?: string;
    } = {
      justificacion: justificacion.trim() || undefined,
    };
    if (recintoId && recintoId !== (kit.recintoId ?? '')) payload.recintoId = recintoId;
    // Se manda el contenido completo (con serie/estado) solo si algo cambió.
    if (firmaContenidos(contenidos) !== firmaContenidos(contenidosDesdeKit(kit))) {
      payload.detalleItems = aDetalleItems(contenidos);
    }

    const parsed = editKitSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos');
      return;
    }
    setSaving(true);
    try {
      await editKit(kit.id, parsed.data);
      onDone();
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.frozen) setFrozen(true);
      setError(data?.message ?? 'No se pudo editar el kit');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="center modal-desplazable" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10 }}>
      <form className="login-card" style={{ maxWidth: 480, width: '100%' }} onSubmit={onSubmit}>
        <h1>Editar kit</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Kit <strong>{kit.codigoUnico}</strong> — {kit.nombre}
        </p>

        <div className="field">
          <label id="kits-recinto-cda-2">Recinto (CDA)</label>
          <SearchableSelect labelId="kits-recinto-cda-2"
            options={recintoOptions}
            value={recintoId}
            onChange={setRecintoId}
            placeholder="— Selecciona un recinto —"
            searchPlaceholder="Busca por nombre o código…"
          />
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
            Solo se muestran recintos sin otro kit asignado.
          </p>
        </div>

        <ContenidosKitField
          idTitulo="kit-contenidos-editar"
          itemsCatalog={itemsCatalog}
          value={contenidos}
          onChange={setContenidos}
          onCatalogChanged={onCatalogChanged}
          onError={setError}
        />

        {frozen && (
          <div className="field">
            <label htmlFor="kits-justificacion-requerida-2">Justificación (requerida)</label>
            <textarea id="kits-justificacion-requerida-2"
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
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  );
}
