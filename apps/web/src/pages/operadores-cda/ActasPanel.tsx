import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { ActaCdaFila } from '@cne/shared-types';
import { useAuth } from '../../auth/AuthContext';
import { SearchInput } from '../../components/SearchInput';
import { Cargando } from '../../components/Cargando';
import {
  descargarActaCda,
  descargarActasCdaZip,
  firmarActaCda,
  getActasCda,
  reabrirActaCda,
} from '../../lib/queries/operadores-cda';
import { useGrupoCda } from './grupo';
import { AccionesEncabezado } from './AccionesEncabezado';
import { useModulos } from '../../lib/useModulos';
import { GenerarActasModal } from './GenerarActasModal';
import { Kpi } from './Kpi';
import { cargoCorto, iniciales, normalizar } from './utils';

type Filtro = 'todos' | 'sin-acta' | 'generadas' | 'firmadas';

const FILTROS: { id: Filtro; etiqueta: string; cumple: (f: ActaCdaFila) => boolean }[] = [
  { id: 'todos', etiqueta: 'Todos', cumple: () => true },
  { id: 'sin-acta', etiqueta: 'Sin acta', cumple: (f) => !f.acta },
  { id: 'generadas', etiqueta: 'Por firmar', cumple: (f) => f.acta?.estado === 'GENERADA' },
  { id: 'firmadas', etiqueta: 'Firmadas', cumple: (f) => f.acta?.estado === 'FIRMADA' },
];

function mensajeError(e: unknown, porDefecto: string): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? porDefecto;
}

/** AAAA-MM-DD → "22/10/2026". */
function fechaCorta(dia: string): string {
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

/**
 * Actas de entrega de indumentaria y credencial: se eligen operadores, se
 * generan con los datos comunes y se descargan en Word, PDF o un ZIP con
 * ambos. Firmada la impresa, se marca aquí; solo el administrador la reabre.
 */
export function ActasPanel({ acciones = null }: { acciones?: HTMLElement | null }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const esAdmin = user?.roles.includes('ADMINISTRADOR') ?? false;
  const puedeActas = useModulos().puede('cda.actas.gestionar');
  const { grupo, plural, singular, Singular } = useGrupoCda();
  const [busqueda, setBusqueda] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [elegidos, setElegidos] = useState<ReadonlySet<string>>(new Set<string>());
  const [generando, setGenerando] = useState<ActaCdaFila[] | null>(null);
  const [bajando, setBajando] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({ queryKey: ['actas-cda', grupo], queryFn: () => getActasCda(grupo) });
  const refrescar = () => qc.invalidateQueries({ queryKey: ['actas-cda'] });

  const filas = data ?? [];
  const conteo = (f: Filtro) => filas.filter(FILTROS.find((x) => x.id === f)!.cumple).length;
  const visibles = useMemo(() => {
    const q = normalizar(busqueda.trim());
    const cumple = FILTROS.find((x) => x.id === filtro)!.cumple;
    return filas.filter(
      (f) => cumple(f) && (!q || normalizar(f.operador.apellidosNombres).includes(q) || f.operador.cedula.includes(q)),
    );
  }, [filas, filtro, busqueda]);

  // Solo cuentan los elegidos que siguen visibles: lo que se ve es lo que se genera.
  const elegidasFilas = visibles.filter((f) => elegidos.has(f.operador.id));
  const conActa = elegidasFilas.filter((f) => f.acta);
  const todosVisibles = visibles.length > 0 && elegidasFilas.length === visibles.length;

  function alternar(id: string) {
    setElegidos((prev) => {
      const s = new Set<string>(prev);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });
  }

  function alternarTodos() {
    setElegidos(todosVisibles ? new Set<string>() : new Set<string>(visibles.map((f) => f.operador.id)));
  }

  const cambiarEstado = useMutation({
    mutationFn: ({ id, accion }: { id: string; accion: 'firmar' | 'reabrir' }) =>
      accion === 'firmar' ? firmarActaCda(id) : reabrirActaCda(id),
    onSuccess: (_a, { accion }) =>
      sileo.success({ title: accion === 'firmar' ? 'Acta marcada como firmada' : 'Acta reabierta para corregirla' }),
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo cambiar el estado del acta') }),
    onSettled: refrescar,
  });

  async function bajar(clave: string, accion: () => Promise<void>) {
    setBajando(clave);
    try {
      await accion();
    } catch (e) {
      sileo.error({ title: mensajeError(e, 'No se pudo descargar') });
    } finally {
      setBajando(null);
    }
  }

  const total = filas.length;
  const generadas = total - conteo('sin-acta');
  const firmadas = conteo('firmadas');

  return (
    <>
      <AccionesEncabezado destino={acciones}>
        {puedeActas && (
          <>
            <button
              type="button"
              className="btn secondary"
              disabled={conActa.length === 0 || bajando !== null}
              onClick={() => void bajar('zip', () => descargarActasCdaZip(conActa.map((f) => f.operador.id)))}
            >
              {bajando === 'zip' ? 'Preparando ZIP…' : `Descargar ZIP (${conActa.length})`}
            </button>
            <button
              type="button"
              className="btn"
              disabled={elegidasFilas.length === 0}
              onClick={() => setGenerando(elegidasFilas)}
            >
              Generar actas ({elegidasFilas.length})
            </button>
          </>
        )}
      </AccionesEncabezado>

      {data && (
        <div className="ocda-kpis" role="group" aria-label="Resumen de actas">
          <Kpi etiqueta="Actas generadas" valor={`${generadas} / ${total}`} parte={generadas} total={total} detalle={`${total - generadas} sin acta`} />
          <Kpi etiqueta="Firmadas" valor={`${firmadas} / ${total}`} parte={firmadas} total={total} detalle={`${conteo('generadas')} por firmar`} />
        </div>
      )}

      <div className="ocda-filtros">
        <span className="ocda-campo" style={{ flex: '1 1 260px', maxWidth: 360 }}>
          <SearchInput
            value={busqueda}
            onChange={setBusqueda}
            placeholder="Buscar por nombre o cédula…"
            ariaLabel={`Buscar ${singular} por nombre o cédula`}
          />
        </span>
        <div className="ocda-filtros" role="group" aria-label="Filtrar por estado del acta" style={{ margin: 0 }}>
          {FILTROS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="ocda-chip"
              aria-pressed={filtro === f.id}
              onClick={() => setFiltro(f.id)}
            >
              {filtro === f.id && <span aria-hidden="true">✓ </span>}
              {f.etiqueta} · {data ? conteo(f.id) : '…'}
            </button>
          ))}
        </div>
      </div>

      {isLoading && <Cargando />}
      {error && (
        <div className="banner error" role="alert">
          {mensajeError(error, 'No se pudieron cargar las actas.')}
        </div>
      )}
      {data && filas.length === 0 && <p className="muted">Aún no hay {plural}. Impórtelos desde la pestaña Listado.</p>}

      {data && filas.length > 0 && (
        <div className="ocda-tabla" tabIndex={0} role="region" aria-label="Actas de entrega">
          <table>
            <caption className="sr-only">
              Actas de entrega: {visibles.length} {singular}(es) con el filtro actual, {elegidasFilas.length} elegido(s)
            </caption>
            <thead>
              <tr>
                <th scope="col" className="ocda-col-check">
                  <input
                    type="checkbox"
                    className="ocda-casilla"
                    checked={todosVisibles}
                    onChange={alternarTodos}
                    aria-label={`Elegir todos los ${plural} mostrados`}
                  />
                </th>
                <th scope="col">{Singular}</th>
                <th scope="col">Cédula</th>
                <th scope="col">Entrega</th>
                <th scope="col">Estado</th>
                <th scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => {
                const o = f.operador;
                const a = f.acta;
                return (
                  <tr key={o.id}>
                    <td className="ocda-col-check">
                      <input
                        type="checkbox"
                        className="ocda-casilla"
                        checked={elegidos.has(o.id)}
                        onChange={() => alternar(o.id)}
                        aria-label={`Elegir a ${o.apellidosNombres}`}
                      />
                    </td>
                    <th scope="row">
                      <span className="ocda-persona">
                        <span className={`ocda-avatar${o.tieneFoto ? ' con-foto' : ''}`} aria-hidden="true">
                          {iniciales(o.apellidosNombres)}
                        </span>
                        <span className="ocda-persona-textos">
                          <span className="ocda-persona-nombre">{o.apellidosNombres}</span>
                          <span className="ocda-persona-cargo" title={o.cargo}>
                            {cargoCorto(o.cargo)}
                          </span>
                        </span>
                      </span>
                    </th>
                    <td className="mono">{o.cedula}</td>
                    <td>
                      {a ? (
                        <span className="ocda-persona-textos">
                          <span>Ing. {a.entregaNombre}</span>
                          <span className="ocda-persona-cargo">
                            {fechaCorta(a.fecha)} · {a.lugar}
                          </span>
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <span className={`ocda-estado ${a?.estado === 'FIRMADA' ? 'ok' : a ? 'pendiente' : 'vacio'}`}>
                        {a?.estado === 'FIRMADA' ? 'Firmada' : a ? 'Por firmar' : 'Sin acta'}
                      </span>
                    </td>
                    <td>
                      <div className="ocda-fila-acciones">
                        {!puedeActas && <span className="muted">Solo consulta</span>}
                        {puedeActas && !a && (
                          <button type="button" className="btn secondary ocda-btn-chico" onClick={() => setGenerando([f])}>
                            Generar<span className="sr-only"> acta de {o.apellidosNombres}</span>
                          </button>
                        )}
                        {puedeActas && a && (
                          <>
                            {(['docx', 'pdf'] as const).map((formato) => (
                              <button
                                key={formato}
                                type="button"
                                className="btn secondary ocda-btn-chico"
                                disabled={bajando !== null}
                                onClick={() => void bajar(`${o.id}-${formato}`, () => descargarActaCda(o.id, formato))}
                              >
                                {formato === 'docx' ? 'Word' : 'PDF'}
                                <span className="sr-only"> del acta de {o.apellidosNombres}</span>
                              </button>
                            ))}
                            {a.estado === 'GENERADA' && (
                              <>
                                <button type="button" className="btn secondary ocda-btn-chico" onClick={() => setGenerando([f])}>
                                  Corregir<span className="sr-only"> acta de {o.apellidosNombres}</span>
                                </button>
                                <button
                                  type="button"
                                  className="btn ocda-btn-chico"
                                  disabled={cambiarEstado.isPending}
                                  onClick={() => cambiarEstado.mutate({ id: o.id, accion: 'firmar' })}
                                >
                                  Marcar firmada<span className="sr-only">: {o.apellidosNombres}</span>
                                </button>
                              </>
                            )}
                            {a.estado === 'FIRMADA' && esAdmin && (
                              <button
                                type="button"
                                className="btn secondary ocda-btn-chico"
                                disabled={cambiarEstado.isPending}
                                onClick={() => cambiarEstado.mutate({ id: o.id, accion: 'reabrir' })}
                              >
                                Reabrir<span className="sr-only"> acta de {o.apellidosNombres}</span>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {visibles.length === 0 && <p className="ocda-pie">Ningún {singular} con este filtro.</p>}
          <p className="ocda-pie">
            Mostrando {visibles.length} de {total} {plural} · Elija varios para generar o descargar en lote
          </p>
        </div>
      )}

      {/* Anuncia la descarga en curso (el texto del botón cambia, pero eso no se lee solo). */}
      <p className="sr-only" role="status">
        {bajando === 'zip' ? 'Preparando el ZIP de actas…' : bajando ? 'Preparando la descarga…' : ''}
      </p>

      {generando && (
        <GenerarActasModal
          filas={generando}
          onClose={() => setGenerando(null)}
          onHecho={() => {
            setElegidos(new Set<string>());
            void refrescar();
          }}
        />
      )}
    </>
  );
}
