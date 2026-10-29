import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { PersonaCdaEncontrada } from '@cne/shared-types';
import { useAuth } from '../../auth/AuthContext';
import { SearchInput } from '../../components/SearchInput';
import { buscarPersonasCda } from '../../lib/queries/operadores-cda';
import { FILTROS_INGRESO } from './filtroIngreso';
import { TEXTOS_GRUPO, useGrupoCda } from './grupo';
import { mensajeError } from './utils';

/** La API pide al menos 3 caracteres y devuelve hasta 20 personas. */
const MINIMO = 3;
const MAXIMO = 20;

/**
 * Personas que coinciden con `texto` en todos los cargos (CDA y CPE). Espera
 * 300 ms sin teclear antes de consultar. `q` es el texto ya consultado.
 */
export function useBuscarPersonasCda(texto: string) {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes('ADMINISTRADOR') ?? false;
  const limpio = texto.trim();
  const [q, setQ] = useState(limpio);
  useEffect(() => {
    const t = setTimeout(() => setQ(limpio), 300);
    return () => clearTimeout(t);
  }, [limpio]);
  const consulta = useQuery({
    queryKey: ['operadores-cda-buscar', q, isAdmin],
    queryFn: () => buscarPersonasCda(q, isAdmin),
    enabled: q.length >= MINIMO,
  });
  // Mientras se escribe, lo anterior ya no corresponde a lo que dice el campo.
  const personas = q === limpio && q.length >= MINIMO ? consulta.data : undefined;
  return { personas, q, error: consulta.isError ? consulta.error : null };
}

/**
 * Lleva al listado del cargo de la persona, con su cédula en el filtro (el
 * listado la lee de ?q= y la quita de la URL). Si está oculta, ?ocultos=1.
 * Reemplaza la entrada del historial: la cédula no queda guardada en él.
 */
export function useIrAPersona() {
  const [, setParams] = useSearchParams();
  return (p: PersonaCdaEncontrada) =>
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      if (p.grupo === 'OPERADOR') n.delete('grupo');
      else n.set('grupo', TEXTOS_GRUPO[p.grupo].ruta);
      n.set('tab', 'listado');
      n.set('q', p.cedula);
      if (p.activo) n.delete('ocultos');
      else n.set('ocultos', '1');
      for (const f of FILTROS_INGRESO) n.delete(f);
      return n;
    }, { replace: true });
}

/** Una persona encontrada: nombre, cédula, cargo y centro, y el botón para ir. */
export function PersonasEncontradas({
  personas,
  etiqueta,
  onIr,
}: {
  personas: PersonaCdaEncontrada[];
  etiqueta: string;
  onIr: (p: PersonaCdaEncontrada) => void;
}) {
  return (
    <ul className="ocda-personas" aria-label={etiqueta}>
      {personas.map((p) => {
        const t = TEXTOS_GRUPO[p.grupo];
        return (
          <li key={p.id} className="ocda-persona">
            <span className="ocda-persona-datos">
              <strong>{p.apellidosNombres}</strong>
              <span className="muted">
                {p.cedula} · {t.titulo} · {t.centro}
              </span>
              {!p.activo && <span className="ocda-estado vacio">Oculto</span>}
            </span>
            <button
              type="button"
              className="ocda-btn-texto"
              aria-label={`Ir al listado de ${p.apellidosNombres}`}
              onClick={() => onIr(p)}
            >
              Ir al listado
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Para el listado sin resultados: si lo buscado coincide con alguien de otro
 * cargo, dice dónde está y lleva ahí.
 */
export function EnOtroCargo({ texto }: { texto: string }) {
  const { grupo } = useGrupoCda();
  const { personas } = useBuscarPersonasCda(texto);
  const irA = useIrAPersona();
  const otras = personas?.filter((p) => p.grupo !== grupo);
  // La región existe siempre para que el lector de pantalla anuncie el aviso al llegar.
  return (
    <div className="ocda-en-otro" role="status">
      {otras && otras.length > 0 && (
        <>
          <p className="muted">
            Está en otro cargo:
          </p>
          <PersonasEncontradas personas={otras} etiqueta="Está en otro cargo" onIr={irA} />
        </>
      )}
    </div>
  );
}

/**
 * Buscador del encabezado: encuentra a una persona en cualquiera de los 9
 * cargos para saber a qué listado ir (editarla, su carnet QR o su acta).
 */
export function BuscadorGeneral() {
  const [texto, setTexto] = useState('');
  const { personas, q, error } = useBuscarPersonasCda(texto);
  const irA = useIrAPersona();
  const largo = texto.trim().length;

  return (
    <section className="ocda-buscador" aria-label="Buscador en todos los cargos">
      <span className="ocda-campo">
        <SearchInput
          value={texto}
          onChange={setTexto}
          placeholder="Buscar persona en todos los cargos (nombre o cédula)…"
          ariaLabel="Buscar persona en todos los cargos"
        />
      </span>
      <div role="status">
        {largo > 0 && largo < MINIMO && <p className="muted">Escriba al menos 3 caracteres del nombre o la cédula.</p>}
        {largo >= MINIMO && !personas && error == null && <p className="muted">Buscando…</p>}
        {personas && personas.length > 0 && (
          <p className="muted">
            {personas.length === 1 ? '1 persona encontrada.' : `${personas.length} personas encontradas.`}
          </p>
        )}
        {personas?.length === 0 && <p className="muted">{`Nadie coincide con “${q}” en ningún cargo.`}</p>}
        {personas?.length === MAXIMO && (
          <p className="muted">Se muestran las primeras {MAXIMO}: escriba más del nombre o la cédula para afinar.</p>
        )}
      </div>
      {error != null && (
        <p className="banner error" role="alert">
          {mensajeError(error, 'No se pudo buscar. Intente de nuevo.')}
        </p>
      )}
      {personas && personas.length > 0 && (
        <PersonasEncontradas
          personas={personas}
          etiqueta="Personas encontradas en todos los cargos"
          onIr={(p) => {
            setTexto('');
            irA(p);
          }}
        />
      )}
    </section>
  );
}
