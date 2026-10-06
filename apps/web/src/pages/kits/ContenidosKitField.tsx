import { useState } from 'react';
import type { EstadoItemKit, ItemKitCatalog, Kit, KitItemDetalleInput } from '@cne/shared-types';
import { createItemKit } from '../../lib/queries/items-kit';

export interface DetalleItemForm {
  serie: string;
  estado: EstadoItemKit;
}

/** Ítems marcados del kit: la presencia de la clave = ítem marcado. */
export type ContenidosKit = Map<string, DetalleItemForm>;

export const ESTADOS_ITEM: { value: EstadoItemKit; label: string }[] = [
  { value: 'BUENO', label: 'Bueno' },
  { value: 'REGULAR', label: 'Regular' },
  { value: 'MALO', label: 'Malo' },
];

const NUEVO: DetalleItemForm = { serie: '', estado: 'BUENO' };

export function contenidosDesdeCatalogo(catalogo: ItemKitCatalog[]): ContenidosKit {
  return new Map(catalogo.map((i) => [i.id, { ...NUEVO }]));
}

export function contenidosDesdeKit(kit: Kit): ContenidosKit {
  // Kits anteriores a la serie/estado solo traen itemIds.
  if (kit.detalleItems?.length) {
    return new Map(kit.detalleItems.map((d) => [d.itemId, { serie: d.serie ?? '', estado: d.estado }]));
  }
  return new Map(kit.itemIds.map((id) => [id, { ...NUEVO }]));
}

export function aDetalleItems(contenidos: ContenidosKit): KitItemDetalleInput[] {
  return [...contenidos].map(([itemId, d]) => ({
    itemId,
    serie: d.serie.trim() || null,
    estado: d.estado,
  }));
}

/** Clave estable para saber si el contenido cambió respecto del original. */
export function firmaContenidos(contenidos: ContenidosKit): string {
  return JSON.stringify(aDetalleItems(contenidos).sort((a, b) => a.itemId.localeCompare(b.itemId)));
}

function codigoDesdeEtiqueta(etiqueta: string): string {
  return etiqueta
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * "Contenidos del kit": checklist del catálogo; cada ítem marcado pide su
 * número de serie (vacío = S/N) y su estado, que salen en el acta de entrega.
 */
export function ContenidosKitField({
  idTitulo,
  itemsCatalog,
  value,
  onChange,
  onCatalogChanged,
  onError,
}: {
  idTitulo: string;
  itemsCatalog: ItemKitCatalog[];
  value: ContenidosKit;
  onChange: (next: ContenidosKit) => void;
  onCatalogChanged: () => void;
  onError: (mensaje: string | null) => void;
}) {
  const [newItemLabel, setNewItemLabel] = useState('');
  const [addingItem, setAddingItem] = useState(false);

  function toggle(id: string) {
    const next = new Map(value);
    next.has(id) ? next.delete(id) : next.set(id, { ...NUEVO });
    onChange(next);
  }

  function actualizar(id: string, cambio: Partial<DetalleItemForm>) {
    const next = new Map(value);
    next.set(id, { ...(next.get(id) ?? NUEVO), ...cambio });
    onChange(next);
  }

  async function handleAddItem() {
    const etiqueta = newItemLabel.trim();
    if (!etiqueta) return;
    setAddingItem(true);
    onError(null);
    try {
      const res = await createItemKit({ codigo: codigoDesdeEtiqueta(etiqueta), etiqueta });
      onCatalogChanged();
      onChange(new Map(value).set(res.data.id, { ...NUEVO }));
      setNewItemLabel('');
    } catch (err: any) {
      onError(err?.response?.data?.message ?? 'No se pudo agregar el ítem');
    } finally {
      setAddingItem(false);
    }
  }

  return (
    <div className="field" role="group" aria-labelledby={idTitulo}>
      <span id={idTitulo} className="field-titulo">Contenidos del kit</span>
      {itemsCatalog.length === 0 && (
        <p className="muted" style={{ fontSize: '0.85rem' }}>No hay ítems en el catálogo todavía.</p>
      )}
      {itemsCatalog.map((item) => {
        const detalle = value.get(item.id);
        return (
          <div key={item.id} style={{ margin: '0.2rem 0' }}>
            <label className="row" style={{ gap: '0.4rem', alignItems: 'center' }}>
              <input type="checkbox" checked={!!detalle} onChange={() => toggle(item.id)} />
              {item.etiqueta}
            </label>
            {detalle && (
              <div className="row" style={{ gap: '0.4rem', margin: '0.2rem 0 0.4rem 1.6rem' }}>
                <input
                  value={detalle.serie}
                  onChange={(e) => actualizar(item.id, { serie: e.target.value })}
                  placeholder="N.º de serie (vacío = S/N)"
                  aria-label={`Número de serie de ${item.etiqueta}`}
                  maxLength={60}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <select
                  value={detalle.estado}
                  onChange={(e) => actualizar(item.id, { estado: e.target.value as EstadoItemKit })}
                  aria-label={`Estado de ${item.etiqueta}`}
                >
                  {ESTADOS_ITEM.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        );
      })}
      <div className="row" style={{ marginTop: '0.5rem', gap: '0.4rem' }}>
        <input
          value={newItemLabel}
          onChange={(e) => setNewItemLabel(e.target.value)}
          placeholder="Otro ítem…"
          aria-label="Nombre del nuevo ítem"
          maxLength={120}
        />
        <button
          type="button"
          className="btn secondary"
          disabled={addingItem || !newItemLabel.trim()}
          onClick={handleAddItem}
        >
          {addingItem ? 'Agregando…' : '+ Agregar otro'}
        </button>
      </div>
    </div>
  );
}
