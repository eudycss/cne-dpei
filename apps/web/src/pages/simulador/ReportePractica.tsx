import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { FilaReporteSimulador, IntentoReporteSimulador, PracticaDigitacion } from '@cne/shared-types';
import { Modal } from '../../components/Modal';
import { textoTiempoIntento } from '@cne/shared-validation';
import { mensajeError } from '../operadores-cda/utils';
import { claveReporte, descargarReporteSimulador, fechaHoraEcuador, getReporteSimulador } from '../../lib/queries/simulador';

/** Mientras la práctica corre, el reporte se refresca solo. */
export const REFRESCO_REPORTE_MS = 30_000;

/** Se refresca si alguien está digitando o si todavía se puede empezar (o seguir) la práctica. */
export function debeRefrescar(practica: PracticaDigitacion, enCurso: number, ahora = Date.now()): boolean {
  if (enCurso > 0) return true;
  const finUltimoIntento = new Date(practica.fin).getTime() + practica.plazoMinutos * 60_000;
  return practica.activa && ahora >= new Date(practica.inicio).getTime() && ahora <= finUltimoIntento;
}

const ESTADO: Record<FilaReporteSimulador['estado'], { texto: string; clase: string }> = {
  NO_SE_PRESENTO: { texto: 'No se presentó', clase: 'vacio' },
  EN_CURSO: { texto: 'En curso', clase: 'pendiente' },
  TERMINADO: { texto: 'Terminó', clase: 'ok' },
};

const FILTROS = [
  { id: 'todos', texto: 'Todas' },
  { id: 'cumplieron', texto: 'Cumplieron la meta' },
  { id: 'no-cumplieron', texto: 'Terminaron sin cumplir' },
  { id: 'en-curso', texto: 'En curso' },
  { id: 'ausentes', texto: 'No se presentaron' },
] as const;
type Filtro = (typeof FILTROS)[number]['id'];

function pasaFiltro(f: FilaReporteSimulador, filtro: Filtro): boolean {
  switch (filtro) {
    case 'cumplieron':
      return f.cumplio;
    case 'no-cumplieron':
      return f.estado === 'TERMINADO' && !f.cumplio;
    case 'en-curso':
      return f.estado === 'EN_CURSO';
    case 'ausentes':
      return f.estado === 'NO_SE_PRESENTO';
    default:
      return true;
  }
}

export const mejorDe = (f: FilaReporteSimulador) => f.intentos.find((i) => i.numero === f.mejor) ?? null;

export function resultado(i: IntentoReporteSimulador): string {
  if (i.motivo === 'META') return 'Cumplió la meta';
  if (i.motivo === 'TIEMPO') return 'Se acabó el tiempo';
  return 'En curso';
}

function Descargas({ practicaId, operadorId, de }: { practicaId: string; operadorId?: string; de: string }) {
  const [bajando, setBajando] = useState<'xlsx' | 'pdf' | null>(null);
  async function bajar(formato: 'xlsx' | 'pdf') {
    if (bajando) return;
    setBajando(formato);
    try {
      await descargarReporteSimulador(practicaId, formato, operadorId);
    } catch (e) {
      sileo.error({ title: mensajeError(e, 'No se pudo descargar el reporte') });
    } finally {
      setBajando(null);
    }
  }
  return (
    <div className="ocda-cargos-acciones">
      {(['xlsx', 'pdf'] as const).map((f) => (
        <button
          key={f}
          type="button"
          className="btn secondary ocda-btn-chico"
          aria-label={bajando === f ? `Descargando ${f === 'xlsx' ? 'Excel' : 'PDF'}…` : `Descargar ${f === 'xlsx' ? 'Excel' : 'PDF'} ${de}`}
          aria-disabled={bajando !== null}
          onClick={() => void bajar(f)}
        >
          {bajando === f ? 'Descargando…' : f === 'xlsx' ? 'Excel' : 'PDF'}
        </button>
      ))}
    </div>
  );
}

/** Reporte de una práctica: general (mejor intento por persona) y el detalle de cada persona. */
export function ReportePractica({ practica, onVolver }: { practica: PracticaDigitacion; onVolver: () => void }) {
  const { data, isLoading, error, dataUpdatedAt } = useQuery({
    queryKey: claveReporte(practica.id),
    queryFn: () => getReporteSimulador(practica.id),
    refetchInterval: (q) => (debeRefrescar(practica, q.state.data?.totales.enCurso ?? 0) ? REFRESCO_REPORTE_MS : false),
  });
  // Al entrar, el foco va al título (el panel de prácticas se desmontó).
  const titulo = useRef<HTMLHeadingElement>(null);
  useEffect(() => titulo.current?.focus(), []);
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [persona, setPersona] = useState<FilaReporteSimulador | null>(null);
  const filas = data?.filas.filter((f) => pasaFiltro(f, filtro)) ?? [];
  // Una columna por intento: tantas como el que más intentos tiene (de todo el reporte, no solo del filtro).
  const columnasIntento = Array.from({ length: Math.max(1, ...(data?.filas ?? []).flatMap((f) => f.intentos.map((i) => i.numero))) }, (_, i) => i + 1);

  return (
    <section aria-labelledby="sim-reporte-titulo">
      <div className="sim-barra">
        <div>
          <h3 id="sim-reporte-titulo" className="sim-subtitulo" ref={titulo} tabIndex={-1}>
            Reporte: {practica.nombre}
          </h3>
          <p className="muted sim-nota">
            Meta: {practica.metaActas} actas en {practica.plazoMinutos} min. «Cumplió» = llegó a la meta dentro del tiempo. Por
            persona cuenta su mejor intento (el que cumplió; si no, el de más registros correctos). «Por minuto» = registros
            digitados entre los minutos usados (si se acabó el tiempo, todo el plazo).
          </p>
        </div>
        <div className="ocda-cargos-acciones">
          <Descargas practicaId={practica.id} de="del reporte general" />
          <button type="button" className="btn secondary ocda-btn-chico" onClick={onVolver}>
            Volver a prácticas
          </button>
        </div>
      </div>

      {error && (
        <div className="banner error" role="alert">
          {mensajeError(error, 'No se pudo cargar el reporte')}
        </div>
      )}
      {isLoading && (
        <p className="muted" role="status">
          Cargando reporte…
        </p>
      )}

      {data && (
        <>
          <dl className="sim-totales" aria-label="Resumen">
            <div>
              <dt>Personas</dt>
              <dd>{data.totales.personas}</dd>
            </div>
            <div>
              <dt>Se presentaron</dt>
              <dd>{data.totales.presentaron}</dd>
            </div>
            <div>
              <dt>Cumplieron la meta</dt>
              <dd>{data.totales.cumplieron}</dd>
            </div>
            <div>
              <dt>En curso</dt>
              <dd>{data.totales.enCurso}</dd>
            </div>
            <div>
              <dt>No se presentaron</dt>
              <dd>{data.totales.noSePresentaron}</dd>
            </div>
          </dl>

          <div className="sim-barra">
            <label className="ocda-form-campo">
              <span>Mostrar</span>
              <select value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)}>
                {FILTROS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.texto}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted sim-nota" aria-live="polite">
              {filas.length} de {data.filas.length}
            </p>
            <p className="muted sim-nota">
              Actualizado {new Date(dataUpdatedAt).toLocaleTimeString('es-EC', { timeZone: 'America/Guayaquil' })}
            </p>
          </div>

          {filas.length === 0 ? (
            <p className="muted">Nadie en este filtro.</p>
          ) : (
            <div className="ocda-tabla">
              <table aria-label={`Reporte de ${practica.nombre}`}>
                <thead>
                  <tr>
                    <th scope="col">Nº</th>
                    <th scope="col">Persona</th>
                    <th scope="col">Celular</th>
                    <th scope="col">Cargo</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Registros digitados</th>
                    <th scope="col">Correctos</th>
                    <th scope="col">Con error</th>
                    <th scope="col">Por minuto</th>
                    <th scope="col">Actas</th>
                    <th scope="col">Cumplió</th>
                    {columnasIntento.map((n) => (
                      <th key={n} scope="col">
                        Intento {n}
                      </th>
                    ))}
                    <th scope="col">Intentos</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, n) => {
                    const m = mejorDe(f);
                    const e = ESTADO[f.estado];
                    return (
                      <tr key={f.operadorId}>
                        <td>{n + 1}</td>
                        <th scope="row">
                          {f.apellidosNombres}
                          <div className="muted sim-detalle mono">
                            {f.cedula}
                            {!f.asignada && ' · ya no asignada'}
                          </div>
                        </th>
                        <td className="mono">{f.telefono ?? '—'}</td>
                        <td>{f.cargo}</td>
                        <td>
                          <span className={`ocda-estado ${e.clase}`}>{e.texto}</span>
                        </td>
                        <td>{m?.filasDigitadas ?? '—'}</td>
                        <td>{m?.filasCorrectas ?? '—'}</td>
                        <td>{m?.filasConError ?? '—'}</td>
                        <td>{m?.registrosPorMinuto ?? '—'}</td>
                        <td>{m ? `${m.actasCompletadas} de ${data.practica.metaActas}` : '—'}</td>
                        <td>{f.estado === 'NO_SE_PRESENTO' ? '—' : f.cumplio ? 'Sí' : 'No'}</td>
                        {columnasIntento.map((n) => {
                          const i = f.intentos.find((x) => x.numero === n);
                          return (
                            <td key={n} className="mono">
                              {i ? textoTiempoIntento(i) : '—'}
                            </td>
                          );
                        })}
                        <td>
                          {f.intentos.length > 0 ? (
                            <button
                              type="button"
                              className="ocda-btn-texto"
                              aria-label={`Ver los ${f.intentos.length} intento(s) de ${f.apellidosNombres}`}
                              onClick={() => setPersona(f)}
                            >
                              Ver {f.intentos.length}
                            </button>
                          ) : (
                            '0'
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
      )}

      {persona && (
        <DetallePersona
          practicaId={practica.id}
          // Con el refresco, que el modal muestre los datos más recientes de esa persona.
          persona={data?.filas.find((f) => f.operadorId === persona.operadorId) ?? persona}
          metaActas={practica.metaActas}
          onClose={() => setPersona(null)}
        />
      )}
    </section>
  );
}

function DetallePersona({
  practicaId,
  persona,
  metaActas,
  onClose,
}: {
  practicaId: string;
  persona: FilaReporteSimulador;
  metaActas: number;
  onClose: () => void;
}) {
  return (
    <Modal labelledBy="sim-persona-titulo" onClose={onClose} maxWidth={960}>
      <div className="login-card" style={{ width: '100%', maxWidth: 'none' }}>
        <div className="ocda-modal-cabecera">
          <div>
            <h2 id="sim-persona-titulo">{persona.apellidosNombres}</h2>
            <p className="muted">
              Cédula <span className="mono">{persona.cedula}</span> · Celular <span className="mono">{persona.telefono ?? '—'}</span> ·{' '}
              {persona.cargo}
            </p>
          </div>
        </div>
        <div className="ocda-tabla">
          <table aria-label={`Intentos de ${persona.apellidosNombres}`}>
            <thead>
              <tr>
                <th scope="col">Intento</th>
                <th scope="col">Inicio</th>
                <th scope="col">Resultado</th>
                <th scope="col">Tiempo</th>
                <th scope="col">Registros digitados</th>
                <th scope="col">Correctos</th>
                <th scope="col">Con error</th>
                <th scope="col">Por minuto</th>
                <th scope="col">Actas</th>
                <th scope="col">Sin errores</th>
              </tr>
            </thead>
            <tbody>
              {persona.intentos.map((i) => (
                <tr key={i.numero}>
                  <th scope="row">
                    {i.numero}
                    {i.numero === persona.mejor && <span className="ocda-estado ok sim-inactiva">Mejor</span>}
                  </th>
                  <td>{fechaHoraEcuador(i.iniciadoEn)}</td>
                  <td>{resultado(i)}</td>
                  <td className="mono">{textoTiempoIntento(i)}</td>
                  <td>{i.filasDigitadas}</td>
                  <td>{i.filasCorrectas}</td>
                  <td>{i.filasConError}</td>
                  <td>{i.registrosPorMinuto}</td>
                  <td>
                    {i.actasCompletadas} de {metaActas}
                  </td>
                  <td>{i.actasPerfectas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-acciones">
          <Descargas practicaId={practicaId} operadorId={persona.operadorId} de={`de ${persona.apellidosNombres}`} />
          <button type="button" className="btn secondary" onClick={onClose}>
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  );
}
