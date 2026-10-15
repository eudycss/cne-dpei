import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { sileo } from 'sileo';
import type { EstadisticasEnlacesResponse, PeriodoEstadisticasEnlaces } from '@cne/shared-types';
import { getEstadisticasEnlaces } from '../../lib/queries/enlaces';
import { formatearFechaHora } from '../../lib/notifications';

const PERIODOS: { valor: PeriodoEstadisticasEnlaces; etiqueta: string }[] = [
  { valor: 'dia', etiqueta: 'Día' },
  { valor: 'semana', etiqueta: 'Semana' },
  { valor: 'mes', etiqueta: 'Mes' },
];

const ZONA = 'America/Guayaquil';
// Ecuador continental no tiene horario de verano: UTC-5 todo el año.
const OFFSET_ECUADOR_MS = -5 * 60 * 60 * 1000;

/** Fecha de hoy en Ecuador como "AAAA-MM-DD". */
export function hoyEcuador(ahora = Date.now()): string {
  return new Date(ahora + OFFSET_ECUADOR_MS).toISOString().slice(0, 10);
}

/** Mueve la fecha `delta` días, semanas o meses (para ◀ ▶). */
export function desplazarFecha(fecha: string, periodo: PeriodoEstadisticasEnlaces, delta: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  const f =
    periodo === 'mes'
      ? new Date(Date.UTC(a, m - 1 + delta, 1))
      : new Date(Date.UTC(a, m - 1, d + delta * (periodo === 'semana' ? 7 : 1)));
  return f.toISOString().slice(0, 10);
}

/** 75 → "1 h 15 min". */
export function formatearDuracion(minutos: number): string {
  const m = Math.round(minutos);
  if (m < 60) return `${m} min`;
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const resto = m % 60;
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  return resto > 0 ? `${h} h ${resto} min` : `${h} h`;
}

/** "martes, 14 de octubre de 2026" / "del 12/10 al 18/10/2026" / "octubre de 2026". */
export function rotuloPeriodo(stats: Pick<EstadisticasEnlacesResponse, 'periodo' | 'desde' | 'hasta'>): string {
  const desde = new Date(stats.desde);
  const ultimoDia = new Date(new Date(stats.hasta).getTime() - 1);
  if (stats.periodo === 'mes') {
    return desde.toLocaleDateString('es-EC', { timeZone: ZONA, month: 'long', year: 'numeric' });
  }
  if (stats.periodo === 'semana') {
    const corto = (d: Date) => d.toLocaleDateString('es-EC', { timeZone: ZONA, day: '2-digit', month: '2-digit' });
    return `del ${corto(desde)} al ${ultimoDia.toLocaleDateString('es-EC', { timeZone: ZONA })}`;
  }
  return desde.toLocaleDateString('es-EC', {
    timeZone: ZONA,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function exportarExcel(stats: EstadisticasEnlacesResponse) {
  try {
    const wb = XLSX.utils.book_new();
    const ranking = XLSX.utils.aoa_to_sheet([
      ['#', 'Código', 'Recinto', 'Cantón', 'Caídas', 'Minutos caído', 'Tiempo caído', 'Disponibilidad (%)', 'Sigue caído'],
      ...stats.ranking.map((e, i) => [
        i + 1,
        e.codigoRecinto,
        e.nombreRecinto,
        e.canton,
        e.caidas,
        e.minutosCaido,
        formatearDuracion(e.minutosCaido),
        e.disponibilidad,
        e.sigueCaido ? 'Sí' : 'No',
      ]),
    ]);
    const sinCaidas = XLSX.utils.aoa_to_sheet([
      ['Código', 'Recinto', 'Cantón'],
      ...stats.sinCaidas.map((s) => [s.codigoRecinto, s.nombreRecinto, s.canton]),
    ]);
    XLSX.utils.book_append_sheet(wb, ranking, 'Más caídas');
    XLSX.utils.book_append_sheet(wb, sinCaidas, 'Sin caídas');
    XLSX.writeFile(wb, `estadisticas_enlaces_${stats.periodo}_${stats.desde.slice(0, 10)}.xlsx`);
  } catch (e) {
    sileo.error({ title: 'No se pudo exportar: ' + ((e as Error)?.message ?? '') });
  }
}

export function EstadisticasEnlaces() {
  const [periodo, setPeriodo] = useState<PeriodoEstadisticasEnlaces>('dia');
  const [fecha, setFecha] = useState(() => hoyEcuador());

  const { data, isLoading, isError, isFetching } = useQuery({
    queryKey: ['enlaces-estadisticas', periodo, fecha],
    queryFn: () => getEstadisticasEnlaces(periodo, fecha),
    refetchInterval: 60_000,
    // Al cambiar de período se sigue viendo el anterior hasta que llega el nuevo (sin parpadeo).
    placeholderData: keepPreviousData,
  });

  // No se puede avanzar a un período que todavía no empieza.
  const siguiente = desplazarFecha(fecha, periodo, 1);
  const hayFuturo = data ? new Date(data.hasta).getTime() > Date.now() : siguiente > hoyEcuador();
  const maxMinutos = Math.max(1, ...(data?.ranking.map((e) => e.minutosCaido) ?? []));
  const totalCaidas = data?.ranking.reduce((n, e) => n + e.caidas, 0) ?? 0;

  return (
    <section aria-labelledby="titulo-estadisticas">
      <h3 id="titulo-estadisticas" style={{ marginTop: 0 }}>
        Enlaces que más se caen
      </h3>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div role="group" aria-label="Período" style={{ display: 'flex', gap: '0.5rem' }}>
          {PERIODOS.map((p) => (
            <button
              key={p.valor}
              type="button"
              className={periodo === p.valor ? 'btn' : 'btn secondary'}
              aria-pressed={periodo === p.valor}
              onClick={() => setPeriodo(p.valor)}
            >
              {p.etiqueta}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
          <button
            type="button"
            className="btn secondary"
            aria-label="Período anterior"
            style={{ minHeight: 44, minWidth: 44 }}
            onClick={() => setFecha(desplazarFecha(fecha, periodo, -1))}
          >
            ◀
          </button>
          <span
            aria-live="polite"
            aria-busy={isFetching}
            style={{ minWidth: 190, textAlign: 'center', textTransform: 'capitalize' }}
          >
            {data ? rotuloPeriodo(data) : ''}
          </span>
          <button
            type="button"
            className="btn secondary"
            aria-label="Período siguiente"
            style={{ minHeight: 44, minWidth: 44 }}
            disabled={hayFuturo}
            onClick={() => setFecha(siguiente)}
          >
            ▶
          </button>
          {fecha !== hoyEcuador() && (
            <button
              type="button"
              className="btn secondary"
              style={{ minHeight: 44 }}
              onClick={() => setFecha(hoyEcuador())}
            >
              Hoy
            </button>
          )}
        </div>
        <button
          type="button"
          className="btn secondary"
          style={{ marginLeft: 'auto' }}
          disabled={!data}
          onClick={() => data && exportarExcel(data)}
        >
          Exportar Excel
        </button>
      </div>

      {data?.datosParciales && (
        <div className="banner" role="status">
          <span aria-hidden="true">ℹ️ </span>
          El historial de caídas se registra desde el {formatearFechaHora(data.historialDesde)}: antes de esa fecha no
          hay datos, así que este período está incompleto.
        </div>
      )}

      {isLoading ? (
        <p className="muted">Cargando estadísticas…</p>
      ) : isError || !data ? (
        <p className="muted" role="alert">
          No se pudieron cargar las estadísticas.
        </p>
      ) : (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            {totalCaidas} caída{totalCaidas === 1 ? '' : 's'} en {data.ranking.length} recinto
            {data.ranking.length === 1 ? '' : 's'} · {data.sinCaidas.length} de {data.totalRecintos} sin caídas.
            Precisión de 5 minutos.
          </p>

          {data.ranking.length === 0 ? (
            <p className="muted" style={{ textAlign: 'center', padding: '1.5rem 0' }}>
              Ningún enlace se cayó en este período.
            </p>
          ) : (
            <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
              <table>
                <caption className="sr-only">
                  Recintos con caídas, de más a menos
                </caption>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Código</th>
                    <th scope="col">Recinto</th>
                    <th scope="col">Cantón</th>
                    <th scope="col">Caídas</th>
                    <th scope="col">Tiempo caído</th>
                    <th scope="col">Disponibilidad</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ranking.map((e, i) => (
                    <tr key={e.codigoRecinto}>
                      <td>{i + 1}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{e.codigoRecinto}</td>
                      <td>
                        {e.nombreRecinto}
                        {e.sigueCaido && (
                          <span style={{ color: 'var(--error-text)', marginLeft: '0.4rem', fontSize: '0.85rem', fontWeight: 600 }}>
                            (sigue caído)
                          </span>
                        )}
                      </td>
                      <td>{e.canton || '—'}</td>
                      <td>
                        {e.caidas === 0 ? (
                          <span title="La caída empezó en el período anterior">0 (venía caído)</span>
                        ) : (
                          e.caidas
                        )}
                      </td>
                      <td style={{ minWidth: 150 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div
                            aria-hidden="true"
                            style={{
                              height: 8,
                              borderRadius: 4,
                              background: 'var(--error)',
                              width: `${Math.max(4, (e.minutosCaido / maxMinutos) * 80)}px`,
                            }}
                          />
                          <span style={{ whiteSpace: 'nowrap' }}>{formatearDuracion(e.minutosCaido)}</span>
                        </div>
                      </td>
                      <td>{e.disponibilidad.toFixed(1)} %</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <details style={{ marginTop: '1rem' }}>
            <summary>Nunca se cayeron en este período ({data.sinCaidas.length})</summary>
            {data.sinCaidas.length === 0 ? (
              <p className="muted">Todos los recintos tuvieron al menos una caída.</p>
            ) : (
              <ul style={{ columns: '2 260px', marginTop: '0.5rem' }}>
                {data.sinCaidas.map((s) => (
                  <li key={s.codigoRecinto}>
                    {s.codigoRecinto} — {s.nombreRecinto}
                    {s.canton ? ` (${s.canton})` : ''}
                  </li>
                ))}
              </ul>
            )}
          </details>
        </>
      )}
    </section>
  );
}
