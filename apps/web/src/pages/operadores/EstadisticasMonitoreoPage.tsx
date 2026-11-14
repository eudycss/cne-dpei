import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Cargando } from '../../components/Cargando';
import { Pestanas } from '../../components/Pestanas';
import { NumeroAnimado } from '../../components/NumeroAnimado';
import { formatearFechaHora } from '../../lib/notifications';
import { getEstadisticasJornada } from '../../lib/queries/monitoreo';
import { AvanceEtapas } from './AvanceEtapas';
import { DonaEstados } from './DonaEstados';
import { OrdenLlegadaPanel } from './OrdenLlegadaPanel';
import { REFRESCO_MONITOREO_MS } from './MonitoreoPage';
import { ETAPAS, avanceNoCda, avancePorEtapa, embudo, porcentaje, repartoPorEstado, type Agrupacion, type EtapaClave } from './estadisticas';

const AGRUPACIONES: { valor: Agrupacion; etiqueta: string }[] = [
  { valor: 'canton', etiqueta: 'Por cantón' },
  { valor: 'tecnico', etiqueta: 'Por técnico' },
];

const SECCIONES = [
  { id: 'avance', etiqueta: 'Avance y horas' },
  { id: 'orden', etiqueta: 'Orden de llegada' },
] as const;

const fechaHora = (iso: string | null) => (iso ? formatearFechaHora(iso) : '—');

/**
 * Estadísticas de la jornada: cuántas parejas completaron cada etapa, por cantón
 * o por técnico, las llegadas a los NO CDA y la hora de cada pareja. Ordenado del
 * que más avanzó al que menos. Se actualiza solo, igual que el Monitoreo.
 */
export function EstadisticasMonitoreoPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['estadisticas-jornada'],
    queryFn: getEstadisticasJornada,
    refetchInterval: REFRESCO_MONITOREO_MS,
    refetchOnWindowFocus: true,
  });
  const [etapa, setEtapa] = useState<EtapaClave>('llegadaRecintoEn');
  const [agrupacion, setAgrupacion] = useState<Agrupacion>('canton');
  const info = ETAPAS.find((e) => e.clave === etapa)!;
  const sufijo = agrupacion === 'canton' ? 'por cantón' : 'por técnico';

  const porEtapa = useMemo(() => (data ? avancePorEtapa(data, etapa, agrupacion) : []), [data, etapa, agrupacion]);
  const noCda = useMemo(() => (data ? avanceNoCda(data, agrupacion) : []), [data, agrupacion]);
  const resumen = useMemo(() => (data ? embudo(data) : []), [data]);
  const reparto = useMemo(() => (data ? repartoPorEstado(data) : []), [data]);

  return (
    <div>
      <p style={{ margin: 0 }}>
        <Link to="/operadores">← Volver al Monitoreo</Link>
      </p>
      <h2>Estadísticas de la jornada</h2>

      {isLoading ? (
        <Cargando texto="Cargando estadísticas…" />
      ) : isError ? (
        <p style={{ color: 'var(--error)' }}>No se pudieron cargar las estadísticas.</p>
      ) : !data ? (
        <p className="muted">No hay un evento activo.</p>
      ) : (
        <>
          <p className="muted" style={{ marginTop: '-0.5rem' }}>
            {data.evento} · {data.unidades.length} parejas. Se actualiza cada {REFRESCO_MONITOREO_MS / 1000} segundos.
            {data.sinDistributivo ? ' No se pudo leer el distributivo: los técnicos aparecen como "Sin técnico".' : ''}
          </p>

          <div className="kpi-grid">
            {resumen.map((r, i) => (
              <div key={r.clave} className="kpi-card">
                <div className="kpi-label">{ETAPAS[i].etiqueta}</div>
                <div className="kpi-num">
                  <span className="sr-only">{r.hechos}</span>
                  <span aria-hidden="true">
                    <NumeroAnimado valor={r.hechos} />
                  </span>
                </div>
                <div className="kpi-detalle">
                  de {r.total} parejas · {porcentaje(r.hechos, r.total)} %
                </div>
              </div>
            ))}
          </div>

          <div className="card estad-seccion" style={{ margin: '1rem 0' }}>
            <DonaEstados reparto={reparto} />
          </div>

          <Pestanas pestanas={SECCIONES} porDefecto="avance" etiqueta="Secciones de las estadísticas">
            {(seccion) =>
              seccion === 'orden' ? (
                <OrdenLlegadaPanel datos={data} />
              ) : (
                <>
                <div className="ocda-filtros" role="group" aria-label="Agrupar el avance" style={{ margin: '1rem 0 0.5rem' }}>
                  {AGRUPACIONES.map((a) => (
                    <button
                      key={a.valor}
                      type="button"
                      className="ocda-chip"
                      aria-pressed={agrupacion === a.valor}
                      onClick={() => setAgrupacion(a.valor)}
                    >
                      {agrupacion === a.valor && <span aria-hidden="true">✓ </span>}
                      {a.etiqueta}
                    </button>
                  ))}
                </div>

                <div className="card estad-seccion" style={{ marginBottom: '1rem' }}>
                  <div className="ocda-filtros" role="group" aria-label="Etapa del recorrido" style={{ margin: '0 0 0.75rem' }}>
                    {ETAPAS.map((e) => (
                      <button
                        key={e.clave}
                        type="button"
                        className="ocda-chip"
                        aria-pressed={etapa === e.clave}
                        onClick={() => setEtapa(e.clave)}
                      >
                        {etapa === e.clave && <span aria-hidden="true">✓ </span>}
                        {e.etiqueta}
                      </button>
                    ))}
                  </div>
                  <AvanceEtapas
                    titulo={`${info.hecho} (parejas), ${sufijo}`}
                    grupos={porEtapa}
                    vacio="Aún no hay parejas con kit asignado."
                    etiquetaHecho="parejas"
                  />
                </div>

                <div className="card estad-seccion" style={{ marginBottom: '1rem' }}>
                  <AvanceEtapas
                    titulo={`Llegadas a los NO CDA, ${sufijo}`}
                    grupos={noCda}
                    vacio="No hay recintos NO CDA con su CDA en ruta."
                    etiquetaHecho="NO CDA visitados"
                  />
                </div>

                <div className="card">
                  <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>Hora de cada etapa por pareja</h3>
                  <div className="table-scroll table-scroll-alta" role="region" aria-label="Horas de cada etapa por pareja" tabIndex={0}>
                    <table className="table-sticky-first">
                      <thead>
                        <tr>
                          <th>Código</th>
                          <th>Recinto (CDA)</th>
                          <th>Cantón</th>
                          <th>Técnico</th>
                          <th>Operador</th>
                          <th>Asistente</th>
                          {ETAPAS.map((e) => (
                            <th key={e.clave}>{e.etiqueta}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.unidades.map((u, i) => (
                          <tr key={`${u.codigoRecinto}-${i}`}>
                            <td>{u.codigoRecinto}</td>
                            <td>{u.nombreRecinto}</td>
                            <td>{u.cantonNombre}</td>
                            <td>{u.tecnicoNombre || 'Sin técnico'}</td>
                            <td>{u.operadorNombre ?? '—'}</td>
                            <td>{u.asistenteNombre ?? '—'}</td>
                            {ETAPAS.map((e) => (
                              <td key={e.clave}>{fechaHora(u[e.clave])}</td>
                            ))}
                          </tr>
                        ))}
                        {data.unidades.length === 0 && (
                          <tr>
                            <td colSpan={6 + ETAPAS.length} className="muted" style={{ textAlign: 'center', padding: '1.5rem' }}>
                              Aún no hay parejas con kit asignado.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                </>
              )
            }
          </Pestanas>
        </>
      )}
    </div>
  );
}
