import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReporteFlujoItem, ReporteNoCdaItem } from '@cne/shared-types';
import { api } from '../../lib/api';
import { Logo } from '../../components/Logo';

function formatHora(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-EC', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function HitoCelda({ iso }: { iso: string | null }) {
  return iso ? (
    <span style={{ color: 'var(--success-text)' }}>✓ {formatHora(iso)}</span>
  ) : (
    <span style={{ color: 'var(--error)' }}>✗ Pendiente</span>
  );
}

export function ReporteNoCdaPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['reporte-no-cda'],
    queryFn: async () => {
      const res = await api.get<ReporteNoCdaItem[]>('/tracking/reporte-no-cda');
      return res.data;
    },
  });

  const { data: flujo, isLoading: isLoadingFlujo } = useQuery({
    queryKey: ['reporte-flujo'],
    queryFn: async () => {
      const res = await api.get<ReporteFlujoItem[]>('/tracking/reporte-flujo');
      return res.data;
    },
  });

  const [verNoCdas, setVerNoCdas] = useState(false);

  const totales = useMemo(() => {
    if (!data) return { llegados: 0, faltantes: 0 };
    return data.reduce(
      (acc, item) => ({
        llegados: acc.llegados + item.totalLlegados,
        faltantes: acc.faltantes + (item.totalNoCdas - item.totalLlegados),
      }),
      { llegados: 0, faltantes: 0 },
    );
  }, [data]);

  return (
    <>
      <style>{`
        @media print {
          .sidebar, .topbar, .no-print { display: none !important; }
        }
      `}</style>

      <div className="card no-print" style={{ marginBottom: '1rem' }}>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn secondary" onClick={() => window.print()} disabled={!flujo?.length}>
            Imprimir
          </button>
        </div>
      </div>

      <div className="card reporte-encabezado" style={{ marginBottom: '1rem' }}>
        <div className="row" style={{ alignItems: 'center', gap: '1rem' }}>
          <Logo height={56} />
          <div>
            <h2 style={{ margin: 0 }}>Reporte estados operador CDAs</h2>
            <div className="muted">CNE Imbabura — Evento electoral activo</div>
          </div>
        </div>
        <div className="row" style={{ gap: '1.5rem', marginTop: '0.75rem' }}>
          <span><strong>Total CDAs:</strong> {data?.length ?? 0}</span>
          <span><strong style={{ color: 'var(--success-text)' }}>✓ Total llegados:</strong> {totales.llegados}</span>
          <span><strong style={{ color: 'var(--error)' }}>✗ Total faltantes:</strong> {totales.faltantes}</span>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Flujo de CDAs</h2>
        <div className="muted" style={{ marginBottom: '0.75rem' }}>
          Salida DPI → Llegada al recinto → Salida del recinto → Llegada al DPI
        </div>

        {isLoadingFlujo ? (
          <p className="muted">Cargando…</p>
        ) : !flujo?.length ? (
          <p className="muted">No hay CDAs con operador asignado en el evento activo.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ minWidth: 1000 }}>
              <thead>
                <tr>
                  <th>Operador</th>
                  <th>Cédula</th>
                  <th>CDA</th>
                  <th>Kit(s)</th>
                  <th>Salida DPI</th>
                  <th>Llegada Recinto</th>
                  <th>Salida Recinto</th>
                  <th>Llegada DPI</th>
                </tr>
              </thead>
              <tbody>
                {flujo.map((item) => (
                  <tr key={item.cdaId}>
                    <td>{item.operadorNombre}</td>
                    <td>{item.operadorCedula}</td>
                    <td>{item.cdaCodigo} — {item.cdaNombre}</td>
                    <td>{item.kitsCodigos.join(', ') || '—'}</td>
                    <td><HitoCelda iso={item.salidaDpiEn} /></td>
                    <td><HitoCelda iso={item.llegadaRecintoEn} /></td>
                    <td><HitoCelda iso={item.salidaRecintoEn} /></td>
                    <td><HitoCelda iso={item.llegadaDpiEn} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card no-print" style={{ marginTop: '1rem' }}>
        <button className="btn secondary" onClick={() => setVerNoCdas((v) => !v)}>
          {verNoCdas ? 'Ocultar' : 'Mostrar'} reporte de CDAs con sus NO-CDAs
        </button>
      </div>

      {verNoCdas && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h2 style={{ marginTop: 0 }}>Reporte de CDAs con sus NO-CDAs</h2>

          {isLoading ? (
            <p className="muted">Cargando…</p>
          ) : !data?.length ? (
            <p className="muted">No hay CDAs con operador asignado en el evento activo.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ minWidth: 1000 }}>
                <thead>
                  <tr>
                    <th>Operador</th>
                    <th>Cédula</th>
                    <th>CDA</th>
                    <th>Kit(s)</th>
                    <th>Llegados</th>
                    <th>Faltan</th>
                    <th>NO-CDAs</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((item) => (
                    <tr key={item.cdaId}>
                      <td>{item.operadorNombre}</td>
                      <td>{item.operadorCedula}</td>
                      <td>{item.cdaCodigo} — {item.cdaNombre}</td>
                      <td>{item.kitsCodigos.join(', ') || '—'}</td>
                      <td><strong style={{ color: 'var(--success-text)' }}>{item.totalLlegados}</strong> / {item.totalNoCdas}</td>
                      <td><strong style={{ color: 'var(--error)' }}>{item.totalNoCdas - item.totalLlegados}</strong></td>
                      <td>
                        {item.noCdas.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          item.noCdas.map((nc) => (
                            <div key={nc.id} style={{ color: nc.llegado ? 'var(--success-text)' : 'var(--error)' }}>
                              {nc.llegado ? '✓' : '✗'} {nc.codigoRecinto} — {nc.nombre}
                            </div>
                          ))
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
