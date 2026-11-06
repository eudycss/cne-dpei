import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { PersonaPracticaDigitacion, PersonaSimulador, PracticaDigitacion } from '@cne/shared-types';
import { practicaDigitacionSchema, type PracticaDigitacionInput } from '@cne/shared-validation';
import { Modal } from '../../components/Modal';
import { Campo } from '../operadores-cda/Campo';
import { mensajeError } from '../operadores-cda/utils';
import {
  CLAVE_CARGOS,
  aCampoFechaHora,
  buscarPersonasSimulador,
  crearPracticaDigitacion,
  deCampoFechaHora,
  editarPracticaDigitacion,
  getCargosSimulador,
} from '../../lib/queries/simulador';

/** Campos numéricos del formulario (se escriben como texto y se validan con el esquema compartido). */
/**
 * Configuración recomendada (un pomodoro): 25 min alcanzan para medir sin cansar.
 * Meta alcanzable: ~7 registros por minuto (15 actas de 12 filas); 10 % de trampas
 * mide si leen las letras sin volverlo injusto; 2 intentos: el primero para
 * conocer la pantalla, el reporte toma el mejor.
 */
export const CONFIG_RECOMENDADA = {
  filasPorActa: '12',
  votoMin: '0',
  votoMax: '350',
  metaActas: '15',
  plazoMinutos: '25',
  pctDigitosDistintos: '10',
  intentosMax: '2',
};

const NUMEROS = ['filasPorActa', 'votoMin', 'votoMax', 'metaActas', 'plazoMinutos', 'pctDigitosDistintos', 'intentosMax'] as const;
type CampoNumero = (typeof NUMEROS)[number];

/** Lo que define la calificación: con intentos hechos la API no deja cambiarlo. */
const FIJOS_CON_INTENTOS: readonly CampoNumero[] = ['filasPorActa', 'votoMin', 'votoMax', 'metaActas', 'plazoMinutos', 'pctDigitosDistintos'];

const ETIQUETAS: Record<CampoNumero, string> = {
  filasPorActa: 'Filas por acta',
  votoMin: 'Voto mínimo',
  votoMax: 'Voto máximo',
  metaActas: 'Meta de actas',
  plazoMinutos: 'Tiempo de la práctica (minutos)',
  pctDigitosDistintos: '% de filas con dígitos distintos a las letras',
  intentosMax: 'Intentos por persona',
};

const AYUDAS: Partial<Record<CampoNumero, string>> = {
  filasPorActa: 'Candidatos y campos de cada acta (1 a 40).',
  votoMax: 'Hasta 999.',
  metaActas: 'Las que debe completar para «Cumplió». Con 12 filas, 15 actas = 180 registros (unos 7 por minuto en 25 min).',
  plazoMinutos: 'Lo que tiene cada persona para digitar: se cuentan los registros que alcance. Corre desde que empieza.',
  pctDigitosDistintos: 'En esas filas los casilleros muestran otro número: lo correcto es digitar lo de las letras.',
};

type Errores = Partial<Record<string, string>>;

interface Formulario {
  nombre: string;
  inicio: string;
  fin: string;
  numeros: Record<CampoNumero, string>;
  cargos: string[];
  personas: PersonaPracticaDigitacion[];
}

function formularioInicial(p?: PracticaDigitacion): Formulario {
  if (p) {
    return {
      nombre: p.nombre,
      inicio: aCampoFechaHora(p.inicio),
      fin: aCampoFechaHora(p.fin),
      numeros: Object.fromEntries(NUMEROS.map((c) => [c, String(p[c])])) as Record<CampoNumero, string>,
      cargos: p.cargos,
      personas: p.personas,
    };
  }
  return {
    nombre: '',
    inicio: '',
    fin: '',
    numeros: CONFIG_RECOMENDADA,
    cargos: [],
    personas: [],
  };
}

/** Texto del campo → número para el esquema ("" o "abc" no pasan la validación). */
const aNumero = (v: string) => (v.trim() === '' ? Number.NaN : Number(v));

export function aEntrada(f: Formulario): unknown {
  return {
    nombre: f.nombre,
    inicio: f.inicio ? deCampoFechaHora(f.inicio) : '',
    fin: f.fin ? deCampoFechaHora(f.fin) : '',
    ...Object.fromEntries(NUMEROS.map((c) => [c, aNumero(f.numeros[c])])),
    cargos: f.cargos,
    incluir: f.personas.filter((p) => p.incluida).map((p) => p.id),
    excluir: f.personas.filter((p) => !p.incluida).map((p) => p.id),
  };
}

const idCampo = (c: string) => `practica-${c}`;

/**
 * Con los cargos nuevos, ¿la excepción sigue teniendo sentido? Agregar a
 * alguien cuyo cargo ya está habilitado sobra, y quitar a alguien cuyo cargo
 * ya no está no hace nada.
 */
export function excepcionVigente(p: PersonaPracticaDigitacion, cargos: readonly string[]): boolean {
  return p.incluida ? !cargos.includes(p.grupo) : cargos.includes(p.grupo);
}

/** Campos del formulario en su orden: el foco va al primero con error. */
const ORDEN_ERRORES = ['nombre', 'inicio', 'fin', ...NUMEROS, 'cargos', 'personas'] as const;
/** Errores del esquema que se muestran en la sección "Personas sueltas". */
const DE_PERSONAS = new Set(['incluir', 'excluir']);

/**
 * Crear o editar una práctica: cómo son las actas, la meta y el tiempo, y a
 * quién aplica (cargos completos, más personas agregadas o quitadas).
 */
export function PracticaModal({
  practica,
  onClose,
  onGuardada,
}: {
  practica?: PracticaDigitacion;
  onClose: () => void;
  onGuardada: () => void;
}) {
  const [f, setF] = useState<Formulario>(() => formularioInicial(practica));
  const [errores, setErrores] = useState<Errores>({});
  const [descartadas, setDescartadas] = useState('');
  const conIntentos = (practica?.intentos ?? 0) > 0;
  const titulo = practica ? 'Editar práctica' : 'Nueva práctica';

  const guardar = useMutation({
    mutationFn: (body: PracticaDigitacionInput) =>
      practica ? editarPracticaDigitacion(practica.id, body) : crearPracticaDigitacion(body),
    onSuccess: (p) => {
      sileo.success({ title: practica ? 'Práctica actualizada' : 'Práctica creada', description: p.nombre });
      onGuardada();
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo guardar la práctica') }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const r = practicaDigitacionSchema.safeParse(aEntrada(f));
    if (!r.success) {
      const nuevos: Errores = {};
      for (const issue of r.error.issues) {
        const raiz = String(issue.path[0] ?? '');
        const campo = DE_PERSONAS.has(raiz) ? 'personas' : (ORDEN_ERRORES as readonly string[]).includes(raiz) ? raiz : 'general';
        nuevos[campo] ??= issue.message;
      }
      setErrores(nuevos);
      // El foco va al primer campo con error, en el orden del formulario (WCAG 3.3.1).
      const primero = ORDEN_ERRORES.find((c) => nuevos[c]);
      const destino = primero === 'personas' ? 'buscar' : primero ?? 'general';
      document.getElementById(idCampo(destino))?.focus();
      return;
    }
    setErrores({});
    guardar.mutate(r.data);
  }

  function cambiarCargos(cargos: string[]) {
    const vigentes = f.personas.filter((p) => excepcionVigente(p, cargos));
    const quitadas = f.personas.filter((p) => !excepcionVigente(p, cargos));
    setDescartadas(
      quitadas.length
        ? `Se descartó a ${quitadas.map((p) => p.apellidosNombres).join(', ')}: con estos cargos ya no hace falta agregarla(s) o quitarla(s).`
        : '',
    );
    setF((x) => ({ ...x, cargos, personas: vigentes }));
  }

  const setNumero = (c: CampoNumero, v: string) => setF((x) => ({ ...x, numeros: { ...x.numeros, [c]: v } }));

  return (
    <Modal labelledBy="practica-titulo" onClose={onClose} maxWidth={880}>
      <form className="ocda-modal" onSubmit={onSubmit} noValidate aria-busy={guardar.isPending}>
        <div className="ocda-modal-cabecera">
          <div>
            <h2 id="practica-titulo">{titulo}</h2>
            <p className="muted">Las actas las genera el sistema. Cada persona ve el número en letras y en casilleros.</p>
          </div>
          <button type="button" className="ocda-modal-cerrar" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {errores.general && (
          <div id={idCampo('general')} className="banner error" role="alert" tabIndex={-1}>
            {errores.general}
          </div>
        )}

        {conIntentos && (
          <div className="banner aviso" role="note">
            Esta práctica ya tiene {practica!.intentos} intento(s): no se cambian filas, votos, meta, plazo ni el % de
            dígitos distintos. Para otras reglas, cree otra práctica.
          </div>
        )}

        <div className="ocda-form">
          <Campo id={idCampo('nombre')} etiqueta="Nombre de la práctica" error={errores.nombre} ancho>
            <input
              value={f.nombre}
              maxLength={120}
              autoFocus
              onChange={(e) => setF((x) => ({ ...x, nombre: e.target.value }))}
            />
          </Campo>
          <Campo id={idCampo('inicio')} etiqueta="Se puede empezar desde" error={errores.inicio} ayuda="Hora de Ecuador" ancho={false}>
            <input type="datetime-local" value={f.inicio} onChange={(e) => setF((x) => ({ ...x, inicio: e.target.value }))} />
          </Campo>
          <Campo id={idCampo('fin')} etiqueta="Se puede empezar hasta" error={errores.fin} ayuda="Hora de Ecuador" ancho={false}>
            <input type="datetime-local" value={f.fin} onChange={(e) => setF((x) => ({ ...x, fin: e.target.value }))} />
          </Campo>
          {NUMEROS.map((c) => {
            const bloqueado = conIntentos && FIJOS_CON_INTENTOS.includes(c);
            return (
              <Campo
                key={c}
                id={idCampo(c)}
                etiqueta={ETIQUETAS[c]}
                error={errores[c]}
                ayuda={bloqueado ? 'Fijo: la práctica ya tiene intentos.' : AYUDAS[c]}
                ancho={c === 'pctDigitosDistintos'}
              >
                <input
                  type="number"
                  inputMode="numeric"
                  value={f.numeros[c]}
                  readOnly={bloqueado}
                  onChange={(e) => setNumero(c, e.target.value)}
                />
              </Campo>
            );
          })}
        </div>

        <CargosPractica elegidos={f.cargos} error={errores.cargos} onCambiar={cambiarCargos} />

        <PersonasPractica
          cargos={f.cargos}
          personas={f.personas}
          error={errores.personas}
          descartadas={descartadas}
          onCambiar={(personas) => setF((x) => ({ ...x, personas }))}
        />

        <div className="ocda-modal-acciones">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn primary" disabled={guardar.isPending}>
            {guardar.isPending ? 'Guardando…' : 'Guardar práctica'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function CargosPractica({
  elegidos,
  error,
  onCambiar,
}: {
  elegidos: string[];
  error?: string;
  onCambiar: (cargos: string[]) => void;
}) {
  const { data: cargos, isLoading, error: errorCarga } = useQuery({ queryKey: CLAVE_CARGOS, queryFn: getCargosSimulador });
  const alternar = (clave: string) =>
    onCambiar(elegidos.includes(clave) ? elegidos.filter((c) => c !== clave) : [...elegidos, clave]);

  return (
    // tabIndex -1: el foco puede ir aquí con un error aunque los cargos no hayan cargado.
    <fieldset
      id={idCampo('cargos')}
      tabIndex={-1}
      className="ocda-form-prendas sim-cargos"
      aria-describedby={error ? 'practica-cargos-error' : undefined}
    >
      <legend>Cargos a los que aplica</legend>
      {isLoading && (
        <p className="muted" role="status">
          Cargando cargos…
        </p>
      )}
      {errorCarga && (
        <p className="ocda-form-error" role="alert">
          {mensajeError(errorCarga, 'No se pudieron cargar los cargos')}
        </p>
      )}
      <div className="sim-cargos-lista">
        {cargos?.map((c) => (
          <label key={c.clave} className="sim-check">
            <input
              type="checkbox"
              aria-invalid={error ? true : undefined}
              checked={elegidos.includes(c.clave)}
              onChange={() => alternar(c.clave)}
            />
            <span>
              {c.nombre} <span className="muted">({c.centro} · {c.personas})</span>
            </span>
          </label>
        ))}
      </div>
      {error && (
        <span id="practica-cargos-error" className="ocda-form-error" role="alert">
          {error}
        </span>
      )}
    </fieldset>
  );
}

/** Espera a que se deje de escribir antes de buscar. */
function useRetrasado(valor: string, ms = 300): string {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

function PersonasPractica({
  cargos,
  personas,
  error,
  descartadas,
  onCambiar,
}: {
  cargos: string[];
  personas: PersonaPracticaDigitacion[];
  error?: string;
  descartadas: string;
  onCambiar: (personas: PersonaPracticaDigitacion[]) => void;
}) {
  const [texto, setTexto] = useState('');
  const q = useRetrasado(texto.trim());
  const esperando = texto.trim() !== q;
  const { data: encontradas, isFetching, error: errorBusqueda } = useQuery({
    queryKey: ['simulador', 'personas', q],
    queryFn: () => buscarPersonasSimulador(q),
    enabled: q.length >= 2,
  });

  // Si su cargo está habilitado, la excepción es quitarla; si no, agregarla.
  const excepcion = (p: PersonaSimulador): PersonaPracticaDigitacion => ({ ...p, incluida: !cargos.includes(p.grupo) });
  const yaEsta = (id: string) => personas.some((p) => p.id === id);
  const agregarExcepcion = (p: PersonaSimulador) => onCambiar([...personas, excepcion(p)]);
  const deshacer = (id: string) => onCambiar(personas.filter((p) => p.id !== id));

  return (
    <fieldset className="ocda-form-prendas sim-personas">
      <legend>Personas sueltas</legend>
      <p className="muted sim-nota">
        Agregue a alguien de otro cargo, o quite a alguien de un cargo habilitado. Busque por nombre o cédula.
      </p>
      <div className="ocda-form-campo">
        <label htmlFor={idCampo('buscar')}>Buscar persona</label>
        <input
          id={idCampo('buscar')}
          type="search"
          value={texto}
          maxLength={100}
          autoComplete="off"
          aria-describedby="practica-buscar-estado"
          aria-invalid={error ? true : undefined}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            // Escape borra la búsqueda; no cierra el modal (se perdería el formulario).
            if (e.key === 'Escape' && texto) {
              e.preventDefault();
              e.stopPropagation();
              setTexto('');
            }
          }}
        />
      </div>
      <p id="practica-buscar-estado" className="muted sim-nota" aria-live="polite">
        {texto.trim().length < 2
          ? 'Escriba al menos 2 letras o números.'
          : esperando || isFetching
            ? 'Buscando…'
            : errorBusqueda
              ? mensajeError(errorBusqueda, 'No se pudo buscar')
              : `${encontradas?.length ?? 0} resultado(s)${encontradas?.length === 20 ? ' (se muestran 20: afine la búsqueda)' : ''}.`}
      </p>
      {!esperando && q.length >= 2 && encontradas && encontradas.length > 0 && (
        <ul className="sim-resultados" aria-label="Resultados de la búsqueda">
          {encontradas.map((p) => {
            const habilitado = cargos.includes(p.grupo);
            return (
              <li key={p.id}>
                <span>
                  {p.apellidosNombres} <span className="muted mono">{p.cedula}</span> <span className="muted">· {p.cargo}</span>
                </span>
                {yaEsta(p.id) ? (
                  <span className="muted">Ya está en la lista</span>
                ) : (
                  <button
                    type="button"
                    className="ocda-btn-texto"
                    aria-label={`${habilitado ? 'Quitar' : 'Agregar'} a ${p.apellidosNombres}`}
                    onClick={() => agregarExcepcion(p)}
                  >
                    {habilitado ? 'Quitar de la práctica' : 'Agregar a la práctica'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="muted sim-nota" role="status">
        {descartadas}
      </p>
      {personas.length > 0 && (
        <ul className="sim-excepciones" aria-label="Personas agregadas o quitadas">
          {personas.map((p) => (
            <li key={p.id}>
              <span className={`ocda-estado ${p.incluida ? 'ok' : 'error'}`}>{p.incluida ? 'Agregada' : 'Quitada'}</span>
              <span>
                {p.apellidosNombres} <span className="muted">· {p.cargo}</span>
                {!p.activo && <span className="ocda-estado vacio sim-inactiva">Inactiva: no cuenta</span>}
              </span>
              <button type="button" className="ocda-btn-texto" aria-label={`Deshacer ${p.apellidosNombres}`} onClick={() => deshacer(p.id)}>
                Deshacer
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <span className="ocda-form-error" role="alert">
          {error}
        </span>
      )}
    </fieldset>
  );
}
