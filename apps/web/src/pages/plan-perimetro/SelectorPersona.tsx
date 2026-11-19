import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CandidatoPerimetro, PersonaPuestoPerimetro } from '@cne/shared-types';
import type { CandidatosPerimetroInput } from '@cne/shared-validation';
import { MAX_CANDIDATOS_PERIMETRO } from '@cne/shared-validation';
import { CLAVE_CARGOS_PERIMETRO, claveCandidatos, getCandidatosPerimetro, getCargosPerimetro } from '../../lib/queries/perimetro';

type Centro = NonNullable<CandidatosPerimetroInput['centro']>;

export interface FiltrosPersonal {
  centro?: Centro;
  cargo?: string;
}

/** Centro y cargo: filtran al personal (no se muestran por persona). */
export function FiltrosPersonalCampos({ valor, onCambio, idBase }: { valor: FiltrosPersonal; onCambio: (f: FiltrosPersonal) => void; idBase: string }) {
  const { data: cargos } = useQuery({ queryKey: CLAVE_CARGOS_PERIMETRO, queryFn: getCargosPerimetro, staleTime: 5 * 60_000 });
  const visibles = (cargos ?? []).filter((c) => !valor.centro || c.centro === valor.centro);
  return (
    <div className="pp-fila-campos">
      <label className="ocda-cargo" htmlFor={`${idBase}-centro`}>
        Centro
        <select
          id={`${idBase}-centro`}
          value={valor.centro ?? ''}
          onChange={(e) => onCambio({ centro: (e.target.value || undefined) as Centro | undefined, cargo: undefined })}
        >
          <option value="">CDA y CPE</option>
          <option value="CDA">CDA</option>
          <option value="CPE">CPE</option>
        </select>
      </label>
      <label className="ocda-cargo" htmlFor={`${idBase}-cargo`}>
        Cargo
        <select id={`${idBase}-cargo`} value={valor.cargo ?? ''} onChange={(e) => onCambio({ ...valor, cargo: e.target.value || undefined })}>
          <option value="">Todos</option>
          {visibles.map((c) => (
            <option key={c.clave} value={c.clave}>
              {c.nombre}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

interface SelectorPersonaProps {
  planId: string;
  /** Número del puesto (para los textos). */
  orden: number;
  /** Quienes ya están en el borrador: no se ofrecen otra vez. */
  excluir: ReadonlySet<string>;
  onElegir: (p: PersonaPuestoPerimetro) => void;
  onCerrar: () => void;
}

/** Buscador del personal activo para un puesto: solo muestra el nombre. */
export function SelectorPersona({ planId, orden, excluir, onElegir, onCerrar }: SelectorPersonaProps) {
  const id = useId();
  const [filtros, setFiltros] = useState<FiltrosPersonal>({});
  const [texto, setTexto] = useState('');
  const [buscar, setBuscar] = useState('');
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => campo.current?.focus(), []);
  // Espera a que deje de escribir para no consultar en cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setBuscar(texto.trim()), 300);
    return () => clearTimeout(t);
  }, [texto]);

  const consulta: CandidatosPerimetroInput = { ...filtros, ...(buscar ? { buscar } : {}) };
  const { data, isLoading, isError } = useQuery({
    queryKey: claveCandidatos(planId, consulta),
    queryFn: () => getCandidatosPerimetro(planId, consulta),
    staleTime: 30_000,
  });
  // El API manda uno de más si hay más de MAX: se muestran los primeros y se pide afinar.
  const hayMas = (data?.length ?? 0) > MAX_CANDIDATOS_PERIMETRO;
  const lista: CandidatoPerimetro[] = (data ?? []).slice(0, MAX_CANDIDATOS_PERIMETRO).filter((c) => !excluir.has(c.id));

  function alTecla(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCerrar();
    }
  }

  return (
    <div className="pp-selector" role="group" aria-label={`Asignar persona al puesto ${orden}`} onKeyDown={alTecla}>
      <FiltrosPersonalCampos valor={filtros} onCambio={setFiltros} idBase={id} />
      <label className="sr-only" htmlFor={`${id}-buscar`}>
        Buscar por nombre
      </label>
      <input
        id={`${id}-buscar`}
        ref={campo}
        type="search"
        placeholder="Buscar por nombre"
        maxLength={100}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
      />
      <div aria-live="polite" className="pp-ayuda">
        {isLoading
          ? 'Buscando…'
          : isError
            ? 'No se pudo cargar el personal.'
            : lista.length === 0
              ? 'Nadie coincide.'
              : hayMas
                ? `Mostrando las primeras ${MAX_CANDIDATOS_PERIMETRO}: escriba parte del nombre o use los filtros.`
                : `${lista.length} personas`}
      </div>
      {lista.length > 0 && (
        <ul className="pp-candidatos">
          {lista.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onElegir({ id: c.id, nombre: c.nombre, tieneFoto: false })}>
                {c.nombre}
                {c.enOtroPlan && <span className="pp-otro-plan"> · ya está en otro plan</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn secondary ocda-btn-chico" onClick={onCerrar}>
        Cancelar
      </button>
    </div>
  );
}
