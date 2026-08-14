import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EventoElectoral, Kit, Paginated, Recinto, User } from '@cne/shared-types';
import { asignarKitSchema, createKitSchema } from '@cne/shared-validation';
import { sileo } from 'sileo';
import { api } from '../../lib/api';
import { SearchInput } from '../../components/SearchInput';
import { SearchableSelect } from '../../components/SearchableSelect';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ESTADO_LABELS: Record<string, string> = {
  EN_BODEGA: 'En bodega',
  ASIGNADO: 'Asignado',
  ENTREGADO: 'Entregado',
  EN_RECINTO: 'En recinto',
  EN_RETORNO: 'En retorno',
  RETORNADO: 'Retornado',
};

const ESTADO_COLORS: Record<string, React.CSSProperties> = {
  EN_BODEGA: { background: '#f3f4f6', color: '#6b7280' },
  ASIGNADO: { background: '#e0e7ff', color: '#3730a3' },
  ENTREGADO: { background: '#d1fae5', color: '#065f46' },
  EN_RECINTO: { background: '#fef3c7', color: '#92400e' },
  EN_RETORNO: { background: '#fce7f3', color: '#9d174d' },
  RETORNADO: { background: '#f0fdf4', color: '#15803d' },
};

function EstadoBadge({ estado }: { estado: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '0.15rem 0.55rem',
        borderRadius: 999,
        fontSize: '0.75rem',
        fontWeight: 600,
        ...(ESTADO_COLORS[estado] ?? {}),
      }}
    >
      {ESTADO_LABELS[estado] ?? estado}
    </span>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export function KitsPage() {
  const [eventoId, setEventoId] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [assigning, setAssigning] = useState<Kit | null>(null);
  const [incluirPrueba, setIncluirPrueba] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => { setPage(1); setSelected(new Set()); }, [debounced, eventoId, incluirPrueba]);

  // Eventos
  const { data: eventos } = useQuery({
    queryKey: ['eventos'],
    queryFn: async () => (await api.get<EventoElectoral[]>('/eventos')).data,
  });

  // Pre-seleccionar ACTIVO
  if (!eventoId && eventos) {
    const activo = eventos.find((e) => e.estado === 'ACTIVO');
    if (activo) setEventoId(activo.id);
    else if (eventos.length > 0) setEventoId(eventos[0].id);
  }

  // Kits paginados
  const { data: kitsData, isLoading } = useQuery({
    queryKey: ['kits', { eventoId, page, search: debounced, incluirPrueba }],
    queryFn: async () => {
      const params = new URLSearchParams({ eventoId, page: String(page), pageSize: '20' });
      if (debounced) params.set('search', debounced);
      if (incluirPrueba) params.set('incluirPrueba', 'true');
      return (await api.get<Paginated<Kit>>(`/kits?${params}`)).data;
    },
    enabled: !!eventoId,
  });

  // Operadores y recintos (para mostrar nombres y para el modal de asignación)
  const { data: operadores } = useQuery({
    queryKey: ['users', { role: 'OPERADOR_CDA' }],
    queryFn: async () =>
      (await api.get<Paginated<User>>('/users?role=OPERADOR_CDA&pageSize=100')).data.items,
  });
  const { data: recintos } = useQuery({
    queryKey: ['recintos', { tipo: 'CDA' }],
    queryFn: async () =>
      (await api.get<Paginated<Recinto>>('/recintos?tipo=CDA&pageSize=200')).data.items,
  });
  const operadoresById = useMemo(
    () => new Map((operadores ?? []).map((u) => [u.id, `${u.nombres} ${u.apellidos}`])),
    [operadores],
  );
  const recintosById = useMemo(
    () => new Map((recintos ?? []).map((r) => [r.id, r.nombre])),
    [recintos],
  );

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((kitsData?.total ?? 0) / (kitsData?.pageSize ?? 20))),
    [kitsData],
  );

  function toggleSelect(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleAll() {
    const ids = kitsData?.items.map((k) => k.id) ?? [];
    if (ids.every((id) => selected.has(id))) {
      setSelected((s) => { const n = new Set(s); ids.forEach((id) => n.delete(id)); return n; });
    } else {
      setSelected((s) => { const n = new Set(s); ids.forEach((id) => n.add(id)); return n; });
    }
  }

  async function downloadPdf() {
    if (selected.size === 0) return;
    setDownloading(true);
    try {
      const res = await api.post('/kits/pdf-qr', { kitIds: [...selected] }, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'kits-qr.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      sileo.error({ title: e?.response?.data?.message ?? 'Error al generar el PDF' });
    } finally {
      setDownloading(false);
    }
  }

  async function downloadTemplate() {
    try {
      const res = await api.get('/kits/template.xlsx', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'plantilla_kits.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      sileo.error({ title: e?.response?.data?.message ?? 'No se pudo descargar la plantilla' });
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !eventoId) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post<{ creados: number; errores: { fila: number; error: string }[] }>(
        `/kits/bulk?eventoId=${eventoId}`,
        fd,
      );
      const { creados, errores } = res.data;
      sileo[errores.length > 0 ? 'warning' : 'success']({
        title: `Importación completa: ${creados} kit(s) creado(s).`,
        description:
          errores.length > 0
            ? `${errores.length} error(es): ` + errores.map((er) => `Fila ${er.fila}: ${er.error}`).join(', ')
            : undefined,
      });
      qc.invalidateQueries({ queryKey: ['kits'] });
    } catch (err: any) {
      sileo.error({ title: 'Error al importar: ' + (err?.response?.data?.message ?? err?.message ?? 'desconocido') });
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  const eventoSeleccionado = eventos?.find((e) => e.id === eventoId);
  const pageIds = kitsData?.items.map((k) => k.id) ?? [];
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));

  return (
    <>
      <h2>Kits Electorales</h2>

      {/* Selector de evento */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="row" style={{ alignItems: 'center', margin: 0 }}>
          <label style={{ fontWeight: 600, minWidth: 130 }}>Evento electoral</label>
          <select
            value={eventoId}
            onChange={(e) => setEventoId(e.target.value)}
            style={{
              flex: 1,
              maxWidth: 480,
              padding: '0.5rem 0.65rem',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              fontSize: '0.9rem',
            }}
          >
            <option value="">— Selecciona un evento —</option>
            {eventos?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre} (
                {e.estado === 'ACTIVO' ? '✓ Activo' : e.estado === 'BORRADOR' ? 'Borrador' : 'Cerrado'}
                )
              </option>
            ))}
          </select>
        </div>
      </div>

      {eventoId && (
        <div className="card">
          {eventoSeleccionado && (
            <p className="muted" style={{ marginTop: 0 }}>
              Evento: <strong>{eventoSeleccionado.nombre}</strong> · Fecha:{' '}
              {eventoSeleccionado.fechaJornada}
            </p>
          )}

          {/* Toolbar */}
          <div className="row" style={{ marginBottom: '0.75rem' }}>
            <SearchInput
              placeholder="Buscar por nombre o código…"
              value={search}
              onChange={(v) => setSearch(v)}
              style={{ flex: 1 }}
            />
            <label className="row" style={{ margin: 0, gap: '0.35rem', fontSize: '0.85rem', alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={incluirPrueba}
                onChange={(e) => setIncluirPrueba(e.target.checked)}
              />
              Mostrar kits de prueba
            </label>
            <button className="btn" onClick={() => setShowCreate(true)}>
              + Nuevo kit
            </button>
            <button className="btn secondary" onClick={downloadTemplate} title="Descargar plantilla Excel">
              ↓ Plantilla
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              style={{ display: 'none' }}
              onChange={handleImport}
            />
            <button
              className="btn secondary"
              disabled={importing}
              onClick={() => importInputRef.current?.click()}
              title="Carga masiva de kits (Excel/CSV)"
            >
              {importing ? 'Importando…' : '↑ Importar'}
            </button>
            <button
              className="btn secondary"
              disabled={selected.size === 0 || downloading}
              onClick={downloadPdf}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
            >
              {/* Icono PDF/QR */}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 9h.01M15 9h.01M9 15h.01M15 15h.01M12 12h.01" strokeWidth="2.5" />
              </svg>
              {downloading ? 'Generando…' : `PDF QR${selected.size > 0 ? ` (${selected.size})` : ''}`}
            </button>
          </div>

          {isLoading ? (
            <p className="muted">Cargando…</p>
          ) : (
            <>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input
                        type="checkbox"
                        checked={allPageSelected}
                        onChange={toggleAll}
                        title="Seleccionar todos en esta página"
                      />
                    </th>
                    <th>Código</th>
                    <th>Nombre</th>
                    <th>Contenidos</th>
                    <th>Operador</th>
                    <th>Recinto</th>
                    <th>Estado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {kitsData?.items.map((kit) => (
                    <tr key={kit.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(kit.id)}
                          onChange={() => toggleSelect(kit.id)}
                        />
                      </td>
                      <td>
                        <code style={{ fontFamily: 'monospace', fontSize: '0.9rem', letterSpacing: '0.05em' }}>
                          {kit.codigoUnico}
                        </code>
                      </td>
                      <td>
                        {kit.nombre}
                        {kit.esPrueba && (
                          <span
                            style={{
                              marginLeft: '0.4rem',
                              display: 'inline-block',
                              padding: '0.1rem 0.4rem',
                              borderRadius: 999,
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              background: '#fee2e2',
                              color: '#991b1b',
                            }}
                          >
                            Prueba
                          </span>
                        )}
                      </td>
                      <td className="muted" style={{ fontSize: '0.82rem' }}>
                        {kit.contenidos ?? '—'}
                      </td>
                      <td className={kit.operadorId ? '' : 'muted'}>
                        {kit.operadorId ? operadoresById.get(kit.operadorId) ?? kit.operadorId : '—'}
                      </td>
                      <td className={kit.recintoId ? '' : 'muted'}>
                        {kit.recintoId ? recintosById.get(kit.recintoId) ?? kit.recintoId : '—'}
                      </td>
                      <td>
                        <EstadoBadge estado={kit.estado} />
                      </td>
                      <td>
                        {kit.operadorId || kit.recintoId ? (
                          <button
                            className="btn secondary"
                            style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
                            onClick={async () => {
                              if (!window.confirm('¿Quitar la asignación de este kit?')) return;
                              try {
                                await api.patch(`/kits/${kit.id}/desasignar`, {});
                                qc.invalidateQueries({ queryKey: ['kits'] });
                              } catch (err: any) {
                                const data = err?.response?.data;
                                if (!data?.frozen) {
                                  sileo.error({ title: data?.message ?? 'No se pudo quitar la asignación' });
                                  return;
                                }
                                const justificacion = window.prompt(
                                  `${data.message}\n\nIngresa una justificación para continuar:`,
                                );
                                if (!justificacion?.trim()) return;
                                try {
                                  await api.patch(`/kits/${kit.id}/desasignar`, { justificacion });
                                  qc.invalidateQueries({ queryKey: ['kits'] });
                                } catch (err2: any) {
                                  sileo.error({
                                    title: err2?.response?.data?.message ?? 'No se pudo quitar la asignación',
                                  });
                                }
                              }
                            }}
                          >
                            Quitar
                          </button>
                        ) : (
                          <button
                            className="btn secondary"
                            style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
                            onClick={() => setAssigning(kit)}
                          >
                            Asignar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {kitsData?.items.length === 0 && (
                    <tr>
                      <td colSpan={8} className="muted" style={{ textAlign: 'center', padding: '1.5rem' }}>
                        {debounced ? 'No hay kits que coincidan con la búsqueda.' : 'No hay kits creados para este evento.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* Paginación */}
              <div className="row" style={{ marginTop: '1rem', justifyContent: 'space-between' }}>
                <span className="muted">
                  {kitsData
                    ? `${kitsData.total} kit(s) · página ${page} de ${totalPages}${selected.size > 0 ? ` · ${selected.size} seleccionado(s)` : ''}`
                    : ''}
                </span>
                <div className="row">
                  <button className="btn secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    ← Anterior
                  </button>
                  <button className="btn secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                    Siguiente →
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {showCreate && eventoId && (
        <CreateKitModal
          eventoId={eventoId}
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['kits'] });
          }}
        />
      )}

      {assigning && (
        <AsignarKitModal
          kit={assigning}
          operadores={operadores ?? []}
          recintos={recintos ?? []}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            qc.invalidateQueries({ queryKey: ['kits'] });
          }}
        />
      )}
    </>
  );
}

// ─── Modal crear kit ──────────────────────────────────────────────────────────

function CreateKitModal({
  eventoId,
  onClose,
  onDone,
}: {
  eventoId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({ nombre: '', contenidos: '' });
  const [esPrueba, setEsPrueba] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function field(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = createKitSchema.safeParse({
      eventoId,
      nombre: form.nombre,
      contenidos: form.contenidos || null,
      esPrueba,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos');
      return;
    }
    setSaving(true);
    try {
      await api.post('/kits', parsed.data);
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'No se pudo crear el kit');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="center" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10 }}>
      <form className="login-card" style={{ maxWidth: 480, width: '100%' }} onSubmit={onSubmit}>
        <h1>Nuevo kit electoral</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          El sistema generará automáticamente el código único y el QR.
        </p>

        <div className="field">
          <label>Nombre del kit</label>
          <input
            value={form.nombre}
            onChange={field('nombre')}
            required
            maxLength={160}
            placeholder="Ej.: Kit Electoral Ibarra Norte 01"
          />
        </div>

        <div className="field">
          <label>Contenidos (opcional)</label>
          <textarea
            value={form.contenidos}
            onChange={field('contenidos')}
            rows={3}
            maxLength={1000}
            placeholder="Lista de materiales incluidos…"
            style={{
              width: '100%',
              padding: '0.5rem 0.65rem',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              fontSize: '0.9rem',
              resize: 'vertical',
            }}
          />
        </div>

        <label className="row" style={{ margin: '0.5rem 0 0', gap: '0.35rem', alignItems: 'center' }}>
          <input type="checkbox" checked={esPrueba} onChange={(e) => setEsPrueba(e.target.checked)} />
          Es un kit de prueba (no aparecerá en el listado por defecto)
        </label>

        {error && <div className="banner error">{error}</div>}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Creando…' : 'Crear kit'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Modal asignar kit ────────────────────────────────────────────────────────

function AsignarKitModal({
  kit,
  operadores,
  recintos,
  onClose,
  onDone,
}: {
  kit: Kit;
  operadores: User[];
  recintos: Recinto[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [operadorId, setOperadorId] = useState(kit.operadorId ?? '');
  const [recintoId, setRecintoId] = useState(kit.recintoId ?? '');
  const [justificacion, setJustificacion] = useState('');
  const [frozen, setFrozen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const operadorOptions = useMemo(
    () =>
      operadores.map((u) => ({
        value: u.id,
        label: `${u.nombres} ${u.apellidos}`,
        sublabel: u.cedula,
      })),
    [operadores],
  );
  const recintoOptions = useMemo(
    () =>
      recintos.map((r) => ({
        value: r.id,
        label: `${r.codigoRecinto} — ${r.nombre}`,
      })),
    [recintos],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = asignarKitSchema.safeParse({
      operadorId,
      recintoId,
      justificacion: justificacion.trim() || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/kits/${kit.id}/asignar`, parsed.data);
      onDone();
    } catch (err: any) {
      const data = err?.response?.data;
      if (data?.frozen) setFrozen(true);
      setError(data?.message ?? 'No se pudo asignar el kit');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="center" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10 }}>
      <form className="login-card" style={{ maxWidth: 480, width: '100%' }} onSubmit={onSubmit}>
        <h1>Asignar kit</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Kit <strong>{kit.codigoUnico}</strong> — {kit.nombre}
        </p>

        <div className="field">
          <label>Operador</label>
          <SearchableSelect
            options={operadorOptions}
            value={operadorId}
            onChange={setOperadorId}
            placeholder="— Selecciona un operador —"
            searchPlaceholder="Busca por nombre o cédula…"
            required
          />
        </div>

        <div className="field">
          <label>Recinto (CDA)</label>
          <SearchableSelect
            options={recintoOptions}
            value={recintoId}
            onChange={setRecintoId}
            placeholder="— Selecciona un recinto —"
            searchPlaceholder="Busca por nombre o código…"
            required
          />
        </div>

        {frozen && (
          <div className="field">
            <label>Justificación (requerida)</label>
            <textarea
              value={justificacion}
              onChange={(e) => setJustificacion(e.target.value)}
              rows={3}
              maxLength={500}
              required
              placeholder="La jornada electoral ya inició: explica por qué se necesita este cambio…"
              style={{
                width: '100%',
                padding: '0.5rem 0.65rem',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                fontSize: '0.9rem',
                resize: 'vertical',
              }}
            />
          </div>
        )}

        {error && <div className="banner error">{error}</div>}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Guardando…' : 'Asignar'}
          </button>
        </div>
      </form>
    </div>
  );
}
