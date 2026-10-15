import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { sileo } from 'sileo';
import type { ReporteFlujoItem, ReporteNoCdaItem } from '@cne/shared-types';
import { api } from '../../lib/api';
import { Logo2027 } from '../../components/Logo2027';
import { useAuth } from '../../auth/AuthContext';
import { useDescargaPdf } from '../../lib/useDescargaPdf';
import {
  descargarInformeOperador,
  descargarInformesOperador,
  descargarReporteGeneral,
  getResponsablesInforme,
} from '../../lib/queries/informes-operador';

// Igual que MAX_INFORMES_POR_PDF en la API: con más operadores se pide elegir cantón.
const MAX_INFORMES_POR_PDF = 40;

// Último responsable elegido para firmar el informe (conveniencia por navegador).
const CLAVE_RESPONSABLE = 'informe-operador-responsable';

function leerResponsableGuardado(): string {
  try {
    return localStorage.getItem(CLAVE_RESPONSABLE) ?? '';
  } catch {
    return '';
  }
}

function guardarResponsable(id: string): void {
  try {
    localStorage.setItem(CLAVE_RESPONSABLE, id);
  } catch {
    /* sin almacenamiento: solo no se recuerda */
  }
}

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
  const { data } = useQuery({
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

  // El Informe del Operador CDA (y quién lo firma) es solo del administrador;
  // el lector ve el reporte en pantalla y el Excel.
  const { user } = useAuth();
  const isAdmin = user?.roles.includes('ADMINISTRADOR') ?? false;

  const { data: responsables } = useQuery({
    queryKey: ['responsables-informe'],
    queryFn: async () => (await getResponsablesInforme()).data,
    enabled: isAdmin,
  });

  const [vista, setVista] = useState<'flujo' | 'nocda'>('flujo');
  const [exporting, setExporting] = useState(false);
  const [responsableElegido, setResponsableElegido] = useState(leerResponsableGuardado);
  const [cantonInforme, setCantonInforme] = useState('');
  // Prueba de conexión y fotos de los reportes solo el día de elecciones: la
  // casilla nace desmarcada (pruebas técnicas) y no se recuerda, para que nadie
  // la deje marcada por error.
  const [incluirJornada, setIncluirJornada] = useState(false);
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());
  const { descargando, descargar } = useDescargaPdf('No se pudo generar el informe');

  // Solo vale un responsable que siga en la lista (activo y con rol para firmar).
  const responsableId = responsables?.some((r) => r.id === responsableElegido) ? responsableElegido : '';
  const opciones = { responsableId, incluirJornada };

  function alternarSeleccion(operadorId: string) {
    setSeleccionados((prev) => {
      const next = new Set(prev);
      if (next.has(operadorId)) next.delete(operadorId);
      else next.add(operadorId);
      return next;
    });
  }

  const cantonesFlujo = useMemo(() => {
    const mapa = new Map<number, string>();
    for (const f of flujo ?? []) if (f.cantonId !== null) mapa.set(f.cantonId, f.cantonNombre);
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }, [flujo]);

  const filasInforme = cantonInforme
    ? (flujo ?? []).filter((f) => f.cantonId === Number(cantonInforme)).length
    : (flujo?.length ?? 0);
  const demasiados = filasInforme > MAX_INFORMES_POR_PDF;
  const demasiadosElegidos = seleccionados.size > MAX_INFORMES_POR_PDF;
  // Motivo visible (y anunciado con aria-describedby) de por qué no se puede descargar.
  const avisoDescarga = !responsableId
    ? 'Elige el responsable que firma para descargar los informes.'
    : demasiadosElegidos
      ? `Elegiste ${seleccionados.size} operadores; el máximo por archivo es ${MAX_INFORMES_POR_PDF}.`
      : demasiados
        ? `Son ${filasInforme} operadores; el máximo por archivo es ${MAX_INFORMES_POR_PDF}. Elige un cantón u operadores.`
        : null;

  function elegirResponsable(id: string) {
    setResponsableElegido(id);
    guardarResponsable(id);
  }

  function handleExportExcel() {
    setExporting(true);
    try {
      const rows: any[][] = [];

      if (vista === 'flujo') {
        rows.push(['Reporte de flujo de CDAs — CNE Imbabura']);
        rows.push([]);
        rows.push([
          'Operador',
          'Cédula',
          'CDA',
          'Kit(s)',
          'Salida DPI',
          'Llegada Recinto',
          'Prueba de conexión',
          'Salida Recinto',
          'Llegada DPI',
        ]);
        for (const item of flujo ?? []) {
          rows.push([
            item.operadorNombre,
            item.operadorCedula,
            `${item.cdaCodigo} — ${item.cdaNombre}`,
            item.kitsCodigos.join(', ') || '—',
            item.salidaDpiEn ? formatHora(item.salidaDpiEn) : 'Pendiente',
            item.llegadaRecintoEn ? formatHora(item.llegadaRecintoEn) : 'Pendiente',
            item.pruebaConexionEn ? formatHora(item.pruebaConexionEn) : 'Pendiente',
            item.salidaRecintoEn ? formatHora(item.salidaRecintoEn) : 'Pendiente',
            item.llegadaDpiEn ? formatHora(item.llegadaDpiEn) : 'Pendiente',
          ]);
        }
      } else {
        rows.push(['Reporte de CDAs con sus NO-CDAs — CNE Imbabura']);
        rows.push([]);
        rows.push(['Operador', 'Cédula', 'CDA', 'Kit(s)', 'Llegados', 'Faltan', 'NO-CDAs']);
        for (const item of data ?? []) {
          const noCdasTexto =
            item.noCdas.length === 0
              ? '—'
              : item.noCdas.map((nc) => `${nc.llegado ? '✓' : '✗'} ${nc.codigoRecinto} — ${nc.nombre}`).join('; ');
          rows.push([
            item.operadorNombre,
            item.operadorCedula,
            `${item.cdaCodigo} — ${item.cdaNombre}`,
            item.kitsCodigos.join(', ') || '—',
            item.totalLlegados,
            item.totalNoCdas - item.totalLlegados,
            noCdasTexto,
          ]);
        }
      }

      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, vista === 'flujo' ? 'Flujo CDAs' : 'CDAs y NO-CDAs');
      XLSX.writeFile(wb, vista === 'flujo' ? 'reporte_flujo_cdas.xlsx' : 'reporte_cdas_nocdas.xlsx');
    } catch (e: any) {
      sileo.error({ title: 'No se pudo exportar: ' + (e?.message ?? '') });
    } finally {
      setExporting(false);
    }
  }

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
          .table-scroll { overflow: visible !important; }
          .table-report { min-width: 0 !important; width: 100% !important; font-size: 0.72rem; }
          th, td { padding: 0.3rem 0.25rem !important; }
        }
        @page {
          size: landscape;
          margin: 12mm;
        }
      `}</style>

      <div className="card reporte-encabezado" style={{ marginBottom: '1rem' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
          <div className="row" style={{ alignItems: 'center', gap: '1rem' }}>
            <Logo2027 height={56} />
            <div>
              <h2 style={{ margin: 0 }}>Reporte estados operador CDAs</h2>
              <div className="muted">CNE Imbabura — Evento electoral activo</div>
            </div>
          </div>
          <div className="row no-print" style={{ gap: '0.5rem' }}>
            <button className={vista === 'flujo' ? 'btn' : 'btn secondary'} onClick={() => setVista('flujo')}>
              Flujo de CDAs
            </button>
            <button className={vista === 'nocda' ? 'btn' : 'btn secondary'} onClick={() => setVista('nocda')}>
              CDAs con sus NO-CDAs
            </button>
            <button
              className="btn secondary"
              onClick={() => window.print()}
              disabled={vista === 'flujo' ? !flujo?.length : !data?.length}
            >
              Imprimir
            </button>
            <button
              className="btn secondary"
              onClick={handleExportExcel}
              disabled={exporting || (vista === 'flujo' ? !flujo?.length : !data?.length)}
              title="Exportar a Excel"
            >
              {exporting ? 'Exportando…' : '↓ Excel'}
            </button>
          </div>
        </div>
        <div className="row" style={{ gap: '1.5rem', marginTop: '0.75rem' }}>
          <span><strong>Total CDAs:</strong> {data?.length ?? 0}</span>
          <span><strong style={{ color: 'var(--success-text)' }}>✓ Total llegados:</strong> {totales.llegados}</span>
          <span><strong style={{ color: 'var(--error)' }}>✗ Total faltantes:</strong> {totales.faltantes}</span>
        </div>
      </div>

      <div className="card">
        {vista === 'flujo' ? (
          <>
            <h2 style={{ marginTop: 0 }}>Flujo de CDAs</h2>
            <div className="muted" style={{ marginBottom: '0.75rem' }}>
              Salida DPI → Llegada al recinto → Prueba de conexión → Salida del recinto → Llegada al DPI
            </div>

            {isAdmin && (
              <>
                <div
                  className="row no-print"
                  style={{ gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}
                >
                  <label className="row" style={{ gap: '0.35rem', alignItems: 'center' }}>
                    Responsable que firma
                    <select value={responsableId} onChange={(e) => elegirResponsable(e.target.value)}>
                      <option value="">Elige un responsable…</option>
                      {(responsables ?? []).map((r) => (
                        <option key={r.id} value={r.id}>{r.nombre}</option>
                      ))}
                    </select>
                  </label>
                  <label className="row" style={{ gap: '0.35rem', alignItems: 'center' }}>
                    Cantón
                    <select value={cantonInforme} onChange={(e) => setCantonInforme(e.target.value)}>
                      <option value="">Todos</option>
                      {cantonesFlujo.map(([id, nombre]) => (
                        <option key={id} value={id}>{nombre}</option>
                      ))}
                    </select>
                  </label>
                  <label className="row" style={{ gap: '0.35rem', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={incluirJornada}
                      onChange={(e) => setIncluirJornada(e.target.checked)}
                    />
                    Incluir prueba de conexión y fotos de los reportes (día de elecciones)
                  </label>
                </div>
                <div
                  className="row no-print"
                  style={{ gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}
                >
                  <button
                    className="btn secondary"
                    disabled={!responsableId || !seleccionados.size || demasiadosElegidos || descargando !== null}
                    aria-busy={descargando === 'seleccionados'}
                    aria-describedby={avisoDescarga ? 'informe-aviso' : undefined}
                    onClick={() =>
                      descargar(
                        'seleccionados',
                        () => descargarInformesOperador(opciones, { operadorIds: [...seleccionados] }),
                        'informes_operadores_cda.pdf',
                      )
                    }
                  >
                    {descargando === 'seleccionados' ? 'Generando…' : (
                      <>
                        <span aria-hidden="true">↓ </span>Descargar seleccionados ({seleccionados.size})
                      </>
                    )}
                  </button>
                  <button
                    className="btn secondary"
                    disabled={!responsableId || !filasInforme || demasiados || descargando !== null}
                    aria-busy={descargando === 'todos'}
                    aria-describedby={avisoDescarga ? 'informe-aviso' : undefined}
                    onClick={() =>
                      descargar(
                        'todos',
                        () =>
                          descargarInformesOperador(opciones, {
                            cantonId: cantonInforme ? Number(cantonInforme) : null,
                          }),
                        'informes_operadores_cda.pdf',
                      )
                    }
                  >
                    {descargando === 'todos' ? 'Generando…' : (
                      <>
                        <span aria-hidden="true">↓ </span>Descargar todos los informes
                      </>
                    )}
                  </button>
                  <button
                    className="btn secondary"
                    disabled={!responsableId || !filasInforme || descargando !== null}
                    aria-busy={descargando === 'general'}
                    aria-describedby={!responsableId ? 'informe-aviso' : undefined}
                    onClick={() =>
                      descargar(
                        'general',
                        () => descargarReporteGeneral(opciones, cantonInforme ? Number(cantonInforme) : null),
                        'reporte_general_cdas.pdf',
                      )
                    }
                  >
                    {descargando === 'general' ? 'Generando…' : (
                      <>
                        <span aria-hidden="true">↓ </span>Reporte general (PDF)
                      </>
                    )}
                  </button>
                </div>
                {avisoDescarga ? (
                  <p id="informe-aviso" className="muted no-print" style={{ marginTop: 0 }}>
                    {avisoDescarga}
                  </p>
                ) : null}
                <div className="sr-only" role="status">
                  {descargando ? 'Generando el informe en PDF…' : ''}
                </div>
              </>
            )}

            {isLoadingFlujo ? (
              <p className="muted">Cargando…</p>
            ) : !flujo?.length ? (
              <p className="muted">No hay CDAs con operador asignado en el evento activo.</p>
            ) : (
              <div className="table-scroll">
                <table className="table-report">
                  <thead>
                    <tr>
                      {isAdmin && (
                        <th className="no-print">
                          <span className="sr-only">Seleccionar</span>
                        </th>
                      )}
                      <th>Operador</th>
                      <th>Cédula</th>
                      <th>CDA</th>
                      <th>Kit(s)</th>
                      <th>Salida DPI</th>
                      <th>Llegada Recinto</th>
                      <th>Prueba de conexión</th>
                      <th>Salida Recinto</th>
                      <th>Llegada DPI</th>
                      {isAdmin && <th className="no-print">Informe</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {flujo.map((item) => (
                      <tr key={item.cdaId}>
                        {isAdmin && (
                          <td className="no-print">
                            <input
                              type="checkbox"
                              checked={seleccionados.has(item.operadorId)}
                              onChange={() => alternarSeleccion(item.operadorId)}
                              aria-label={`Seleccionar a ${item.operadorNombre}`}
                            />
                          </td>
                        )}
                        <td>{item.operadorNombre}</td>
                        <td>{item.operadorCedula}</td>
                        <td>{item.cdaCodigo} — {item.cdaNombre}</td>
                        <td>{item.kitsCodigos.join(', ') || '—'}</td>
                        <td><HitoCelda iso={item.salidaDpiEn} /></td>
                        <td><HitoCelda iso={item.llegadaRecintoEn} /></td>
                        <td><HitoCelda iso={item.pruebaConexionEn} /></td>
                        <td><HitoCelda iso={item.salidaRecintoEn} /></td>
                        <td><HitoCelda iso={item.llegadaDpiEn} /></td>
                        {isAdmin && (
                          <td className="no-print">
                            <button
                              className="btn secondary"
                              style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
                              disabled={!responsableId || descargando !== null}
                              aria-busy={descargando === item.cdaId}
                              aria-label={`Descargar informe PDF de ${item.operadorNombre}`}
                              aria-describedby={!responsableId ? 'informe-aviso' : undefined}
                              onClick={() =>
                                descargar(
                                  item.cdaId,
                                  () => descargarInformeOperador(item.operadorId, opciones),
                                  `informe_${item.operadorCedula}.pdf`,
                                )
                              }
                            >
                              {descargando === item.cdaId ? 'Generando…' : 'PDF'}
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <>
            <h2 style={{ marginTop: 0 }}>Reporte de CDAs con sus NO-CDAs</h2>

            {!data?.length ? (
              <p className="muted">No hay CDAs con operador asignado en el evento activo.</p>
            ) : (
              <div className="table-scroll">
                <table className="table-report">
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
          </>
        )}
      </div>
    </>
  );
}
