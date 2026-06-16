import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as XLSX from 'xlsx';
import type { Canton, Paginated, Recinto, TipoRecinto } from '@cne/shared-types';
import { createRecintoSchema, updateRecintoSchema } from '@cne/shared-validation';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { SearchInput } from '../../components/SearchInput';

const TIPOS: TipoRecinto[] = ['CDA', 'NO_CDA'];
const TIPO_LABELS: Record<TipoRecinto, string> = {
  CDA: 'CDA',
  NO_CDA: 'No CDA',
};

export function RecintosPage() {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes('ADMINISTRADOR') ?? false;
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [cantonId, setCantonId] = useState('');
  const [tipo, setTipo] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Recinto | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
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
    queryKey: ['recintos', { page, search: debounced, cantonId, tipo }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (debounced) params.set('search', debounced);
      if (cantonId) params.set('cantonId', cantonId);
      if (tipo) params.set('tipo', tipo);
      const res = await api.get<Paginated<Recinto>>(`/recintos?${params}`);
      return res.data;
    },
  });

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
      window.alert(e?.response?.data?.message ?? 'No se pudo eliminar');
    } finally {
      setDeletingId(null);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '200' });
      if (cantonId) params.set('cantonId', cantonId);
      const res = await api.get<Paginated<Recinto>>(`/recintos?${params}`);
      const items = res.data.items;

      const cdas = items.filter((r) => r.tipo === 'CDA');
      const noCdas = items.filter((r) => r.tipo === 'NO_CDA');

      const rows: any[][] = [];

      rows.push(['RECINTOS ELECTORALES — CNE IMBABURA']);
      rows.push([]);

      for (const cda of cdas) {
        const jt = (cda.juntasFemeninas ?? 0) + (cda.juntasMasculinas ?? 0);
        rows.push(['Unidad Educativa CDA']);
        rows.push(['Código', 'Nombre', 'JF', 'JM', 'JT']);
        rows.push([cda.codigoRecinto, cda.nombre, cda.juntasFemeninas ?? 0, cda.juntasMasculinas ?? 0, jt]);
        rows.push([]);

        const asociadas = noCdas.filter((n) => n.cantonId === cda.cantonId);
        if (asociadas.length > 0) {
          rows.push(['Unidades Educativas NO CDA']);
          rows.push(['Cantón', 'Parroquia', 'Dirección', 'Código', 'Nombre', 'JF', 'JM', 'JT']);
          let sumNoCdaJt = 0;
          for (const nc of asociadas) {
            const ncJt = (nc.juntasFemeninas ?? 0) + (nc.juntasMasculinas ?? 0);
            sumNoCdaJt += ncJt;
            rows.push([
              nc.cantonNombre ?? '',
              nc.parroquia ?? '',
              nc.direccion ?? '',
              nc.codigoRecinto,
              nc.nombre,
              nc.juntasFemeninas ?? 0,
              nc.juntasMasculinas ?? 0,
              ncJt,
            ]);
          }
          rows.push([]);
          rows.push(['', '', '', '', '', '', 'Nro Juntas Total', jt + sumNoCdaJt]);
        } else {
          rows.push(['', '', '', '', '', '', 'Nro Juntas Total', jt]);
        }
        rows.push([]);
        rows.push(['---']);
        rows.push([]);
      }

      const ws = XLSX.utils.aoa_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Recintos');
      XLSX.writeFile(wb, 'recintos_electorales.xlsx');
    } catch (e: any) {
      window.alert('No se pudo exportar: ' + (e?.message ?? ''));
    } finally {
      setExporting(false);
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
      let msg = `Importación completa: ${creados} creados, ${actualizados} actualizados.`;
      if (errores.length > 0) msg += `\n${errores.length} error(es):\n` + errores.map((er) => `Fila ${er.fila}: ${er.error}`).join('\n');
      window.alert(msg);
      qc.invalidateQueries({ queryKey: ['recintos'] });
    } catch (err: any) {
      window.alert('Error al importar: ' + (err?.response?.data?.message ?? err?.message ?? 'desconocido'));
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  return (
    <>
      <h2>Recintos Electorales</h2>
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
          <select value={tipo} onChange={(e) => { setTipo(e.target.value); setPage(1); }}>
            <option value="">Todos los tipos</option>
            {TIPOS.map((t) => (
              <option key={t} value={t}>{TIPO_LABELS[t]}</option>
            ))}
          </select>
          <button
            className="btn secondary"
            onClick={handleExport}
            disabled={exporting}
            title="Exportar a Excel"
          >
            {exporting ? 'Exportando…' : '↓ Excel'}
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
                    const isCda = r.tipo === 'CDA';
                    const isExpanded = expandedId === r.id;
                    const colSpan = isAdmin ? 10 : 9;
                    return (
                      <Fragment key={r.id}>
                        <tr>
                          <td style={{ textAlign: 'center', padding: '0.25rem' }}>
                            {isCda && (
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
                          <td>{r.nombre}</td>
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
                        {isCda && isExpanded && (
                          <tr>
                            <td colSpan={colSpan} style={{ padding: '0 0.75rem 1rem 0.75rem', background: 'var(--color-surface-alt, #f4f6f8)' }}>
                              <FichaSubtable cda={r} onEdit={isAdmin ? setEditing : undefined} />
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

// ─── Ficha expandible por CDA ────────────────────────────────────────────────

const SECTION_CDA     = { bg: 'rgba(59,130,246,0.08)',  border: '#3b82f6', label: 'Unidad Educativa CDA' };
const SECTION_NOCDA   = { bg: 'rgba(34,197,94,0.08)',   border: '#22c55e', label: 'Unidades Educativas NO CDA' };
const SECTION_CONTING = { bg: 'rgba(245,158,11,0.08)',  border: '#f59e0b', label: 'En caso de problema con el kit, dirigirse a' };

const sectionStyle = (s: typeof SECTION_CDA): React.CSSProperties => ({
  borderLeft: `4px solid ${s.border}`,
  background: s.bg,
  borderRadius: '0 4px 4px 0',
  padding: '0.6rem 0.75rem',
  marginTop: '0.6rem',
});

function jt(r: Recinto) {
  return r.juntasFemeninas != null || r.juntasMasculinas != null
    ? (r.juntasFemeninas ?? 0) + (r.juntasMasculinas ?? 0)
    : null;
}

function FichaSubtable({ cda, onEdit }: { cda: Recinto; onEdit?: (r: Recinto) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['recintos-origenes', cda.id],
    queryFn: async () => {
      const res = await api.get<Paginated<Recinto>>(`/recintos?cdaDestinoId=${cda.id}&pageSize=100`);
      return res.data.items;
    },
  });

  const cdaJt = jt(cda);
  const noCdaTotalJt = data?.reduce((acc, nc) => acc + (jt(nc) ?? 0), 0) ?? 0;
  const totalGeneral = (cdaJt ?? 0) + noCdaTotalJt;

  const thStyle: React.CSSProperties = { fontWeight: 600, fontSize: '0.78rem', padding: '0.3rem 0.5rem', textAlign: 'left' };
  const tdStyle: React.CSSProperties = { fontSize: '0.82rem', padding: '0.25rem 0.5rem' };

  return (
    <div style={{ paddingTop: '0.25rem' }}>

      {/* — Sección CDA — */}
      <div style={sectionStyle(SECTION_CDA)}>
        <p style={{ margin: '0 0 0.4rem', fontWeight: 600, fontSize: '0.8rem', color: '#3b82f6' }}>{SECTION_CDA.label}</p>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
          <table style={{ flex: 1 }}>
            <thead><tr>
              <th style={thStyle}>Código</th>
              <th style={thStyle}>Nombre</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>JF</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>JM</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>JT</th>
            </tr></thead>
            <tbody><tr>
              <td style={tdStyle}>{cda.codigoRecinto}</td>
              <td style={tdStyle}>{cda.nombre}</td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>{cda.juntasFemeninas ?? '—'}</td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>{cda.juntasMasculinas ?? '—'}</td>
              <td style={{ ...tdStyle, textAlign: 'center' }}>{cdaJt != null ? <strong>{cdaJt}</strong> : '—'}</td>
            </tr></tbody>
          </table>
          <div style={{ textAlign: 'center', border: '2px solid #3b82f6', borderRadius: 6, padding: '0.3rem 0.9rem', minWidth: 80 }}>
            <div style={{ fontSize: '0.7rem', color: '#3b82f6', fontWeight: 600 }}>Nro Juntas Total</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color: '#3b82f6', lineHeight: 1.1 }}>{totalGeneral}</div>
          </div>
        </div>
      </div>

      {/* — Sección NO-CDAs — */}
      <div style={sectionStyle(SECTION_NOCDA)}>
        <p style={{ margin: '0 0 0.4rem', fontWeight: 600, fontSize: '0.8rem', color: '#16a34a' }}>{SECTION_NOCDA.label}</p>
        {isLoading ? (
          <p className="muted" style={{ fontSize: '0.82rem' }}>Cargando…</p>
        ) : !data || data.length === 0 ? (
          <p className="muted" style={{ fontSize: '0.82rem' }}>Sin No CDAs asignados.</p>
        ) : (
          <table style={{ width: '100%' }}>
            <thead><tr>
              <th style={thStyle}>Cantón</th>
              <th style={thStyle}>Parroquia</th>
              <th style={thStyle}>Código</th>
              <th style={thStyle}>Nombre</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>JF</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>JM</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>JT</th>
              {onEdit && <th style={{ width: 28 }}></th>}
            </tr></thead>
            <tbody>
              {data.map((nc) => {
                const ncJt = jt(nc);
                return (
                  <tr key={nc.id}>
                    <td style={tdStyle}>{nc.cantonNombre ?? '—'}</td>
                    <td style={tdStyle}>{nc.parroquia ?? '—'}</td>
                    <td style={tdStyle}>{nc.codigoRecinto}</td>
                    <td style={tdStyle}>{nc.nombre}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{nc.juntasFemeninas ?? '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{nc.juntasMasculinas ?? '—'}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{ncJt != null ? <strong>{ncJt}</strong> : '—'}</td>
                    {onEdit && (
                      <td style={{ padding: '0.15rem 0.25rem' }}>
                        <button
                          onClick={() => onEdit(nc)}
                          title="Editar juntas"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', color: '#16a34a', padding: '0.1rem 0.2rem' }}
                        >✏</button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* — Sección Contingencia — */}
      <div style={sectionStyle(SECTION_CONTING)}>
        <p style={{ margin: '0 0 0.4rem', fontWeight: 600, fontSize: '0.8rem', color: '#d97706' }}>{SECTION_CONTING.label}</p>
        <p className="muted" style={{ fontSize: '0.82rem', margin: 0 }}>Sin unidad de contingencia configurada.</p>
      </div>

    </div>
  );
}

// ─── Modal crear / editar ─────────────────────────────────────────────────────

interface FormState {
  codigoRecinto: string;
  nombre: string;
  direccion: string;
  cantonId: string;
  parroquia: string;
  zona: string;
  tipo: TipoRecinto;
  latitud: string;
  longitud: string;
  tieneInternet: boolean;
  coberturaMovil: boolean;
  numeroElectores: string;
  juntasFemeninas: string;
  juntasMasculinas: string;
}

type TextFieldKey = Exclude<keyof FormState, 'tipo' | 'tieneInternet' | 'coberturaMovil'>;

function RecintoModal({
  recinto,
  cantones,
  onClose,
  onDone,
}: {
  recinto?: Recinto;
  cantones?: Canton[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState<FormState>({
    codigoRecinto: recinto?.codigoRecinto ?? '',
    nombre: recinto?.nombre ?? '',
    direccion: recinto?.direccion ?? '',
    cantonId: recinto ? String(recinto.cantonId) : '',
    parroquia: recinto?.parroquia ?? '',
    zona: recinto?.zona ?? '',
    tipo: recinto?.tipo ?? 'CDA',
    latitud: recinto ? String(recinto.latitud) : '',
    longitud: recinto ? String(recinto.longitud) : '',
    tieneInternet: recinto?.tieneInternet ?? false,
    coberturaMovil: recinto?.coberturaMovil ?? false,
    numeroElectores: recinto?.numeroElectores != null ? String(recinto.numeroElectores) : '',
    juntasFemeninas: recinto?.juntasFemeninas != null ? String(recinto.juntasFemeninas) : '',
    juntasMasculinas: recinto?.juntasMasculinas != null ? String(recinto.juntasMasculinas) : '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function textField(k: TextFieldKey) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  function checkboxField(k: 'tieneInternet' | 'coberturaMovil') {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.checked }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      codigoRecinto: form.codigoRecinto,
      nombre: form.nombre,
      direccion: form.direccion || null,
      cantonId: form.cantonId ? Number(form.cantonId) : undefined,
      parroquia: form.parroquia || null,
      zona: form.zona || null,
      tipo: form.tipo,
      latitud: form.latitud !== '' ? Number(form.latitud) : undefined,
      longitud: form.longitud !== '' ? Number(form.longitud) : undefined,
      tieneInternet: form.tieneInternet,
      coberturaMovil: form.coberturaMovil,
      numeroElectores: form.numeroElectores !== '' ? Number(form.numeroElectores) : null,
      juntasFemeninas: form.juntasFemeninas !== '' ? Number(form.juntasFemeninas) : null,
      juntasMasculinas: form.juntasMasculinas !== '' ? Number(form.juntasMasculinas) : null,
    };
    const schema = recinto ? updateRecintoSchema : createRecintoSchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos');
      return;
    }
    setSaving(true);
    try {
      if (recinto) {
        await api.patch(`/recintos/${recinto.id}`, parsed.data);
      } else {
        await api.post('/recintos', parsed.data);
      }
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 100,
        overflowY: 'auto',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        className="login-card"
        style={{ maxWidth: 520, width: '100%', margin: '0 auto' }}
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
      >
        <h1 style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>
          {recinto ? 'Editar recinto' : 'Nuevo recinto'}
        </h1>

        <div className="field">
          <label>Código de recinto</label>
          <input
            value={form.codigoRecinto}
            onChange={textField('codigoRecinto')}
            required
            maxLength={20}
          />
        </div>

        <div className="field">
          <label>Nombre</label>
          <input value={form.nombre} onChange={textField('nombre')} required maxLength={255} />
        </div>

        <div className="field">
          <label>Dirección (opcional)</label>
          <input value={form.direccion} onChange={textField('direccion')} maxLength={255} />
        </div>

        <div className="field">
          <label>Cantón</label>
          <select value={form.cantonId} onChange={textField('cantonId')} required>
            <option value="">Selecciona…</option>
            {cantones?.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        </div>

        <div className="row" style={{ gap: '0.75rem' }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Parroquia (opcional)</label>
            <input value={form.parroquia} onChange={textField('parroquia')} maxLength={120} />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Zona (opcional)</label>
            <input value={form.zona} onChange={textField('zona')} maxLength={120} />
          </div>
        </div>

        <div className="field">
          <label>Tipo</label>
          <select
            value={form.tipo}
            onChange={(e) => setForm((f) => ({ ...f, tipo: e.target.value as TipoRecinto }))}
          >
            {TIPOS.map((t) => (
              <option key={t} value={t}>{TIPO_LABELS[t]}</option>
            ))}
          </select>
        </div>

        <div className="row" style={{ gap: '0.75rem' }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Latitud</label>
            <input
              type="number"
              step="any"
              value={form.latitud}
              onChange={textField('latitud')}
              required
              placeholder="Ej.: 0.347627"
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Longitud</label>
            <input
              type="number"
              step="any"
              value={form.longitud}
              onChange={textField('longitud')}
              required
              placeholder="Ej.: -78.125852"
            />
          </div>
        </div>

        <div className="row" style={{ gap: '0.75rem' }}>
          <div className="field" style={{ flex: 1 }}>
            <label>Juntas Femeninas (JF)</label>
            <input
              type="number"
              min={0}
              value={form.juntasFemeninas}
              onChange={textField('juntasFemeninas')}
              placeholder="0"
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Juntas Masculinas (JM)</label>
            <input
              type="number"
              min={0}
              value={form.juntasMasculinas}
              onChange={textField('juntasMasculinas')}
              placeholder="0"
            />
          </div>
        </div>

        {(form.juntasFemeninas !== '' || form.juntasMasculinas !== '') && (
          <p className="muted" style={{ marginTop: '-0.5rem', marginBottom: '0.75rem', fontSize: '0.85rem' }}>
            JT (total) = {(Number(form.juntasFemeninas) || 0) + (Number(form.juntasMasculinas) || 0)}
          </p>
        )}

        <div className="field">
          <label>Número de electores (opcional)</label>
          <input
            type="number"
            min={0}
            value={form.numeroElectores}
            onChange={textField('numeroElectores')}
          />
        </div>

        <div className="row" style={{ gap: '1.5rem', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input
              type="checkbox"
              checked={form.tieneInternet}
              onChange={checkboxField('tieneInternet')}
            />
            Tiene internet
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input
              type="checkbox"
              checked={form.coberturaMovil}
              onChange={checkboxField('coberturaMovil')}
            />
            Cobertura móvil
          </label>
        </div>

        {error && <div className="banner error">{error}</div>}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem', gap: '0.5rem' }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Guardando…' : recinto ? 'Guardar cambios' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}
