import { useRef, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../auth/AuthContext';
import { RecintosPage } from './RecintosPage';
import { EnlacesPage } from '../enlaces/EnlacesPage';

type Pestana = 'recintos' | 'enlaces';

const PESTANAS: { id: Pestana; etiqueta: string }[] = [
  { id: 'recintos', etiqueta: 'Recintos' },
  { id: 'enlaces', etiqueta: 'Enlaces' },
];

/**
 * Recintos y el estado de sus enlaces en una sola página con pestañas (patrón
 * WAI-ARIA Tabs, activación automática). Los datos siguen separados: los enlaces
 * vienen de la hoja de Drive. La pestaña Enlaces es solo del administrador y se
 * abre directo con `?tab=enlaces`.
 */
export function RecintosSeccion() {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes('ADMINISTRADOR') ?? false;
  const [params, setParams] = useSearchParams();
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);

  if (!isAdmin) {
    return (
      <>
        <h2>Recintos Electorales</h2>
        <RecintosPage />
      </>
    );
  }

  const activa: Pestana = params.get('tab') === 'enlaces' ? 'enlaces' : 'recintos';

  function seleccionar(indice: number) {
    const { id } = PESTANAS[indice];
    setParams(id === 'recintos' ? {} : { tab: id }, { replace: true });
    tabsRef.current[indice]?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const actual = PESTANAS.findIndex((p) => p.id === activa);
    const ultimo = PESTANAS.length - 1;
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
      <h2>Recintos Electorales</h2>
      <div role="tablist" aria-label="Recintos y enlaces" className="pestanas">
        {PESTANAS.map((p, i) => (
          <button
            key={p.id}
            ref={(el) => {
              tabsRef.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`pestana-${p.id}`}
            aria-selected={activa === p.id}
            // Solo se monta el panel activo: la pestaña inactiva no apunta a un panel que no existe.
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
        {activa === 'enlaces' ? <EnlacesPage /> : <RecintosPage />}
      </div>
    </>
  );
}
