import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import { sileo } from 'sileo';
import type { FilaInformeCustodia } from '@cne/shared-types';
import { Logo } from '../../components/Logo';
import { Cargando } from '../../components/Cargando';
import {
  descargarActaKit,
  descargarActas,
  getInformeCustodia,
  guardarArchivo,
} from '../../lib/queries/custodia';

type FiltroEtapa = 'TODOS' | 'PENDIENTES' | 'COMPLETOS';

function fechaHora(iso: string, conAnio = false): string {
  return new Date(iso).toLocaleString('es-EC', {
    day: '2-digit',
    month: '2-digit',
    year: conAnio ? 'numeric' : undefined,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Texto de un Blob (FileReader como respaldo de navegadores sin Blob.text). */
function textoDeBlob(b: Blob): Promise<string> {
  if (typeof b.text === 'function') return b.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(b);
  });
}

function completo(f: FilaInformeCustodia): boolean {
  return !!f.entrega && !!f.recepcion && !!f.devolucion;
}

/** Estado de una etapa en una celda: hecho (con hora y detalle) o pendiente. */
function Etapa({ iso, detalle, aviso }: { iso: string | null; detalle?: string; aviso?: string }) {
  if (!iso) return <span style={{ color: 'var(--error)' }}>✗ Pendiente</span>;
  return (
    <span>
      <span style={{ color: 'var(--success-text)' }}>✓ {fechaHora(iso)}</span>
      {detalle ? <div className="muted" style={{ fontSize: '0.8rem' }}>{detalle}</div> : null}
      {aviso ? <div style={{ fontSize: '0.8rem', color: 'var(--warn-text)' }}>{aviso}</div> : null}
    </span>
  );
}

/**
 * Cadena de custodia de los kits del evento activo: quién entregó cada kit
 * al militar, cuándo lo recibió el operador CDA y cuándo volvió al DPEI.
 * Exporta a Excel, imprime la tabla y descarga las actas en PDF.
 */
export function CadenaCustodiaPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['informe-custodia'],
    queryFn: async () => (await getInformeCustodia()).data,
  });
  const [cantonId, setCantonId] = useState('');
  const [recintoId, setRecintoId] = useState('');
  const [etapa, setEtapa] = useState<FiltroEtapa>('TODOS');
  const [descargando, setDescargando] = useState<string | null>(null);

  const filas = data ?? [];
  const cantones = useMemo(() => {
    const m = new Map<number, string>();
    for (const f of filas) if (f.cantonId != null && f.cantonNombre) m.set(f.cantonId, f.cantonNombre);
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [filas]);
  const recintos = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of filas) {
      if (f.recintoId && (!cantonId || String(f.cantonId) === cantonId)) {
        m.set(f.recintoId, `${f.recintoCodigo} — ${f.recintoNombre}`);
      }
    }
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [filas, cantonId]);

  const visibles = filas.filter(
    (f) =>
      (!cantonId || String(f.cantonId) === cantonId) &&
      (!recintoId || f.recintoId === recintoId) &&
      (etapa === 'TODOS' || (etapa === 'COMPLETOS' ? completo(f) : !completo(f))),
  );
  const totales = {
    kits: visibles.length,
    entregados: visibles.filter((f) => f.entrega).length,
    recibidos: visibles.filter((f) => f.recepcion).length,
    devueltos: visibles.filter((f) => f.devolucion).length,
  };

  async function descargar(clave: string, accion: () => Promise<{ data: Blob }>, archivo: string) {
    setDescargando(clave);
    try {
      guardarArchivo((await accion()).data, archivo);
    } catch (e: any) {
      // Con blob, el mensaje del servidor (p. ej. "filtra por cantón") viene como Blob.
      let mensaje = 'No se pudo descargar el acta';
      try {
        const cuerpo = e?.response?.data;
        if (cuerpo instanceof Blob) mensaje = JSON.parse(await textoDeBlob(cuerpo))?.message ?? mensaje;
      } catch {
        /* se queda el mensaje genérico */
      }
      sileo.error({ title: mensaje });
    } finally {
      setDescargando(null);
    }
  }

  function exportarExcel() {
    const rows: (string | number)[][] = [
      ['Cadena de custodia de kits CDA — CNE Imbabura'],
      [],
      [
        'Kit',
        'Recinto',
        'Cantón',
        'Operador CDA',
        'Cédula operador',
        'Entregado al militar',
        'Militar',
        'Cédula militar',
        'Registró',
        'Recibido por el CDA',
        'Foto del militar',
        'Devuelto al DPEI',
        'Verificó',
        'Contenido completo',
        'Observaciones',
        'Correcciones',
      ],
    ];
    for (const f of visibles) {
      rows.push([
        f.codigoUnico,
        f.recintoCodigo ? `${f.recintoCodigo} — ${f.recintoNombre}` : '—',
        f.cantonNombre ?? '—',
        f.operadorNombre ?? '—',
        f.operadorCedula ?? '—',
        f.entrega ? fechaHora(f.entrega.entregadoEn, true) : 'Pendiente',
        f.entrega ? f.entrega.militarNombre + (f.entrega.militarDeOtroRecinto ? ' (otro recinto)' : '') : '—',
        f.entrega?.militarCedula ?? '—',
        f.entrega?.entregadoPorNombre ?? '—',
        f.recepcion ? fechaHora(f.recepcion.confirmadoEn, true) : 'Pendiente',
        f.recepcion ? (f.recepcion.tieneFoto ? 'Sí' : 'No') : '—',
        f.devolucion ? fechaHora(f.devolucion.confirmadoEn, true) : 'Pendiente',
        f.devolucion?.verificadoPorNombre ?? '—',
        f.devolucion ? (f.devolucion.completo ? 'Sí' : 'No') : '—',
        f.devolucion?.observaciones ?? '',
        f.correcciones,
      ]);
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Cadena de custodia');
    XLSX.writeFile(wb, 'cadena_custodia_kits.xlsx');
  }

  return (
    <>
      <style>{`
        @media print {
          .sidebar, .topbar, .no-print { display: none !important; }
          .table-scroll { overflow: visible !important; }
          .table-report { min-width: 0 !important; width: 100% !important; font-size: 0.72rem; }
        }
        @page { size: landscape; margin: 12mm; }
      `}</style>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div className="row" style={{ alignItems: 'center', gap: '1rem' }}>
            <Logo height={56} />
            <div>
              <h2 style={{ margin: 0 }}>Cadena de custodia de kits</h2>
              <div className="muted">Entrega al militar · recepción del CDA · devolución al DPEI</div>
            </div>
          </div>
          <div className="row no-print" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="btn secondary" onClick={() => window.print()} disabled={!visibles.length}>
              Imprimir tabla
            </button>
            <button className="btn secondary" onClick={exportarExcel} disabled={!visibles.length}>
              <span aria-hidden="true">↓ </span>Excel
            </button>
            <button
              className="btn"
              disabled={!visibles.length || descargando !== null}
              aria-busy={descargando === 'todas'}
              onClick={() =>
                descargar(
                  'todas',
                  () =>
                    descargarActas({
                      cantonId: cantonId ? Number(cantonId) : undefined,
                      recintoId: recintoId || undefined,
                    }),
                  'actas_custodia.pdf',
                )
              }
            >
              {descargando === 'todas' ? 'Generando…' : (
                <>
                  <span aria-hidden="true">↓ </span>Actas PDF
                </>
              )}
            </button>
          </div>
        </div>

        <div className="row no-print" style={{ gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <label className="row" style={{ gap: '0.35rem', alignItems: 'center' }}>
            Cantón
            <select
              value={cantonId}
              onChange={(e) => {
                setCantonId(e.target.value);
                setRecintoId('');
              }}
            >
              <option value="">Todos</option>
              {cantones.map(([id, n]) => (
                <option key={id} value={id}>{n}</option>
              ))}
            </select>
          </label>
          <label className="row" style={{ gap: '0.35rem', alignItems: 'center' }}>
            Recinto
            <select value={recintoId} onChange={(e) => setRecintoId(e.target.value)}>
              <option value="">Todos</option>
              {recintos.map(([id, n]) => (
                <option key={id} value={id}>{n}</option>
              ))}
            </select>
          </label>
          <label className="row" style={{ gap: '0.35rem', alignItems: 'center' }}>
            Estado
            <select value={etapa} onChange={(e) => setEtapa(e.target.value as FiltroEtapa)}>
              <option value="TODOS">Todos</option>
              <option value="PENDIENTES">Con etapas pendientes</option>
              <option value="COMPLETOS">Cadena completa</option>
            </select>
          </label>
        </div>

        <div className="sr-only" role="status">
          {descargando ? 'Generando el acta en PDF…' : ''}
        </div>
        <div className="row" style={{ gap: '1.5rem', marginTop: '0.75rem', flexWrap: 'wrap' }} aria-live="polite">
          <span><strong>Kits:</strong> {totales.kits}</span>
          <span><strong>Entregados al militar:</strong> {totales.entregados}</span>
          <span><strong>Recibidos por el CDA:</strong> {totales.recibidos}</span>
          <span><strong>Devueltos al DPEI:</strong> {totales.devueltos}</span>
        </div>
      </div>

      {isLoading ? (
        <Cargando texto="Cargando cadena de custodia…" />
      ) : isError ? (
        <div className="banner error" role="alert">
          {(error as any)?.response?.status === 404
            ? 'No hay un evento electoral activo.'
            : 'No se pudo cargar el informe. Revisa la conexión e intenta de nuevo.'}
        </div>
      ) : (
        <div className="card table-scroll">
          <table className="table-report" style={{ width: '100%' }}>
            <caption className="sr-only">Cadena de custodia de los kits del evento activo</caption>
            <thead>
              <tr>
                <th scope="col">Kit</th>
                <th scope="col">Recinto / operador CDA</th>
                <th scope="col">1. Entrega al militar</th>
                <th scope="col">2. Recepción del CDA</th>
                <th scope="col">3. Devolución al DPEI</th>
                <th scope="col" className="no-print">Acta</th>
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">No hay kits para los filtros elegidos.</td>
                </tr>
              ) : (
                visibles.map((f) => (
                  <tr key={f.kitId}>
                    <th scope="row" style={{ fontFamily: 'monospace' }}>
                      {f.codigoUnico}
                      {f.correcciones > 0 ? (
                        <div className="muted" style={{ fontSize: '0.75rem', fontFamily: 'inherit' }}>
                          {f.correcciones} corrección{f.correcciones === 1 ? '' : 'es'}
                        </div>
                      ) : null}
                    </th>
                    <td>
                      {f.recintoCodigo ? `${f.recintoCodigo} — ${f.recintoNombre}` : '—'}
                      <div className="muted" style={{ fontSize: '0.8rem' }}>{f.operadorNombre ?? 'Sin operador'}</div>
                    </td>
                    <td>
                      <Etapa
                        iso={f.entrega?.entregadoEn ?? null}
                        detalle={f.entrega ? `${f.entrega.militarNombre} · registró ${f.entrega.entregadoPorNombre}` : undefined}
                        aviso={f.entrega?.militarDeOtroRecinto ? 'Militar de otro recinto' : undefined}
                      />
                    </td>
                    <td>
                      <Etapa
                        iso={f.recepcion?.confirmadoEn ?? null}
                        detalle={f.recepcion && !f.recepcion.tieneFoto ? 'Sin foto del militar' : undefined}
                      />
                    </td>
                    <td>
                      <Etapa
                        iso={f.devolucion?.confirmadoEn ?? null}
                        detalle={f.devolucion ? `verificó ${f.devolucion.verificadoPorNombre}` : undefined}
                        aviso={f.devolucion && !f.devolucion.completo ? 'Contenido incompleto' : undefined}
                      />
                    </td>
                    <td className="no-print">
                      <button
                        className="btn secondary"
                        style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
                        disabled={descargando !== null}
                        aria-busy={descargando === f.kitId}
                        aria-label={`Descargar acta del kit ${f.codigoUnico}`}
                        onClick={() => descargar(f.kitId, () => descargarActaKit(f.kitId), `acta_${f.codigoUnico}.pdf`)}
                      >
                        {descargando === f.kitId ? 'Generando…' : 'PDF'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
