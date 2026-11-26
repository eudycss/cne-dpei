import { actuaComoAdmin } from '../../lib/roles';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Canton, Paginated, Recinto, TipoRecinto } from '@cne/shared-types';
import { sileo } from 'sileo';
import { api } from '../../lib/api';
import { descargarReporteRecintosCda, type FormatoReporteRecintos } from '../../lib/queries/recintos-reporte';
import { useAuth } from '../../auth/AuthContext';
import { SearchInput } from '../../components/SearchInput';
import { PasoFlujo } from '../../components/PasoFlujo';
import { RecintoModal } from './RecintoModal';
import { FichaSubtable } from './FichaSubtable';
import { TIPOS, TIPO_LABELS } from './tipos-recinto';

export function RecintosPage() {
  const { user } = useAuth();
  const isAdmin = actuaComoAdmin(user?.roles);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [cantonId, setCantonId] = useState('');
  const [conOrigenes, setConOrigenes] = useState('');
  // NO-CDAs que no entregan en ningún CDA: no salen anidados bajo ninguno, así
  // que solo se ven con este filtro (p. ej. un CDA que se cambió a NO-CDA).
  const [soloSueltos, setSoloSueltos] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Recinto | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<FormatoReporteRecintos | null>(null);
  const [importing, setImporting] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: cantones } = useQuery({
    queryKey: ['cantones'],
    queryFn: async () => {
      const res = await api.get<Canton[]>('/cantones');
      return res.data;
    },
    staleTime: Infinity,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['recintos', { page, search: debounced, cantonId, conOrigenes, soloSueltos }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (soloSueltos) params.set('sinCda', 'true');
      else params.set('tipo', 'CDA');
      if (debounced) params.set('search', debounced);
      if (cantonId) params.set('cantonId', cantonId);
      if (conOrigenes && !soloSueltos) params.set('conOrigenes', conOrigenes);
      const res = await api.get<Paginated<Recinto>>(`/recintos?${params}`);
      return res.data;
    },
  });

  // Si lo buscado es un NO-CDA, se abre la ficha del CDA al que entrega (una
  // vez por búsqueda: si se cierra a mano, un refetch no la vuelve a abrir).
  const busquedaAbierta = useRef('');
  useEffect(() => {
    if (!debounced || busquedaAbierta.current === debounced) return;
    const conCoincidencia = data?.items.find((r) => r.noCdasCoincidentes?.length);
    if (conCoincidencia) {
      setExpandedId(conCoincidencia.id);
      busquedaAbierta.current = debounced;
    }
  }, [data, debounced]);

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / data.pageSize));
  }, [data]);

  async function handleDelete(id: string, nombre: string) {
    if (!window.confirm(`¿Seguro que deseas eliminar el recinto "${nombre}"?`)) return;
    setDeletingId(id);
    try {
      await api.delete(`/recintos/${id}`);
      qc.invalidateQueries({ queryKey: ['recintos'] });
    } catch (e: any) {
      sileo.error({ title: e?.response?.data?.message ?? 'No se pudo eliminar' });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleExport(formato: FormatoReporteRecintos) {
    setExporting(formato);
    try {
      await descargarReporteRecintosCda(formato, cantonId || undefined);
    } catch (e: any) {
      sileo.error({ title: 'No se pudo exportar: ' + (e?.message ?? '') });
    } finally {
      setExporting(null);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post<{ creados: number; actualizados: number; errores: { fila: number; error: string }[] }>('/recintos/bulk', fd);
      const { creados, actualizados, errores } = res.data;
      sileo[errores.length > 0 ? 'warning' : 'success']({
        title: `Importación completa: ${creados} creados, ${actualizados} actualizados.`,
        description: errores.length > 0
          ? `${errores.length} error(es): ` + errores.map((er) => `Fila ${er.fila}: ${er.error}`).join(', ')
          : undefined,
      });
      qc.invalidateQueries({ queryKey: ['recintos'] });
    } catch (err: any) {
      sileo.error({ title: 'Error al importar: ' + (err?.response?.data?.message ?? err?.message ?? 'desconocido') });
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  return (
    <>
      <PasoFlujo paso="recintos" />
      <div className="card">
        <div className="row" style={{ flexWrap: 'wrap', gap: '0.5rem' }}>
          <SearchInput
            placeholder="Buscar por nombre, código o parroquia"
            value={search}
            onChange={(v) => { setSearch(v); setPage(1); }}
            style={{ flex: 1, minWidth: 200 }}
          />
          <select value={cantonId} onChange={(e) => { setCantonId(e.target.value); setPage(1); }}>
            <option value="">Todos los cantones</option>
            {cantones?.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
          <select
            aria-label="Mostrar"
            value={soloSueltos ? 'sueltos' : 'cda'}
            onChange={(e) => { setSoloSueltos(e.target.value === 'sueltos'); setPage(1); }}
          >
            <option value="cda">CDA</option>
            <option value="sueltos">NO-CDA sin CDA asignado</option>
          </select>
          {!soloSueltos && (
            <select value={conOrigenes} onChange={(e) => { setConOrigenes(e.target.value); setPage(1); }}>
              <option value="">Total</option>
              <option value="true">CDA con NO-CDAs</option>
              <option value="false">CDA sin NO-CDAs</option>
            </select>
          )}
          <button
            className="btn secondary"
            onClick={() => handleExport('xlsx')}
            disabled={exporting !== null}
            aria-label="Descargar Excel"
            aria-busy={exporting === 'xlsx'}
            title="Exportar cada CDA con sus recintos NO CDA a Excel"
          >
            {exporting === 'xlsx' ? 'Exportando…' : '↓ Excel'}
          </button>
          <button
            className="btn secondary"
            onClick={() => handleExport('pdf')}
            disabled={exporting !== null}
            aria-label="Descargar PDF"
            aria-busy={exporting === 'pdf'}
            title="Exportar cada CDA con sus recintos NO CDA a PDF"
          >
            {exporting === 'pdf' ? 'Exportando…' : '↓ PDF'}
          </button>
          {isAdmin && (
            <label className="btn secondary" title="Importar desde Excel/CSV" style={{ cursor: 'pointer' }}>
              {importing ? 'Importando…' : '↑ Importar'}
              <input ref={importInputRef} type="file" accept=".xlsx,.csv" hidden onChange={handleImport} disabled={importing} />
            </label>
          )}
          {isAdmin && (
            <button className="btn" onClick={() => setShowCreate(true)}>+ Nuevo</button>
          )}
        </div>

        {soloSueltos && (
          <p className="muted" style={{ marginBottom: 0 }}>
            NO-CDAs que no entregan en ningún CDA: no aparecen en la lista normal ni en Monitoreo y Reportes.
            Si alguno era un CDA, edítalo y cámbialo de nuevo a tipo CDA.
          </p>
        )}

        {isLoading ? (
          <p className="muted">Cargando…</p>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ minWidth: 900 }}>
                <thead>
                  <tr>
                    <th style={{ width: 32 }}></th>
                    <th>Código</th>
                    <th>Nombre</th>
                    <th>Cantón</th>
                    <th>Parroquia / Zona</th>
                    <th>Tipo</th>
                    <th>JF</th>
                    <th>JM</th>
                    <th>JT</th>
                    {isAdmin && <th style={{ width: 180 }}>Acciones</th>}
                  </tr>
                </thead>
                <tbody>
                  {data?.items.map((r) => {
                    const jt =
                      r.juntasFemeninas != null || r.juntasMasculinas != null
                        ? (r.juntasFemeninas ?? 0) + (r.juntasMasculinas ?? 0)
                        : null;
                    // La ficha se abre si hay NO-CDAs o una unidad de contingencia que mostrar.
                    const isExpandable = r.tipo === 'CDA' && ((r.noCdasCount ?? 0) > 0 || !!r.contingenciaNombre);
                    const isExpanded = expandedId === r.id;
                    const colSpan = isAdmin ? 10 : 9;
                    return (
                      <Fragment key={r.id}>
                        <tr>
                          <td style={{ textAlign: 'center', padding: '0.25rem' }}>
                            {isExpandable && (
                              <button
                                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--color-muted)' }}
                                onClick={() => setExpandedId(isExpanded ? null : r.id)}
                                title={isExpanded ? 'Cerrar' : 'Ver No CDAs asociados'}
                              >
                                {isExpanded ? '▼' : '▶'}
                              </button>
                            )}
                          </td>
                          <td>{r.codigoRecinto}</td>
                          <td>
                            {r.nombre}
                            {r.noCdasCoincidentes && r.noCdasCoincidentes.length > 0 && (
                              <div className="muted" style={{ fontSize: '0.78rem' }}>
                                Coincide con el NO CDA{' '}
                                {r.noCdasCoincidentes.map((nc) => `${nc.codigoRecinto} · ${nc.nombre}`).join(', ')}
                              </div>
                            )}
                          </td>
                          <td>{r.cantonNombre ?? '—'}</td>
                          <td>
                            {r.parroquia ?? '—'}
                            {r.zona && r.zona !== r.parroquia && (
                              <span className="muted"> · {r.zona}</span>
                            )}
                          </td>
                          <td>{TIPO_LABELS[r.tipo]}</td>
                          <td>{r.juntasFemeninas ?? '—'}</td>
                          <td>{r.juntasMasculinas ?? '—'}</td>
                          <td>
                            {jt != null ? (
                              <strong>{jt}</strong>
                            ) : '—'}
                          </td>
                          {isAdmin && (
                            <td>
                              <div className="row" style={{ margin: 0, gap: '0.35rem' }}>
                                <button
                                  className="btn secondary"
                                  style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                                  onClick={() => setEditing(r)}
                                >
                                  Editar
                                </button>
                                <button
                                  className="btn danger"
                                  style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                                  disabled={deletingId === r.id}
                                  onClick={() => handleDelete(r.id, r.nombre)}
                                >
                                  Eliminar
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                        {isExpandable && isExpanded && (
                          <tr>
                            <td colSpan={colSpan} style={{ padding: '0 0.75rem 1rem 0.75rem', background: 'var(--bg)' }}>
                              <FichaSubtable
                                cda={r}
                                onEdit={isAdmin ? setEditing : undefined}
                                resaltarIds={r.noCdasCoincidentes?.map((nc) => nc.id)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {data?.items.length === 0 && (
                    <tr>
                      <td
                        colSpan={isAdmin ? 10 : 9}
                        className="muted"
                        style={{ textAlign: 'center', padding: '1.5rem' }}
                      >
                        No hay recintos registrados
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="row" style={{ marginTop: '1rem', justifyContent: 'space-between' }}>
              <span className="muted">
                {data
                  ? `${data.total} recinto(s) · página ${page} de ${totalPages}`
                  : ''}
              </span>
              <div className="row">
                <button
                  className="btn secondary"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  ← Anterior
                </button>
                <button
                  className="btn secondary"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Siguiente →
                </button>
              </div>
            </div>
          </>
        )}
      </div>


      {showCreate && (
        <RecintoModal
          cantones={cantones}
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['recintos'] });
          }}
        />
      )}

      {editing && (
        <RecintoModal
          recinto={editing}
          cantones={cantones}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['recintos'] });
            qc.invalidateQueries({ queryKey: ['recintos-origenes'] });
          }}
        />
      )}
    </>
  );
}
