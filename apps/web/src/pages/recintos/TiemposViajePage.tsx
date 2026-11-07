import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { TiempoViajeRecinto } from '@cne/shared-types';
import { coincideBusqueda, minutosTiempoViajeSchema } from '@cne/shared-validation';
import { getTiemposViaje, guardarTiemposViaje } from '../../lib/queries/tiempos-viaje';
import { mensajeError } from '../operadores-cda/utils';

const CLAVE = ['recintos', 'tiempos-viaje'] as const;

const textoOriginal = (r: TiempoViajeRecinto) => (r.tiempoMin === null ? '' : String(r.tiempoMin));

/** Lo escrito en la casilla: vacío = sin tiempo (null); si no, minutos válidos o el mensaje de error. */
function leerMinutos(texto: string): { minutos: number | null } | { error: string } {
  const t = texto.trim();
  if (!t) return { minutos: null };
  const r = minutosTiempoViajeSchema.safeParse(Number(t));
  return r.success ? { minutos: r.data } : { error: r.error.issues[0]?.message ?? 'Minutos inválidos' };
}

/**
 * Tiempo de viaje de cada CDA desde la Delegación: el límite de los avisos de
 * retraso del bot Jornada (ida y vuelta). Los cambios se escriben en la tabla
 * y se guardan juntos con "Guardar cambios"; "Rellenar vacíos" solo propone.
 */
export function TiemposViajePage() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: CLAVE, queryFn: getTiemposViaje });
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [filtro, setFiltro] = useState('');

  const recintos = data?.recintos ?? [];
  const valor = (r: TiempoViajeRecinto) => borrador[r.id] ?? textoOriginal(r);
  const cambiados = recintos.filter((r) => valor(r).trim() !== textoOriginal(r));
  const errores = new Map(
    cambiados.flatMap((r) => {
      const l = leerMinutos(valor(r));
      return 'error' in l ? [[r.id, l.error] as const] : [];
    }),
  );
  const vaciosConSugerido = recintos.filter((r) => !valor(r).trim() && r.sugeridoMin !== null);
  const sinTiempo = recintos.filter((r) => r.tiempoMin === null).length;
  const q = filtro.trim();
  const visibles = q ? recintos.filter((r) => coincideBusqueda([r.codigo, r.nombre, r.canton], q)) : recintos;

  const escribir = (id: string, texto: string) => setBorrador((b) => ({ ...b, [id]: texto }));

  const guardar = useMutation({
    mutationFn: () =>
      guardarTiemposViaje({
        tiempos: cambiados.map((r) => ({ recintoId: r.id, minutos: (leerMinutos(valor(r)) as { minutos: number | null }).minutos })),
      }),
    onSuccess: async (r) => {
      // Primero la lista nueva y luego se limpia el borrador: si no, la tabla muestra un instante lo de antes.
      await qc.invalidateQueries({ queryKey: CLAVE });
      setBorrador({});
      sileo.success({ title: `${r.actualizados} ${r.actualizados === 1 ? 'tiempo guardado' : 'tiempos guardados'}` });
    },
  });

  if (isLoading) return <p className="muted">Cargando tiempos de viaje…</p>;
  if (error) {
    return (
      <p className="banner error" role="alert">
        {mensajeError(error, 'No se pudieron cargar los tiempos de viaje')}
      </p>
    );
  }

  return (
    <>
      <p className="muted">
        Minutos que tarda la pareja de cada CDA desde la Delegación (se usa también para la vuelta). Si pasa ese tiempo desde la
        salida sin registrar la llegada, el bot Jornada avisa del retraso. <strong>Sugerido</strong>: el viaje más largo medido en
        eventos anteriores + {data?.margenMin ?? 30} min; sin viajes medidos, el promedio de su cantón.
      </p>
      <p role="status">
        {sinTiempo === 0 ? 'Todos los CDA tienen tiempo de viaje.' : `${sinTiempo} de ${recintos.length} CDA sin tiempo de viaje.`}
      </p>

      <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
        <div className="field" style={{ margin: 0, flex: '1 1 220px' }}>
          <label htmlFor="tiempos-filtro">Buscar recinto</label>
          <input
            id="tiempos-filtro"
            type="search"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Código, nombre o cantón…"
            autoComplete="off"
          />
        </div>
        <button
          type="button"
          className="btn secondary"
          disabled={vaciosConSugerido.length === 0}
          onClick={() => setBorrador((b) => ({ ...b, ...Object.fromEntries(vaciosConSugerido.map((r) => [r.id, String(r.sugeridoMin)])) }))}
        >
          Rellenar vacíos con el sugerido ({vaciosConSugerido.length})
        </button>
        <button type="button" className="btn secondary" disabled={cambiados.length === 0 || guardar.isPending} onClick={() => setBorrador({})}>
          Descartar
        </button>
        <button
          type="button"
          className="btn"
          disabled={cambiados.length === 0 || errores.size > 0 || guardar.isPending}
          onClick={() => guardar.mutate()}
        >
          {guardar.isPending ? 'Guardando…' : `Guardar cambios (${cambiados.length})`}
        </button>
      </div>

      {guardar.isError && (
        <p className="banner error" role="alert">
          {mensajeError(guardar.error, 'No se pudieron guardar los tiempos')}
        </p>
      )}

      {visibles.length === 0 ? (
        <p className="muted" role="status">
          {recintos.length === 0 ? 'No hay CDA activos.' : 'Ningún CDA coincide con la búsqueda.'}
        </p>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table style={{ minWidth: 720 }}>
            <caption className="sr-only">Tiempo de viaje de cada CDA, en minutos</caption>
            <thead>
              <tr>
                <th scope="col">Cantón</th>
                <th scope="col">Recinto</th>
                <th scope="col">Medido</th>
                <th scope="col">Sugerido</th>
                <th scope="col">Tiempo (min)</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((r) => {
                const nombre = `${r.codigo} · ${r.nombre}`;
                const err = errores.get(r.id);
                const cambiado = cambiados.includes(r);
                return (
                  <tr key={r.id}>
                    <td>{r.canton}</td>
                    <td>{nombre}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.medidoMaxMin === null ? '—' : `${r.medidoMaxMin} min (${r.viajesMedidos} ${r.viajesMedidos === 1 ? 'viaje' : 'viajes'})`}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.sugeridoMin === null ? (
                        '—'
                      ) : (
                        <>
                          {r.sugeridoMin} min{' '}
                          <span className="muted" style={{ fontSize: '0.8rem' }}>
                            ({r.origenSugerido === 'CANTON' ? 'promedio del cantón' : 'medido'})
                          </span>
                          {valor(r).trim() !== String(r.sugeridoMin) && (
                            <button
                              type="button"
                              className="btn secondary"
                              style={{ marginLeft: '0.4rem', padding: '0.15rem 0.5rem', fontSize: '0.8rem' }}
                              onClick={() => escribir(r.id, String(r.sugeridoMin))}
                              aria-label={`Usar el sugerido (${r.sugeridoMin} min) en ${nombre}`}
                            >
                              Usar
                            </button>
                          )}
                        </>
                      )}
                    </td>
                    <td>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={5}
                        max={600}
                        value={valor(r)}
                        onChange={(e) => escribir(r.id, e.target.value)}
                        aria-label={`Tiempo de viaje de ${nombre}, en minutos`}
                        aria-invalid={err ? true : undefined}
                        aria-describedby={err ? `tiempo-error-${r.id}` : cambiado ? `tiempo-cambiado-${r.id}` : undefined}
                        placeholder="Sin tiempo"
                        style={{ width: '7rem', fontWeight: cambiado ? 700 : undefined }}
                      />
                      {/* Sin role="alert": se anunciaría a cada tecla. */}
                      {err ? (
                        <span id={`tiempo-error-${r.id}`} className="ocda-form-ayuda" aria-live="polite" style={{ display: 'block', color: 'var(--danger, #b91c1c)' }}>
                          {err}
                        </span>
                      ) : (
                        cambiado && (
                          <span id={`tiempo-cambiado-${r.id}`} className="ocda-form-ayuda" style={{ display: 'block' }}>
                            Sin guardar
                          </span>
                        )
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
