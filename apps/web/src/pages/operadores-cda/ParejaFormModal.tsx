import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { AplicarParejasCdaResult, ParejaCdaFila, PersonaParejaCda, RecintoParejaCda } from '@cne/shared-types';
import { Modal } from '../../components/Modal';
import { crearParejaCda, editarParejaCda, getDisponiblesParejasCda } from '../../lib/queries/operadores-cda';
import { resumenApp } from './resumenParejas';
import { mensajeError, normalizar } from './utils';

/** Agrega `actual` a la lista si no está (al cambiar una pareja, sus integrantes ya están "usados"). */
function conActual<T extends { id: string }>(lista: T[] | undefined, actual: T | null | undefined): T[] {
  const l = lista ?? [];
  return actual && !l.some((x) => x.id === actual.id) ? [actual, ...l] : l;
}

/** Combo con un campo para filtrar (son ~60 personas por grupo). */
function ComboFiltrable<T extends { id: string }>({
  id,
  etiqueta,
  opciones,
  valor,
  onChange,
  texto,
  vacio,
  requerido = false,
}: {
  id: string;
  etiqueta: string;
  opciones: T[];
  valor: string;
  onChange: (id: string) => void;
  texto: (o: T) => string;
  vacio: string;
  requerido?: boolean;
}) {
  const [filtro, setFiltro] = useState('');
  const q = normalizar(filtro.trim());
  const visibles = q ? opciones.filter((o) => o.id === valor || normalizar(texto(o)).includes(q)) : opciones;
  return (
    <div className="field">
      <label htmlFor={id}>{etiqueta}</label>
      <input
        type="search"
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
        placeholder="Filtrar por nombre, cédula o código…"
        aria-label={`Filtrar ${etiqueta.toLowerCase()}`}
        autoComplete="off"
      />
      <select id={id} value={valor} onChange={(e) => onChange(e.target.value)} required={requerido} style={{ marginTop: 6 }}>
        <option value="">{vacio}</option>
        {visibles.map((o) => (
          <option key={o.id} value={o.id}>
            {texto(o)}
          </option>
        ))}
      </select>
      <p className="muted" style={{ margin: '0.25rem 0 0' }} aria-live="polite">
        {visibles.length} disponible(s)
      </p>
    </div>
  );
}

const textoPersona = (p: PersonaParejaCda) => `${p.apellidosNombres} · ${p.cedula}`;
const textoRecinto = (r: RecintoParejaCda) => `${r.codigo} · ${r.nombre}`;

/**
 * Agregar o cambiar una pareja. Por defecto solo se ofrecen quienes no han
 * ido otro día y los recintos sin usar; "Usar todos" los muestra a todos.
 */
export function ParejaFormModal({
  dia,
  pareja,
  congelado = false,
  onResultado,
  onClose,
}: {
  dia: string;
  pareja: ParejaCdaFila | null;
  /** Jornada iniciada: pasar el cambio a la app pide justificación. */
  congelado?: boolean;
  /** Recibe el resumen del paso a la app para dejarlo a la vista. */
  onResultado?: (r: AplicarParejasCdaResult) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [todos, setTodos] = useState(false);
  const [operadorId, setOperadorId] = useState(pareja?.operador.id ?? '');
  const [asistenteId, setAsistenteId] = useState(pareja?.asistente?.id ?? '');
  const [recintoId, setRecintoId] = useState(pareja?.recinto.id ?? '');
  const [articulos, setArticulos] = useState('');
  const [justificacion, setJustificacion] = useState('');
  const motivo = justificacion.trim() || undefined;

  const { data, isLoading, error } = useQuery({
    queryKey: ['parejas-cda', 'disponibles', dia, todos],
    queryFn: () => getDisponiblesParejasCda(dia, todos),
  });
  const operadores = conActual(data?.operadores, pareja?.operador);
  const asistentes = conActual(data?.asistentes, pareja?.asistente);
  const recintos = conActual(data?.recintos, pareja?.recinto);

  const guardar = useMutation({
    mutationFn: () =>
      pareja
        ? editarParejaCda(pareja.id, {
            ...(operadorId !== pareja.operador.id && { operadorCdaId: operadorId }),
            ...(asistenteId !== (pareja.asistente?.id ?? '') && { asistenteCdaId: asistenteId || null }),
            ...(recintoId !== pareja.recinto.id && { recintoId }),
            ...(motivo && { justificacion: motivo }),
          })
        : crearParejaCda({
            fecha: dia,
            operadorCdaId: operadorId,
            asistenteCdaId: asistenteId || null,
            recintoId,
            ...(articulos.trim() && { articulos: articulos.trim() }),
            ...(motivo && { justificacion: motivo }),
          }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['parejas-cda'] });
      if (onResultado) onResultado(r);
      else {
        const { title, description } = resumenApp(r);
        (r.errores.length ? sileo.warning : sileo.success)({ title, description });
      }
      onClose();
    },
  });

  const sinCambios =
    !!pareja &&
    operadorId === pareja.operador.id &&
    asistenteId === (pareja.asistente?.id ?? '') &&
    recintoId === pareja.recinto.id;
  const puedeGuardar = !!operadorId && !!recintoId && !sinCambios && (!congelado || !!motivo) && !guardar.isPending;

  return (
    <Modal labelledBy="pareja-form-titulo" onClose={onClose} maxWidth={620}>
      <form
        className="login-card"
        style={{ width: '100%', maxWidth: 'none' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (puedeGuardar) guardar.mutate();
        }}
        aria-busy={isLoading || guardar.isPending}
      >
        <h1 id="pareja-form-titulo">{pareja ? 'Cambiar pareja' : 'Agregar pareja'}</h1>
        <p className="muted">Día {dia}. El operador es quien ve el recinto y el kit en la app.</p>

        <label className="ocda-check-linea">
          <input type="checkbox" checked={todos} onChange={(e) => setTodos(e.target.checked)} />
          Usar todos (incluye a quienes ya fueron otro día y los recintos ya usados)
        </label>

        {error && (
          <p className="banner error" role="alert">
            {mensajeError(error, 'No se pudo cargar a quiénes se puede elegir')}
          </p>
        )}

        <ComboFiltrable
          id="pareja-operador"
          etiqueta="Operador CDA"
          opciones={operadores}
          valor={operadorId}
          onChange={setOperadorId}
          texto={textoPersona}
          vacio="Elija un operador"
          requerido
        />
        <ComboFiltrable
          id="pareja-asistente"
          etiqueta="Asistente CDA"
          opciones={asistentes}
          valor={asistenteId}
          onChange={setAsistenteId}
          texto={textoPersona}
          vacio="Sin asistente"
        />
        <ComboFiltrable
          id="pareja-recinto"
          etiqueta="Recinto CDA"
          opciones={recintos}
          valor={recintoId}
          onChange={setRecintoId}
          texto={textoRecinto}
          vacio="Elija un recinto"
          requerido
        />

        {!pareja && (
          <div className="field">
            <label htmlFor="pareja-articulos">Artículos del kit (solo si el recinto aún no tiene kit)</label>
            <input
              id="pareja-articulos"
              value={articulos}
              onChange={(e) => setArticulos(e.target.value)}
              placeholder="COMPUTADOR:5CD445577S, MOUSE"
              aria-describedby="pareja-articulos-ayuda"
              maxLength={1000}
              autoComplete="off"
            />
            <p id="pareja-articulos-ayuda" className="muted" style={{ margin: '0.25rem 0 0' }}>
              Códigos del catálogo separados por coma; la serie va después de dos puntos. Si lo deja vacío, el kit
              lleva todos los artículos activos del catálogo.
            </p>
          </div>
        )}

        {congelado && (
          <div className="field">
            <label htmlFor="pareja-justificacion">Justificación (la jornada ya inició)</label>
            <input
              id="pareja-justificacion"
              value={justificacion}
              onChange={(e) => setJustificacion(e.target.value)}
              maxLength={500}
              required
              autoComplete="off"
            />
          </div>
        )}

        {guardar.isError && (
          <p className="banner error" role="alert">
            {mensajeError(guardar.error, 'No se pudo guardar la pareja')}
          </p>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={guardar.isPending}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={!puedeGuardar}>
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
