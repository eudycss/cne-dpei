import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { NovedadDigitacion } from '@cne/shared-types';
import { nombreNovedadDigitacionSchema } from '@cne/shared-validation';
import { mensajeError } from '../operadores-cda/utils';
import {
  CLAVE_NOVEDADES,
  cambiarActivaNovedadDigitacion,
  crearNovedadDigitacion,
  getNovedadesDigitacion,
  renombrarNovedadDigitacion,
} from '../../lib/queries/simulador';

const idEditar = (id: string) => `novedad-editar-${id}`;

/** Primer error del esquema compartido, o null si el nombre es válido. */
function errorNombre(nombre: string): string | null {
  const r = nombreNovedadDigitacionSchema.safeParse({ nombre });
  return r.success ? null : r.error.issues[0].message;
}

/**
 * Catálogo de novedades del combo "Seleccione Novedad" del SIER. Por ahora
 * solo se mantiene la lista; las actas con novedad se califican después.
 */
export function NovedadesPanel() {
  const qc = useQueryClient();
  const { data: novedades, isLoading, error } = useQuery({ queryKey: CLAVE_NOVEDADES, queryFn: getNovedadesDigitacion });
  const actualizar = () => qc.invalidateQueries({ queryKey: CLAVE_NOVEDADES });
  const [nombre, setNombre] = useState('');
  const [errorNuevo, setErrorNuevo] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  // Al cerrar la edición, el foco vuelve a su botón "Editar" (WCAG 2.4.3).
  const focoPendiente = useRef<string | null>(null);
  useEffect(() => {
    if (!focoPendiente.current) return;
    document.getElementById(focoPendiente.current)?.focus();
    focoPendiente.current = null;
  });
  function cerrarEdicion(id: string) {
    focoPendiente.current = idEditar(id);
    setEditando(null);
  }

  const crear = useMutation({
    mutationFn: crearNovedadDigitacion,
    onSuccess: (n) => {
      sileo.success({ title: 'Novedad agregada', description: n.nombre });
      setNombre('');
      actualizar();
    },
    onError: (e) => setErrorNuevo(mensajeError(e, 'No se pudo agregar la novedad')),
  });

  const cambiarActiva = useMutation({
    mutationFn: (n: NovedadDigitacion) => cambiarActivaNovedadDigitacion(n.id, !n.activa),
    onSuccess: (n) => {
      sileo.success({ title: n.activa ? 'Novedad activada' : 'Novedad desactivada', description: n.nombre });
      actualizar();
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo cambiar el estado') }),
  });

  function onAgregar(e: FormEvent) {
    e.preventDefault();
    const err = errorNombre(nombre);
    setErrorNuevo(err);
    if (err) document.getElementById('novedad-nueva')?.focus();
    else crear.mutate(nombre.trim());
  }

  return (
    <section aria-labelledby="sim-novedades-titulo">
      <h3 id="sim-novedades-titulo" className="sim-subtitulo">
        Novedades del SIER
      </h3>
      <p className="muted sim-nota">
        Las opciones del combo «Seleccione Novedad». Se usarán para calificar las actas con novedad en una próxima
        versión.
      </p>

      <form className="sim-agregar" onSubmit={onAgregar} noValidate>
        <div className="ocda-form-campo">
          <label htmlFor="novedad-nueva">Nueva novedad</label>
          <input
            id="novedad-nueva"
            value={nombre}
            maxLength={120}
            aria-required
            aria-invalid={errorNuevo ? true : undefined}
            aria-describedby={errorNuevo ? 'novedad-nueva-error' : undefined}
            onChange={(e) => {
              setNombre(e.target.value);
              setErrorNuevo(null);
            }}
          />
          {errorNuevo && (
            <span id="novedad-nueva-error" className="ocda-form-error" role="alert">
              {errorNuevo}
            </span>
          )}
        </div>
        <button type="submit" className="btn primary ocda-btn-chico" disabled={crear.isPending}>
          Agregar
        </button>
      </form>

      {error && (
        <div className="banner error" role="alert">
          {mensajeError(error, 'No se pudieron cargar las novedades')}
        </div>
      )}
      {isLoading && (
        <p className="muted" role="status">
          Cargando novedades…
        </p>
      )}
      {novedades && novedades.length === 0 && <p className="muted">Aún no hay novedades cargadas.</p>}

      {novedades && novedades.length > 0 && (
        <div className="ocda-tabla compacta">
          <table aria-label="Novedades del SIER">
            <thead>
              <tr>
                <th scope="col">Novedad</th>
                <th scope="col">Estado</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {novedades.map((n) =>
                editando === n.id ? (
                  <EditarNovedad key={n.id} novedad={n} onListo={() => cerrarEdicion(n.id)} onGuardada={actualizar} />
                ) : (
                  <tr key={n.id}>
                    <td>{n.nombre}</td>
                    <td>
                      <span className={`ocda-estado ${n.activa ? 'ok' : 'vacio'}`}>{n.activa ? 'Activa' : 'Desactivada'}</span>
                    </td>
                    <td>
                      <div className="ocda-cargos-acciones">
                        <button
                          type="button"
                          id={idEditar(n.id)}
                          className="ocda-btn-texto"
                          aria-label={`Editar ${n.nombre}`}
                          onClick={() => setEditando(n.id)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="ocda-btn-texto"
                          aria-label={`${n.activa ? 'Desactivar' : 'Activar'} ${n.nombre}`}
                          disabled={cambiarActiva.isPending}
                          onClick={() => cambiarActiva.mutate(n)}
                        >
                          {n.activa ? 'Desactivar' : 'Activar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function EditarNovedad({
  novedad,
  onListo,
  onGuardada,
}: {
  novedad: NovedadDigitacion;
  onListo: () => void;
  onGuardada: () => void;
}) {
  const [nombre, setNombre] = useState(novedad.nombre);
  const [error, setError] = useState<string | null>(null);
  const id = `novedad-${novedad.id}`;
  const renombrar = useMutation({
    mutationFn: (n: string) => renombrarNovedadDigitacion(novedad.id, n),
    onSuccess: (n) => {
      sileo.success({ title: 'Nombre actualizado', description: n.nombre });
      onGuardada();
      onListo();
    },
    onError: (e) => setError(mensajeError(e, 'No se pudo cambiar el nombre')),
  });

  function guardar() {
    const err = errorNombre(nombre);
    setError(err);
    if (!err) renombrar.mutate(nombre.trim());
  }

  return (
    <tr>
      <td colSpan={2}>
        <div className="ocda-form-campo">
          <label htmlFor={id}>Nombre de la novedad</label>
          <input
            id={id}
            value={nombre}
            maxLength={120}
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            aria-required
            onChange={(e) => {
              setNombre(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                guardar();
              } else if (e.key === 'Escape') onListo();
            }}
          />
          {error && (
            <span id={`${id}-error`} className="ocda-form-error" role="alert">
              {error}
            </span>
          )}
        </div>
      </td>
      <td>
        <div className="ocda-cargos-acciones">
          <button type="button" className="ocda-btn-texto" disabled={renombrar.isPending} onClick={guardar}>
            Guardar
          </button>
          <button type="button" className="ocda-btn-texto" onClick={onListo}>
            Cancelar
          </button>
        </div>
      </td>
    </tr>
  );
}
