import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AplicarParejasCdaResult, CampoParejaCda, ParejaCdaFila, PersonaParejaCda, RecintoParejaCda } from '@cne/shared-types';
import { Modal } from '../../components/Modal';
import { editarParejaCda, getDisponiblesParejasCda, intercambiarParejaCda } from '../../lib/queries/operadores-cda';
import { ComboFiltrable, cargoPareja, textoPersona, textoRecinto } from './ParejaFormModal';
import { mensajeError } from './utils';

type Opcion = PersonaParejaCda | RecintoParejaCda;

const TEXTOS: Record<CampoParejaCda, { titulo: string; etiqueta: string; vacio: string }> = {
  OPERADOR: { titulo: 'Cambiar operador', etiqueta: 'Nuevo operador', vacio: 'Elija un operador' },
  ASISTENTE: { titulo: 'Cambiar asistente', etiqueta: 'Nuevo asistente', vacio: 'Sin asistente' },
  RECINTO: { titulo: 'Cambiar recinto', etiqueta: 'Nuevo recinto', vacio: 'Elija un recinto' },
};

/** Lo que la pareja tiene en el campo (operador, asistente o recinto). */
function valorDe(p: ParejaCdaFila, campo: CampoParejaCda): Opcion | null {
  if (campo === 'OPERADOR') return p.operador;
  if (campo === 'ASISTENTE') return p.asistente;
  return p.recinto;
}

/** Une listas sin repetir y ordena por el texto que se muestra. */
function unir(listas: (Opcion | null | undefined)[][], texto: (o: Opcion) => string): Opcion[] {
  const porId = new Map<string, Opcion>();
  for (const o of listas.flat()) if (o && !porId.has(o.id)) porId.set(o.id, o);
  return [...porId.values()].sort((a, b) => texto(a).localeCompare(texto(b), 'es'));
}

/** Cómo queda una pareja: "OPERADOR – ASISTENTE pasa a CÓDIGO · RECINTO". */
const linea = (op: PersonaParejaCda, as: PersonaParejaCda | null, r: RecintoParejaCda) =>
  `${op.apellidosNombres} – ${as?.apellidosNombres ?? 'sin asistente'} pasa a ${textoRecinto(r)}`;

/**
 * Cambia el operador, el asistente o el recinto de una pareja. Si lo elegido
 * ya es de otra pareja del día, las dos lo intercambian (se muestra antes
 * cómo quedan). En la app, cada kit queda con el operador de su recinto.
 */
export function CambiarEnParejaModal({
  dia,
  pareja,
  campo,
  parejas,
  congelado = false,
  justificacionInicial = '',
  onResultado,
  onClose,
}: {
  dia: string;
  pareja: ParejaCdaFila;
  campo: CampoParejaCda;
  /** Lista del día: de aquí sale con quién se intercambia. */
  parejas: ParejaCdaFila[];
  congelado?: boolean;
  justificacionInicial?: string;
  onResultado: (r: AplicarParejasCdaResult) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const textos = TEXTOS[campo];
  const actualId = valorDe(pareja, campo)?.id ?? '';
  const [valor, setValor] = useState(actualId);
  const [justificacion, setJustificacion] = useState(justificacionInicial);
  const motivo = justificacion.trim() || undefined;

  // "Todos": quien ya tiene pareja este día viene de la lista, para intercambiar.
  const { data, isLoading, error } = useQuery({
    queryKey: ['parejas-cda', 'disponibles', dia, true],
    queryFn: () => getDisponiblesParejasCda(dia, true),
  });

  const otras = parejas.filter((p) => p.id !== pareja.id);
  // En un recinto con dos parejas se intercambia con la que tiene el kit (la que no está "solo registrada").
  const duenoDe = (id: string) => {
    const con = otras.filter((p) => valorDe(p, campo)?.id === id);
    return con.find((p) => p.estado !== 'SOLO_REGISTRADA') ?? con[0] ?? null;
  };
  // Quien no es del cargo de la columna (pareja de dos operadores o dos asistentes) lleva su cargo.
  const grupoColumna = campo === 'ASISTENTE' ? 'ASISTENTE' : 'OPERADOR';
  const textoBase = (o: Opcion) =>
    'cedula' in o ? `${textoPersona(o)}${o.grupo === grupoColumna ? '' : ` · ${cargoPareja(o)}`}` : textoRecinto(o);
  const texto = (o: Opcion) => {
    const dueno = o.id === actualId ? null : duenoDe(o.id);
    if (!dueno) return textoBase(o);
    return campo === 'RECINTO'
      ? `${textoBase(o)} · lo tiene ${dueno.operador.apellidosNombres} (se intercambian)`
      : `${textoBase(o)} · en ${dueno.recinto.codigo} (se intercambian)`;
  };
  // Para personas se ofrecen los dos cargos libres; el compañero de la pareja no se ofrece.
  const companero = campo === 'OPERADOR' ? pareja.asistente?.id : campo === 'ASISTENTE' ? pareja.operador.id : undefined;
  const deData = campo === 'RECINTO' ? (data?.recintos ?? []) : [...(data?.operadores ?? []), ...(data?.asistentes ?? [])];
  const opciones = unir([deData, otras.map((p) => valorDe(p, campo)), [valorDe(pareja, campo)]], textoBase).filter(
    (o) => o.id !== companero,
  );

  const sinCambios = valor === actualId;
  const otra = sinCambios || !valor ? null : duenoDe(valor);
  const elegido = opciones.find((o) => o.id === valor) ?? null;

  // Cómo quedan la pareja (y la otra, si se intercambian).
  let lineas: string[] = [];
  // Sin la opción elegida (p. ej. la lista se recargó sin ella) no hay resumen.
  if (!sinCambios && (elegido || (campo === 'ASISTENTE' && !valor))) {
    const op = campo === 'OPERADOR' ? (elegido as PersonaParejaCda) : pareja.operador;
    const as = campo === 'ASISTENTE' ? (elegido as PersonaParejaCda | null) : pareja.asistente;
    const r = campo === 'RECINTO' ? (elegido as RecintoParejaCda) : pareja.recinto;
    lineas = [linea(op, as, r)];
    if (otra) {
      lineas.push(
        linea(
          campo === 'OPERADOR' ? pareja.operador : otra.operador,
          campo === 'ASISTENTE' ? pareja.asistente : otra.asistente,
          campo === 'RECINTO' ? pareja.recinto : otra.recinto,
        ),
      );
    }
  }
  const tocaKits = campo !== 'ASISTENTE' && !!(pareja.kitCodigo || otra?.kitCodigo);

  const guardar = useMutation({
    mutationFn: () => {
      const just = motivo ? { justificacion: motivo } : {};
      if (otra) return intercambiarParejaCda(pareja.id, { conId: otra.id, campo, ...just });
      const cambio =
        campo === 'OPERADOR' ? { operadorCdaId: valor } : campo === 'ASISTENTE' ? { asistenteCdaId: valor || null } : { recintoId: valor };
      return editarParejaCda(pareja.id, { ...cambio, ...just });
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['parejas-cda'] });
      onResultado(r);
      onClose();
    },
  });

  const puedeGuardar = lineas.length > 0 && (!congelado || !!motivo) && !guardar.isPending;
  const faltaMotivo = congelado && !motivo && lineas.length > 0;

  return (
    <Modal labelledBy="cambiar-pareja-titulo" onClose={onClose} maxWidth={560}>
      <form
        className="login-card"
        style={{ width: '100%', maxWidth: 'none' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (puedeGuardar) guardar.mutate();
        }}
        aria-busy={isLoading || guardar.isPending}
      >
        <h1 id="cambiar-pareja-titulo">{textos.titulo}</h1>
        <p className="muted">
          Pareja: <strong>{linea(pareja.operador, pareja.asistente, pareja.recinto).replace(' pasa a ', ' · ')}</strong>. Si elige
          algo que ya tiene otra pareja de este día, las dos lo intercambian.
        </p>

        {error && (
          <p className="banner error" role="alert">
            {mensajeError(error, 'No se pudo cargar la lista para elegir')}
          </p>
        )}

        <ComboFiltrable
          id="cambiar-pareja-valor"
          etiqueta={textos.etiqueta}
          opciones={opciones}
          valor={valor}
          onChange={setValor}
          texto={texto}
          vacio={textos.vacio}
          requerido={campo !== 'ASISTENTE'}
        />

        {/* Siempre montada (vacía y oculta a la vista) para que el lector de pantalla anuncie el resumen. */}
        <div className={lineas.length ? `banner ${otra ? 'aviso' : 'info'}` : 'sr-only'} role="status" aria-live="polite">
          {otra && (
            <p style={{ margin: '0 0 0.35rem' }}>
              <strong>Se intercambian:</strong>
            </p>
          )}
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            {lineas.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          {tocaKits && (
            <p className="muted" style={{ margin: '0.35rem 0 0' }}>
              En la app, cada kit queda con el operador de su recinto.
            </p>
          )}
        </div>

        {congelado && (
          <div className="field">
            <label htmlFor="cambiar-pareja-justificacion">Justificación (la jornada ya inició)</label>
            <input
              id="cambiar-pareja-justificacion"
              value={justificacion}
              onChange={(e) => setJustificacion(e.target.value)}
              maxLength={500}
              required
              aria-describedby="cambiar-pareja-justificacion-ayuda"
              autoComplete="off"
            />
            <p id="cambiar-pareja-justificacion-ayuda" className="muted" style={{ margin: '0.25rem 0 0' }}>
              Obligatoria: queda en la bitácora.
            </p>
          </div>
        )}

        {guardar.isError && (
          <p className="banner error" role="alert">
            {mensajeError(guardar.error, otra ? 'No se pudo intercambiar' : 'No se pudo guardar el cambio')}
          </p>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={guardar.isPending}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={!puedeGuardar} aria-describedby={faltaMotivo ? 'cambiar-pareja-justificacion-ayuda' : undefined}>
            {guardar.isPending ? 'Guardando…' : otra ? 'Intercambiar' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
