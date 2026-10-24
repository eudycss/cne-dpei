import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';

export interface Pestana<T extends string> {
  id: T;
  etiqueta: string;
}

/**
 * Pestañas (patrón WAI-ARIA Tabs, activación automática). La pestaña activa
 * vive en `?tab=` (o en `parametro`, para anidar dos grupos de pestañas) para
 * poder enlazarla; la de por defecto no lo escribe. Solo se monta el panel activo.
 */
export function Pestanas<T extends string>({
  pestanas,
  porDefecto,
  etiqueta,
  parametro = 'tab',
  children,
}: {
  pestanas: readonly Pestana<T>[];
  /** Pestaña que se abre si `?tab=` no existe o no es válida. */
  porDefecto: T;
  /** Nombre accesible del grupo de pestañas. */
  etiqueta: string;
  /** Parámetro de la URL donde se guarda la pestaña activa. */
  parametro?: string;
  children: (activa: T) => ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const pedida = params.get(parametro);
  const activa = pestanas.find((p) => p.id === pedida)?.id ?? porDefecto;

  function seleccionar(indice: number) {
    const { id } = pestanas[indice];
    // Conserva los demás parámetros (p. ej. la pestaña del otro nivel).
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (id === porDefecto) p.delete(parametro);
        else p.set(parametro, id);
        return p;
      },
      { replace: true },
    );
    tabsRef.current[indice]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const actual = pestanas.findIndex((p) => p.id === activa);
    const ultimo = pestanas.length - 1;
    const destino: Record<string, number> = {
      ArrowRight: actual === ultimo ? 0 : actual + 1,
      ArrowLeft: actual === 0 ? ultimo : actual - 1,
      Home: 0,
      End: ultimo,
    };
    if (!(e.key in destino)) return;
    e.preventDefault();
    seleccionar(destino[e.key]);
  }

  return (
    <>
      <div role="tablist" aria-label={etiqueta} className="pestanas">
        {pestanas.map((p, i) => (
          <button
            key={p.id}
            ref={(el) => {
              tabsRef.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`pestana-${p.id}`}
            aria-selected={activa === p.id}
            aria-controls={activa === p.id ? `panel-${p.id}` : undefined}
            tabIndex={activa === p.id ? 0 : -1}
            onClick={() => seleccionar(i)}
            onKeyDown={onKeyDown}
          >
            {p.etiqueta}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${activa}`} aria-labelledby={`pestana-${activa}`}>
        {children(activa)}
      </div>
    </>
  );
}
