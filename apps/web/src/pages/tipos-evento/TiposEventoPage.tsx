import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TipoEventoCatalog } from '@cne/shared-types';
import { sileo } from 'sileo';
import {
  getTiposEventoAdmin,
  createTipoEvento,
  updateTipoEvento,
  deleteTipoEvento,
} from '../../lib/queries/tipos-evento';

export function TiposEventoPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<TipoEventoCatalog | null>(null);

  const { data: tipos = [], isLoading } = useQuery({
    queryKey: ['tipos-evento-admin'],
    queryFn: async () => (await getTiposEventoAdmin()).data,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['tipos-evento-admin'] });
    qc.invalidateQueries({ queryKey: ['tipos-evento'] });
  }

  async function handleToggle(t: TipoEventoCatalog) {
    try {
      await updateTipoEvento(t.id, { activo: !t.activo });
      invalidate();
      sileo.success({ title: t.activo ? 'Tipo desactivado' : 'Tipo activado' });
    } catch {
      sileo.error({ title: 'No se pudo actualizar' });
    }
  }

  async function handleDelete(t: TipoEventoCatalog) {
    if (!window.confirm(`¿Eliminar el tipo "${t.etiqueta}"?`)) return;
    try {
      await deleteTipoEvento(t.id);
      invalidate();
      sileo.success({ title: 'Tipo eliminado' });
    } catch (err: any) {
      sileo.error({ title: err?.response?.data?.message ?? 'No se pudo eliminar' });
    }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>Tipos de Evento Electoral</h2>
        <button className="btn primary" onClick={() => setShowCreate(true)}>+ Nuevo tipo</button>
      </div>

      {isLoading ? (
        <p className="muted">Cargando…</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Etiqueta</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {tipos.map((t) => (
                <tr key={t.id} style={{ opacity: t.activo ? 1 : 0.5 }}>
                  <td><code>{t.codigo}</code></td>
                  <td>{t.etiqueta}</td>
                  <td>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: '0.8rem',
                      background: t.activo ? '#d1fae5' : '#f3f4f6',
                      color: t.activo ? '#065f46' : '#6b7280',
                    }}>
                      {t.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn secondary" onClick={() => setEditing(t)}>Editar</button>
                    <button className="btn secondary" onClick={() => handleToggle(t)}>
                      {t.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    <button className="btn secondary" onClick={() => handleDelete(t)}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <TipoModal
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); invalidate(); }}
        />
      )}
      {editing && (
        <TipoModal
          tipo={editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); invalidate(); }}
        />
      )}
    </>
  );
}

function TipoModal({
  tipo,
  onClose,
  onDone,
}: {
  tipo?: TipoEventoCatalog;
  onClose: () => void;
  onDone: () => void;
}) {
  const [codigo, setCodigo] = useState(tipo?.codigo ?? '');
  const [etiqueta, setEtiqueta] = useState(tipo?.etiqueta ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!etiqueta.trim()) { setError('La etiqueta es requerida'); return; }
    if (!tipo && !codigo.trim()) { setError('El código es requerido'); return; }
    setSaving(true);
    try {
      if (tipo) {
        await updateTipoEvento(tipo.id, { etiqueta });
      } else {
        await createTipoEvento({ codigo: codigo.toUpperCase().replace(/\s+/g, '_'), etiqueta });
      }
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="center" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10 }}>
      <form className="login-card" style={{ maxWidth: 420, width: '100%' }} onSubmit={onSubmit}>
        <h1>{tipo ? 'Editar tipo' : 'Nuevo tipo de evento'}</h1>

        {!tipo && (
          <div className="field">
            <label>Código interno</label>
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Ej.: ELECCION_PRESIDENCIAL"
              maxLength={50}
              required
            />
            <small className="muted">Se convierte a mayúsculas y sin espacios automáticamente.</small>
          </div>
        )}

        <div className="field">
          <label>Etiqueta</label>
          <input
            value={etiqueta}
            onChange={(e) => setEtiqueta(e.target.value)}
            placeholder="Ej.: Elección Presidencial"
            maxLength={120}
            required
            autoFocus
          />
        </div>

        {error && <p className="error-msg">{error}</p>}

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button type="button" className="btn secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </div>
  );
}
