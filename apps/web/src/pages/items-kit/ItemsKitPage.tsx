import { FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ItemKitCatalog } from '@cne/shared-types';
import { sileo } from 'sileo';
import {
  getItemsKitAdmin,
  createItemKit,
  updateItemKit,
  deleteItemKit,
} from '../../lib/queries/items-kit';

export function ItemsKitPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<ItemKitCatalog | null>(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['items-kit-admin'],
    queryFn: async () => (await getItemsKitAdmin()).data,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['items-kit-admin'] });
    qc.invalidateQueries({ queryKey: ['items-kit'] });
  }

  async function handleToggle(it: ItemKitCatalog) {
    try {
      await updateItemKit(it.id, { activo: !it.activo });
      invalidate();
      sileo.success({ title: it.activo ? 'Ítem desactivado' : 'Ítem activado' });
    } catch {
      sileo.error({ title: 'No se pudo actualizar' });
    }
  }

  async function handleDelete(it: ItemKitCatalog) {
    if (!window.confirm(`¿Eliminar el ítem "${it.etiqueta}"?`)) return;
    try {
      await deleteItemKit(it.id);
      invalidate();
      sileo.success({ title: 'Ítem eliminado' });
    } catch (err: any) {
      sileo.error({ title: err?.response?.data?.message ?? 'No se pudo eliminar' });
    }
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <button className="btn primary" onClick={() => setShowCreate(true)}>+ Nuevo ítem</button>
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
              {items.map((it) => (
                <tr key={it.id} style={{ opacity: it.activo ? 1 : 0.5 }}>
                  <td><code>{it.codigo}</code></td>
                  <td>{it.etiqueta}</td>
                  <td>
                    <span style={{
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: '0.8rem',
                      background: it.activo ? '#d1fae5' : '#f3f4f6',
                      color: it.activo ? '#065f46' : '#6b7280',
                    }}>
                      {it.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td style={{ display: 'flex', gap: '0.5rem' }}>
                    <button className="btn secondary" onClick={() => setEditing(it)}>Editar</button>
                    <button className="btn secondary" onClick={() => handleToggle(it)}>
                      {it.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    <button className="btn secondary" onClick={() => handleDelete(it)}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <ItemModal
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); invalidate(); }}
        />
      )}
      {editing && (
        <ItemModal
          item={editing}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); invalidate(); }}
        />
      )}
    </>
  );
}

function ItemModal({
  item,
  onClose,
  onDone,
}: {
  item?: ItemKitCatalog;
  onClose: () => void;
  onDone: () => void;
}) {
  const [codigo, setCodigo] = useState(item?.codigo ?? '');
  const [etiqueta, setEtiqueta] = useState(item?.etiqueta ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!etiqueta.trim()) { setError('La etiqueta es requerida'); return; }
    if (!item && !codigo.trim()) { setError('El código es requerido'); return; }
    setSaving(true);
    try {
      if (item) {
        await updateItemKit(item.id, { etiqueta });
      } else {
        await createItemKit({ codigo: codigo.toUpperCase().replace(/\s+/g, '_'), etiqueta });
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
        <h1>{item ? 'Editar ítem' : 'Nuevo ítem de kit'}</h1>

        {!item && (
          <div className="field">
            <label>Código interno</label>
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Ej.: LINTERNA"
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
            placeholder="Ej.: Linterna"
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
