import { useId, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { registroLlegadaTexto } from '@cne/shared-validation';
import { Logo2027 } from '../../components/Logo2027';
import { useDescargaPdf } from '../../lib/useDescargaPdf';
import {
  duracionTexto,
  fechaCorta,
  getReporteLlegadaDpei,
  horaConDia,
  nombreReporteLlegadaDpei,
  pedirReporteLlegadaDpei,
} from '../../lib/queries/llegada-dpei';

/** Los CDA llegan uno a uno en la noche: se actualiza solo cada minuto. */
export const REFRESCO_LLEGADA_DPEI_MS = 60_000;

/** El 400 de la API trae un mensaje para el usuario (p. ej. una jornada futura); lo demás, uno genérico. */
function mensajeError(e: unknown): string {
  const r = (e as { response?: { status?: number; data?: { message?: unknown } } } | null)?.response;
  return r?.status === 400 && typeof r.data?.message === 'string' ? r.data.message : 'No se pudo cargar el reporte. Intente de nuevo.';
}

/**
 * Reportes › Llegada a la DPEI: una fila por CDA con la primera salida del
 * recinto de sus parejas y la llegada de la última. Sin atraso: los CDA salen
 * entre las 21:00 y las 02:00, así que solo se muestran horas y duración.
 */
export function LlegadaDpeiPage() {
  const idFecha = useId();
  // Vacío = el día de jornada actual (lo decide la API: a las 02:00 sigue siendo la noche anterior).
  const [fecha, setFecha] = useState('');
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reporte-llegada-dpei', fecha],
    queryFn: () => getReporteLlegadaDpei(fecha || undefined),
    // Un día pasado no cambia: solo la jornada actual se actualiza sola.
    refetchInterval: fecha ? false : REFRESCO_LLEGADA_DPEI_MS,
    // Al cambiar de jornada se queda la anterior a la vista hasta que llega la nueva (sin parpadeo).
    placeholderData: keepPreviousData,
  });
  const { descargando, descargar } = useDescargaPdf('No se pudo generar el reporte');

  function bajar(formato: 'xlsx' | 'pdf') {
    if (!data) return;
    void descargar(formato, () => pedirReporteLlegadaDpei(formato, fecha || undefined), nombreReporteLlegadaDpei(formato, data.fecha));
  }

  const r = data?.resumen;

  return (
    <>
      <div className="card reporte-encabezado" style={{ marginBottom: '1rem' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div className="row" style={{ alignItems: 'center', gap: '1rem' }}>
            <Logo2027 height={56} />
            <div>
              <h2 style={{ margin: 0 }}>Llegada de los CDA a la DPEI</h2>
              <div className="muted">
                {data ? `${data.evento} · Jornada del ${fechaCorta(data.fecha)}` : 'CNE Imbabura — Evento electoral activo'}
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: '0.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor={idFecha}>Jornada</label>
              <input id={idFecha} type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} aria-describedby={`${idFecha}-ayuda`} />
            </div>
            <button type="button" className="btn secondary" onClick={() => setFecha('')} disabled={!fecha}>
              Jornada actual
            </button>
            <button type="button" className="btn secondary" onClick={() => bajar('xlsx')} disabled={!data || descargando !== null}>
              {descargando === 'xlsx' ? 'Generando…' : 'Descargar Excel'}
            </button>
            <button type="button" className="btn secondary" onClick={() => bajar('pdf')} disabled={!data || descargando !== null}>
              {descargando === 'pdf' ? 'Generando…' : 'Descargar PDF'}
            </button>
          </div>
        </div>
        <p className="muted" style={{ margin: '0.5rem 0 0' }}>
          <span id={`${idFecha}-ayuda`}>La jornada cambia a las 04:00: una llegada a las 02:00 cuenta en la noche anterior.</span> Se
          actualiza cada minuto.
        </p>
      </div>

      {isLoading ? (
        <div className="card" role="status">
          Cargando…
        </div>
      ) : isError ? (
        <div className="card" role="alert">
          {mensajeError(error)}
        </div>
      ) : !data || !r ? (
        <div className="card">No hay un evento electoral activo.</div>
      ) : (
        <>
          <div className="kpi-grid" aria-label="Resumen de llegadas" role="group">
            <div className="kpi-card" style={{ ['--kpi-color' as string]: 'var(--success-text)' }}>
              <div className="kpi-label">Llegaron a la DPEI</div>
              <div className="kpi-num">{r.llegaron}</div>
              <div className="kpi-detalle">de {r.total} CDA</div>
            </div>
            <div className="kpi-card" style={{ ['--kpi-color' as string]: 'var(--error)' }}>
              <div className="kpi-label">Faltan</div>
              <div className="kpi-num">{r.faltan}</div>
              <div className="kpi-detalle">CDA</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Primera llegada</div>
              <div className="kpi-detalle">{horaConDia(r.primeraLlegadaEn)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Última llegada</div>
              <div className="kpi-detalle">{horaConDia(r.ultimaLlegadaEn)}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Duración promedio</div>
              <div className="kpi-detalle">{duracionTexto(r.duracionPromedioMin)}</div>
            </div>
          </div>

          <div className="card">
            {data.cdas.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No hay CDA con kit en este evento.
              </p>
            ) : (
              <div className="table-scroll" role="region" aria-label="Tabla de llegadas por CDA" tabIndex={0}>
                <table className="table-report">
                  <caption className="sr-only">
                    Llegada de cada CDA a la DPEI: primero los que faltan y luego los que llegaron, por hora
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">N°</th>
                      <th scope="col">Cantón</th>
                      <th scope="col">Código</th>
                      <th scope="col">CDA</th>
                      <th scope="col">Operador(es)</th>
                      <th scope="col">Kits</th>
                      <th scope="col">Parejas</th>
                      <th scope="col">Salida del recinto</th>
                      <th scope="col">Llegada a la DPEI</th>
                      <th scope="col">Duración</th>
                      <th scope="col">Registro</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cdas.map((c, i) => (
                      <tr key={c.codigoRecinto} className={c.llegadaDpiEn ? undefined : 'fila-falta'}>
                        <td>{i + 1}</td>
                        <td>{c.cantonNombre}</td>
                        <td>{c.codigoRecinto}</td>
                        <th scope="row" style={{ fontWeight: 600 }}>
                          {c.nombreRecinto}
                        </th>
                        <td>{c.operadores.join(', ') || '—'}</td>
                        <td>{c.kits.join(', ') || '—'}</td>
                        <td>
                          {c.parejasLlegadas} de {c.parejas}
                        </td>
                        <td>{horaConDia(c.salidaRecintoEn)}</td>
                        <td>
                          {c.llegadaDpiEn ? (
                            <span style={{ color: 'var(--success-text)' }}>
                              <span aria-hidden="true">✓ </span>
                              {horaConDia(c.llegadaDpiEn)}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--error-text)', fontWeight: 600 }}>
                              <span aria-hidden="true">✗ </span>Falta
                            </span>
                          )}
                        </td>
                        <td>{duracionTexto(c.duracionMin)}</td>
                        <td>{registroLlegadaTexto(c)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
