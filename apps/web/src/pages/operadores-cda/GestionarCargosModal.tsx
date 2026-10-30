import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { CargoCda, CentroCda } from '@cne/shared-types';
import { crearCargoCdaSchema, renombrarCargoCdaSchema } from '@cne/shared-validation';
import { Modal } from '../../components/Modal';
import { cambiarActivoCargoCda, crearCargoCda, getCargosCda, renombrarCargoCda } from '../../lib/queries/operadores-cda';
import { Campo } from './Campo';
import { mensajeError } from './utils';

const NOMBRE_CENTRO: Record<CentroCda, string> = {
  CDA: 'CDA — Centros de Digitalización de Actas',
  CPE: 'CPE — Centro de Procesamiento Electoral',
};

const REPETIDO = 'Ya existe un cargo con ese nombre';

// Ids de los botones de cada fila: el foco vuelve a ellos al terminar.
const idEditar = (clave: string) => `cargo-editar-${clave}`;
const idEstado = (clave: string) => `cargo-estado-${clave}`;

/** Escape cancela solo lo que está abierto (edición o confirmación), no todo el modal. */
function escapeCancela(cancelar: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    cancelar();
  };
}

const personas = (n: number) => `${n} ${n === 1 ? 'persona' : 'personas'}`;

/** Igual que la API: sin importar mayúsculas ni espacios de más. */
function repetido(nombre: string, cargos: readonly CargoCda[], excepto?: string): boolean {
  const n = nombre.toLocaleLowerCase('es');
  return cargos.some((c) => c.clave !== excepto && c.nombre.toLocaleLowerCase('es') === n);
}

/**
 * Cargos del combo "Cargo" (solo administrador): agregar, cambiar el nombre
 * visible y desactivar o reactivar. Nada se borra: desactivar solo lo saca
 * del combo. Operadores y Asistentes CDA no se desactivan (los usa la app).
 */
export function GestionarCargosModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { data: cargos, isLoading, error } = useQuery({ queryKey: ['cargos-cda'], queryFn: getCargosCda });
  const [editando, setEditando] = useState<CargoCda | null>(null);
  const [confirmando, setConfirmando] = useState<CargoCda | null>(null);
  const actualizar = () => qc.invalidateQueries({ queryKey: ['cargos-cda'] });
  // Al cerrar la edición o la confirmación, el foco vuelve al botón que la abrió (WCAG 2.4.3).
  const focoPendiente = useRef<string | null>(null);
  useEffect(() => {
    if (!focoPendiente.current) return;
    document.getElementById(focoPendiente.current)?.focus();
    focoPendiente.current = null;
  });
  function cerrarEdicion(clave: string) {
    focoPendiente.current = idEditar(clave);
    setEditando(null);
  }
  function cerrarConfirmacion(clave: string) {
    focoPendiente.current = idEstado(clave);
    setConfirmando(null);
  }

  const cambiarActivo = useMutation({
    mutationFn: ({ c, activo }: { c: CargoCda; activo: boolean }) => cambiarActivoCargoCda(c.clave, activo),
    onSuccess: (r) => {
      sileo.success({ title: r.activo ? 'Cargo reactivado' : 'Cargo desactivado', description: r.nombre });
      cerrarConfirmacion(r.clave);
      actualizar();
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo cambiar el estado del cargo') }),
  });

  return (
    <Modal labelledBy="gestionar-cargos-titulo" onClose={onClose} maxWidth={820}>
      <div className="ocda-modal" aria-busy={isLoading || cambiarActivo.isPending}>
        <div className="ocda-modal-cabecera">
          <div>
            <h2 id="gestionar-cargos-titulo">Gestionar cargos</h2>
            <p className="muted">
              Se cambia solo el nombre que se ve. Desactivar saca el cargo del combo sin borrar a su personal.
            </p>
          </div>
          <button type="button" className="ocda-modal-cerrar" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {error && (
          <div className="banner error" role="alert">
            {mensajeError(error, 'No se pudieron cargar los cargos')}
          </div>
        )}
        {isLoading && <p className="muted">Cargando cargos…</p>}

        {cargos && (
          <div className="ocda-tabla compacta">
            <table aria-label="Cargos CDA y CPE">
              <thead>
                <tr>
                  <th scope="col">Cargo</th>
                  <th scope="col">Centro</th>
                  <th scope="col">Personas</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {cargos.map((c) => (
                  <tr key={c.clave}>
                    {editando?.clave === c.clave ? (
                      <EditarNombre cargo={c} cargos={cargos} onListo={() => cerrarEdicion(c.clave)} onGuardado={actualizar} />
                    ) : (
                      <>
                        <td>{c.nombre}</td>
                        <td>{c.centro}</td>
                        <td>{c.personas}</td>
                        <td>
                          <span className={`ocda-estado ${c.activo ? 'ok' : 'vacio'}`}>{c.activo ? 'Activo' : 'Desactivado'}</span>
                        </td>
                        <td>
                          <div className="ocda-cargos-acciones">
                            <button
                              type="button"
                              id={idEditar(c.clave)}
                              className="ocda-btn-texto"
                              aria-label={`Editar nombre de ${c.nombre}`}
                              onClick={() => setEditando(c)}
                            >
                              Editar nombre
                            </button>
                            {c.protegido ? (
                              <span className="muted">No se desactiva: la usa la app</span>
                            ) : c.activo ? (
                              <button
                                type="button"
                                className="ocda-btn-texto"
                                id={idEstado(c.clave)}
                                aria-label={`Desactivar ${c.nombre}`}
                                onClick={() => setConfirmando(c)}
                              >
                                Desactivar
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="ocda-btn-texto"
                                id={idEstado(c.clave)}
                                aria-label={`Reactivar ${c.nombre}`}
                                disabled={cambiarActivo.isPending}
                                onClick={() => cambiarActivo.mutate({ c, activo: true })}
                              >
                                Reactivar
                              </button>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {confirmando && (
          <div
            className="ocda-confirmar"
            role="alertdialog"
            aria-labelledby="desactivar-cargo-titulo"
            aria-describedby="desactivar-cargo-texto"
            onKeyDown={escapeCancela(() => cerrarConfirmacion(confirmando.clave))}
          >
            <h3 id="desactivar-cargo-titulo">¿Desactivar {confirmando.nombre}?</h3>
            <p id="desactivar-cargo-texto">
              {`Deja de salir en el combo Cargo. Sus ${personas(confirmando.personas)}, su asistencia, actas y carnets se conservan; puede reactivarlo cuando quiera.`}
            </p>
            <div className="ocda-modal-acciones">
              <button type="button" className="btn secondary" onClick={() => cerrarConfirmacion(confirmando.clave)} autoFocus>
                Cancelar
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={cambiarActivo.isPending}
                onClick={() => cambiarActivo.mutate({ c: confirmando, activo: false })}
              >
                {cambiarActivo.isPending ? 'Desactivando…' : 'Desactivar'}
              </button>
            </div>
          </div>
        )}

        {cargos && <AgregarCargo cargos={cargos} onCreado={actualizar} />}
      </div>
    </Modal>
  );
}

function EditarNombre({
  cargo: c,
  cargos,
  onListo,
  onGuardado,
}: {
  cargo: CargoCda;
  cargos: readonly CargoCda[];
  onListo: () => void;
  onGuardado: () => void;
}) {
  const [nombre, setNombre] = useState(c.nombre);
  const [errorNombre, setErrorNombre] = useState<string>();
  const guardar = useMutation({
    mutationFn: (n: string) => renombrarCargoCda(c.clave, n),
    onSuccess: (r) => {
      sileo.success({ title: 'Nombre actualizado', description: r.nombre });
      onGuardado();
      onListo();
    },
    onError: (e) => setErrorNombre(mensajeError(e, 'No se pudo cambiar el nombre')),
  });

  function enviar(e?: FormEvent) {
    e?.preventDefault();
    const r = renombrarCargoCdaSchema.safeParse({ nombre });
    if (!r.success) return setErrorNombre(r.error.issues[0]?.message);
    if (repetido(r.data.nombre, cargos, c.clave)) return setErrorNombre(REPETIDO);
    setErrorNombre(undefined);
    guardar.mutate(r.data.nombre);
  }

  const id = `cargo-nombre-${c.clave}`;
  return (
    <td colSpan={5}>
      <div className="ocda-cargos-editar" onKeyDown={escapeCancela(onListo)}>
        <label htmlFor={id} className="sr-only">
          Nuevo nombre de {c.nombre}
        </label>
        <input
          id={id}
          value={nombre}
          maxLength={80}
          autoFocus
          aria-invalid={errorNombre ? true : undefined}
          aria-describedby={errorNombre ? `${id}-error` : undefined}
          onChange={(e) => setNombre(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') enviar();
          }}
        />
        <button type="button" className="btn ocda-btn-chico" onClick={() => enviar()} disabled={guardar.isPending}>
          {guardar.isPending ? 'Guardando…' : 'Guardar nombre'}
        </button>
        <button type="button" className="btn secondary ocda-btn-chico" onClick={onListo} disabled={guardar.isPending}>
          Cancelar edición
        </button>
      </div>
      {errorNombre && (
        <span id={`${id}-error`} className="ocda-form-error" role="alert">
          {errorNombre}
        </span>
      )}
    </td>
  );
}

function AgregarCargo({ cargos, onCreado }: { cargos: readonly CargoCda[]; onCreado: () => void }) {
  const [nombre, setNombre] = useState('');
  const [centro, setCentro] = useState<CentroCda>('CPE');
  const [errorNombre, setErrorNombre] = useState<string>();
  const crear = useMutation({
    mutationFn: crearCargoCda,
    onSuccess: (r) => {
      sileo.success({ title: 'Cargo agregado', description: `${r.nombre} · ${r.centro}` });
      setNombre('');
      onCreado();
    },
    onError: (e) => setErrorNombre(mensajeError(e, 'No se pudo agregar el cargo')),
  });

  function enviar(e: FormEvent) {
    e.preventDefault();
    const r = crearCargoCdaSchema.safeParse({ nombre, centro });
    if (!r.success) {
      return setErrorNombre(r.error.issues.find((i) => i.path[0] === 'nombre')?.message ?? r.error.issues[0]?.message);
    }
    if (repetido(r.data.nombre, cargos)) return setErrorNombre(REPETIDO);
    setErrorNombre(undefined);
    crear.mutate(r.data);
  }

  return (
    <form className="ocda-form" onSubmit={enviar} noValidate aria-labelledby="agregar-cargo-titulo">
      <h3 id="agregar-cargo-titulo" className="ancho ocda-subtitulo-modal">
        Agregar cargo
      </h3>
      <Campo
        id="cargo-nuevo-nombre"
        etiqueta="Nombre del cargo nuevo"
        error={errorNombre}
        ayuda="Como saldrá en el combo, en plural. Ej.: Técnicos de sala."
        ancho={false}
      >
        <input value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} />
      </Campo>
      <Campo id="cargo-nuevo-centro" etiqueta="Centro" ayuda="No se puede cambiar después." ancho={false}>
        <select value={centro} onChange={(e) => setCentro(e.target.value as CentroCda)}>
          {(Object.keys(NOMBRE_CENTRO) as CentroCda[]).map((c) => (
            <option key={c} value={c}>
              {NOMBRE_CENTRO[c]}
            </option>
          ))}
        </select>
      </Campo>
      <div className="ancho ocda-modal-acciones">
        <button type="submit" className="btn" disabled={crear.isPending}>
          {crear.isPending ? 'Agregando…' : 'Agregar cargo'}
        </button>
      </div>
    </form>
  );
}
