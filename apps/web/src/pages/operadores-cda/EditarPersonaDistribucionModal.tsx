import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { PersonaDistribucionDias } from '@cne/shared-types';
import { coincideBusqueda } from '@cne/shared-validation';
import { Modal } from '../../components/Modal';
import { editarPersonaDistribucion, intercambiarPersonaDistribucion } from '../../lib/queries/distribucion-dias';
import { AvatarPersona } from './AvatarPersona';
import { candidatosIntercambio, cupoPorDia, diaCorto } from './distribucionDias';
import { mensajeError } from './utils';

const MAX_INTERCAMBIO = 40;
const PLURAL = { M: 'hombres', F: 'mujeres' } as const;

/**
 * Cambia el día, el cantón o el encargado de una fila (vacío = sin dato). Para
 * no romper lo equitativo: moverla sola solo a un día con cupo de su sexo, o
 * intercambiarla con alguien de su mismo sexo de otro día (cada uno toma el día
 * del otro).
 */
export function EditarPersonaDistribucionModal({
  distribucionId,
  persona,
  personas,
  fechas,
  sugerencias,
  onClose,
}: {
  distribucionId: string;
  persona: PersonaDistribucionDias;
  /** Toda la distribución: de aquí salen el cupo por día y con quién intercambiar. */
  personas: PersonaDistribucionDias[];
  fechas: string[];
  sugerencias: { cantones: string[]; encargados: string[] };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [fecha, setFecha] = useState(persona.fecha);
  const [canton, setCanton] = useState(persona.canton ?? '');
  const [encargado, setEncargado] = useState(persona.encargado ?? '');
  const [buscar, setBuscar] = useState('');
  const [conId, setConId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cupos = useMemo(() => cupoPorDia(personas, persona, fechas), [personas, persona, fechas]);
  const todos = useMemo(() => candidatosIntercambio(personas, persona), [personas, persona]);
  const lista = useMemo(
    () => todos.filter((x) => coincideBusqueda([x.nombres, x.cedula, x.canton, x.encargado, diaCorto(x.fecha)], buscar)),
    [todos, buscar],
  );
  const plural = persona.sexo ? PLURAL[persona.sexo] : null;

  const terminar = (titulo: string, descripcion: string) => {
    void qc.invalidateQueries({ queryKey: ['distribuciones-dias'] });
    sileo.success({ title: titulo, description: descripcion });
    onClose();
  };

  const guardar = useMutation({
    mutationFn: () => editarPersonaDistribucion(distribucionId, persona.id, { ...(fecha !== persona.fecha ? { fecha } : {}), canton, encargado }),
    onSuccess: () => terminar('Cambios guardados', persona.nombres),
    onError: (e) => {
      // 409: otro cambio se llevó el cupo; se refresca para mostrarlo bien.
      void qc.invalidateQueries({ queryKey: ['distribuciones-dias'] });
      setError(mensajeError(e, 'No se pudieron guardar los cambios'));
    },
  });
  const intercambiar = useMutation({
    mutationFn: (id: string) => intercambiarPersonaDistribucion(distribucionId, persona.id, id),
    onSuccess: ([a, b]) => terminar('Intercambio hecho', `${a.nombres} → ${diaCorto(a.fecha)} · ${b.nombres} → ${diaCorto(b.fecha)}`),
    onError: (e) => {
      void qc.invalidateQueries({ queryKey: ['distribuciones-dias'] });
      setError(mensajeError(e, 'No se pudo intercambiar'));
    },
  });
  const ocupado = guardar.isPending || intercambiar.isPending;

  function enviar(e: FormEvent) {
    e.preventDefault();
    guardar.mutate();
  }

  const elegido = todos.find((x) => x.id === conId);

  return (
    <Modal labelledBy="editar-distribucion-titulo" onClose={onClose} maxWidth={640}>
      <form className="login-card" style={{ width: '100%', maxWidth: 'none' }} onSubmit={enviar} noValidate>
        <div className="row" style={{ gap: '0.75rem', alignItems: 'center' }}>
          <AvatarPersona persona={{ operadorId: persona.operadorId, nombre: persona.nombres, cedula: persona.cedula, cargo: persona.cargo }} tamano="grande" />
          <div>
            <h1 id="editar-distribucion-titulo" style={{ margin: 0 }}>
              Editar
            </h1>
            <p className="muted" style={{ margin: 0 }}>
              {persona.nombres} · {persona.cedula} · {persona.cargo} · va el {diaCorto(persona.fecha)}
            </p>
          </div>
        </div>

        <label className="ocda-campo" style={{ marginTop: '1rem' }}>
          <span>Día (moverla sola)</span>
          <select value={fecha} onChange={(e) => setFecha(e.target.value)} aria-describedby="editar-dia-ayuda">
            {cupos.map((c) => (
              <option key={c.fecha} value={c.fecha} disabled={!c.conCupo}>
                {diaCorto(c.fecha)}
                {plural ? ` · ${c.mismoSexo} ${plural}` : ''}
                {c.fecha === persona.fecha ? ' (día actual)' : c.conCupo ? ' · con cupo' : ' · sin cupo'}
              </option>
            ))}
          </select>
        </label>
        <p id="editar-dia-ayuda" className="muted" style={{ margin: '0.25rem 0 0' }}>
          {plural
            ? `Solo se puede mover a un día con menos ${plural} que el actual. Para otro día, intercámbiela con alguien de ese día.`
            : 'Sin dato de sexo: se puede mover a cualquier día.'}
        </p>

        <label className="ocda-campo" style={{ marginTop: '0.75rem' }}>
          <span>Cantón</span>
          <input value={canton} onChange={(e) => setCanton(e.target.value)} maxLength={100} list="editar-cantones" />
        </label>
        <label className="ocda-campo" style={{ marginTop: '0.75rem' }}>
          <span>Encargado</span>
          <input value={encargado} onChange={(e) => setEncargado(e.target.value)} maxLength={200} list="editar-encargados" />
        </label>
        <datalist id="editar-cantones">
          {sugerencias.cantones.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <datalist id="editar-encargados">
          {sugerencias.encargados.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>

        {error && (
          <p className="banner error" role="alert">
            {error}
          </p>
        )}
        <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', marginTop: '1rem' }}>
          <button type="submit" className="btn" disabled={ocupado} aria-busy={guardar.isPending}>
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </button>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: '1.5rem 0 0' }}>
          <legend style={{ fontWeight: 600 }}>Intercambiar con alguien de otro día</legend>
          <p className="muted" style={{ marginTop: 0 }}>
            {plural ? `Solo ${plural}, para que cada día siga equitativo.` : 'Personas sin dato de sexo.'} Cada uno pasa al día del otro.
          </p>
          <label className="ocda-campo">
            <span>Buscar por nombre, cédula, cantón, encargado o día</span>
            <input
              type="search"
              value={buscar}
              onChange={(e) => setBuscar(e.target.value)}
              // Enter aquí solo busca: no debe enviar el formulario (Guardar).
              onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
              maxLength={60}
            />
          </label>
          <p className="muted" role="status" style={{ margin: '0.5rem 0' }}>
            {lista.length === 0
              ? 'Nadie para intercambiar con esa búsqueda.'
              : `${lista.length} persona(s)${lista.length > MAX_INTERCAMBIO ? `; se muestran ${MAX_INTERCAMBIO}, escriba para afinar` : ''}.`}
          </p>
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {lista.slice(0, MAX_INTERCAMBIO).map((x) => {
              const id = `intercambio-${x.id}`;
              return (
                <div key={x.id} className="row" style={{ gap: '0.5rem', alignItems: 'center', minHeight: 44 }}>
                  <input id={id} type="radio" name="intercambio" checked={conId === x.id} onChange={() => setConId(x.id)} />
                  <AvatarPersona persona={{ operadorId: x.operadorId, nombre: x.nombres, cedula: x.cedula, cargo: x.cargo }} tamano="chico" ampliable={false} />
                  <label htmlFor={id}>
                    {x.nombres} <span className="muted">· {diaCorto(x.fecha)} · {x.canton ?? 'sin cantón'} · {x.encargado ?? 'sin encargado'}</span>
                  </label>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="btn"
            style={{ marginTop: '0.75rem' }}
            disabled={!elegido || ocupado}
            aria-busy={intercambiar.isPending}
            onClick={() => elegido && intercambiar.mutate(elegido.id)}
          >
            {intercambiar.isPending
              ? 'Intercambiando…'
              : elegido
                ? `Intercambiar: ${persona.nombres} → ${diaCorto(elegido.fecha)}, ${elegido.nombres} → ${diaCorto(persona.fecha)}`
                : 'Intercambiar'}
          </button>
        </fieldset>
      </form>
    </Modal>
  );
}
