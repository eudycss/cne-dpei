import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Asignacion, EventoElectoral, Paginated, User } from '@cne/shared-types';
import { sileo } from 'sileo';
import { api } from '../../lib/api';
import { SearchInput } from '../../components/SearchInput';

const SIN_ASIGNAR = '';

export function AsignacionesPage() {
  const [eventoId, setEventoId] = useState<string>('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  // Debounce de búsqueda
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Resetear página al cambiar búsqueda o evento
  useEffect(() => { setPage(1); }, [debounced, eventoId]);

  // Todos los eventos (selector superior)
  const { data: eventos } = useQuery({
    queryKey: ['eventos'],
    queryFn: async () => (await api.get<EventoElectoral[]>('/eventos')).data,
  });

  // Operadores CDA paginados + búsqueda (server-side)
  const { data: operadoresData, isLoading: loadingOp } = useQuery({
    queryKey: ['users-operadores', { page, search: debounced }],
    queryFn: async () => {
      const params = new URLSearchParams({
        role: 'OPERADOR_CDA',
        pageSize: '20',
        page: String(page),
      });
      if (debounced) params.set('search', debounced);
      return (await api.get<Paginated<User>>(`/users?${params}`)).data;
    },
  });

  // Técnicos supervisores: pocos, cargamos todos de una vez
  const { data: supervisoresData } = useQuery({
    queryKey: ['users-supervisores'],
    queryFn: async () =>
      (await api.get<Paginated<User>>('/users?role=TECNICO_SUPERVISOR&pageSize=500')).data,
    staleTime: 60_000,
  });

  // Asignaciones del evento: todas a la vez para el mapa operadorId→asignación
  const { data: asignaciones, isLoading: loadingAsig } = useQuery({
    queryKey: ['asignaciones', eventoId],
    queryFn: async () =>
      (await api.get<Asignacion[]>(`/asignaciones?eventoId=${eventoId}`)).data,
    enabled: !!eventoId,
  });

  const operadores = operadoresData?.items ?? [];
  const supervisores = supervisoresData?.items ?? [];
  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((operadoresData?.total ?? 0) / (operadoresData?.pageSize ?? 20))),
    [operadoresData],
  );

  // Mapa operadorId → asignación (funciona sobre todos los del evento, no solo la página)
  const asigByOperador = useMemo(
    () => new Map<string, Asignacion>((asignaciones ?? []).map((a) => [a.operadorId, a])),
    [asignaciones],
  );

  // Pre-seleccionar el evento ACTIVO al cargar
  if (!eventoId && eventos) {
    const activo = eventos.find((e) => e.estado === 'ACTIVO');
    if (activo) setEventoId(activo.id);
    else if (eventos.length > 0) setEventoId(eventos[0].id);
  }

  async function handleChange(operadorId: string, supervisorId: string) {
    if (!eventoId) return;
    if (supervisorId === SIN_ASIGNAR) {
      const existente = asigByOperador.get(operadorId);
      if (existente) {
        try {
          await api.delete(`/asignaciones/${existente.id}`);
          qc.invalidateQueries({ queryKey: ['asignaciones', eventoId] });
        } catch (e: any) {
          sileo.error({ title: e?.response?.data?.message ?? 'No se pudo eliminar la asignación' });
        }
      }
      return;
    }
    try {
      await api.put('/asignaciones', { eventoId, operadorId, supervisorId });
      qc.invalidateQueries({ queryKey: ['asignaciones', eventoId] });
    } catch (e: any) {
      sileo.error({ title: e?.response?.data?.message ?? 'No se pudo guardar la asignación' });
    }
  }

  async function downloadTemplate() {
    try {
      const res = await api.get('/asignaciones/template.xlsx', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'plantilla_asignaciones.xlsx';
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
        `/asignaciones/bulk?eventoId=${eventoId}`,
        fd,
      );
      const { creados, errores } = res.data;
      sileo[errores.length > 0 ? 'warning' : 'success']({
        title: `Importación completa: ${creados} asignación(es) creada(s).`,
        description:
          errores.length > 0
            ? `${errores.length} error(es): ` + errores.map((er) => `Fila ${er.fila}: ${er.error}`).join(', ')
            : undefined,
      });
      qc.invalidateQueries({ queryKey: ['asignaciones', eventoId] });
    } catch (err: any) {
      sileo.error({ title: 'Error al importar: ' + (err?.response?.data?.message ?? err?.message ?? 'desconocido') });
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  const eventoSeleccionado = eventos?.find((e) => e.id === eventoId);
  const isLoading = loadingOp || loadingAsig;

  return (
    <>
      <h2>Asignación operador ↔ supervisor</h2>

      {/* ── Selector de evento ── */}
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

      {/* ── Tabla de asignaciones ── */}
      {eventoId && (
        <div className="card">
          {eventoSeleccionado && (
            <p className="muted" style={{ marginTop: 0 }}>
              Evento: <strong>{eventoSeleccionado.nombre}</strong> · Fecha:{' '}
              {eventoSeleccionado.fechaJornada}
            </p>
          )}

          {supervisores.length === 0 && !loadingOp ? (
            <div className="banner" style={{ marginBottom: 0 }}>
              No hay usuarios con rol <strong>TECNICO_SUPERVISOR</strong>. Asigna ese rol
              a al menos un usuario en <a href="/users">Usuarios</a>.
            </div>
          ) : (
            <>
              {/* Barra de búsqueda */}
              <div className="row" style={{ marginBottom: '0.75rem' }}>
                <SearchInput
                  placeholder="Buscar operador por nombre, apellido o cédula…"
                  value={search}
                  onChange={(v) => setSearch(v)}
                  style={{ flex: 1 }}
                />
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
                  title="Carga masiva de asignaciones (Excel/CSV)"
                >
                  {importing ? 'Importando…' : '↑ Importar'}
                </button>
              </div>

              <p className="muted" style={{ marginTop: 0, marginBottom: '0.5rem' }}>
                Selecciona el técnico supervisor para cada operador CDA. Los cambios se guardan
                automáticamente.
              </p>

              {isLoading ? (
                <p className="muted">Cargando…</p>
              ) : operadores.length === 0 ? (
                <p className="muted" style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                  {debounced
                    ? 'No hay operadores que coincidan con la búsqueda.'
                    : 'No hay usuarios con rol OPERADOR_CDA en el sistema.'}
                  {!debounced && (
                    <>
                      {' '}Asigna ese rol en <a href="/users">Usuarios</a>.
                    </>
                  )}
                </p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Operador CDA</th>
                      <th>Cédula</th>
                      <th>Técnico supervisor asignado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operadores.map((op) => (
                      <OperadorRow
                        key={op.id}
                        operador={op}
                        supervisores={supervisores}
                        supervisorId={asigByOperador.get(op.id)?.supervisorId ?? SIN_ASIGNAR}
                        onChange={(svId) => handleChange(op.id, svId)}
                      />
                    ))}
                  </tbody>
                </table>
              )}

              {/* Paginación y resumen */}
              <div className="row" style={{ marginTop: '1rem', justifyContent: 'space-between' }}>
                <span className="muted">
                  {operadoresData
                    ? `${operadoresData.total} operador(es) · página ${page} de ${totalPages} · ${asignaciones?.length ?? 0} asignado(s)`
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
      )}

      {!eventoId && eventos?.length === 0 && (
        <div className="card">
          <div className="banner" style={{ marginBottom: 0 }}>
            No hay eventos electorales creados. Crea uno en{' '}
            <a href="/eventos">Eventos Electorales</a>.
          </div>
        </div>
      )}
    </>
  );
}

// ─── Fila de operador ────────────────────────────────────────────────────────

function OperadorRow({
  operador,
  supervisores,
  supervisorId,
  onChange,
}: {
  operador: User;
  supervisores: User[];
  supervisorId: string;
  onChange: (supervisorId: string) => void;
}) {
  const [saving, setSaving] = useState(false);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSaving(true);
    try {
      await onChange(e.target.value);
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr>
      <td>
        {operador.nombres} {operador.apellidos}
      </td>
      <td>{operador.cedula}</td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <select
            value={supervisorId}
            onChange={handleChange}
            disabled={saving}
            style={{
              padding: '0.35rem 0.5rem',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              fontSize: '0.85rem',
              minWidth: 260,
              background: supervisorId ? '#f0fdf4' : '#fff',
              color: supervisorId ? '#15803d' : '#6b7280',
            }}
          >
            <option value="">— Sin asignar —</option>
            {supervisores.map((sv) => (
              <option key={sv.id} value={sv.id}>
                {sv.nombres} {sv.apellidos} ({sv.cedula})
              </option>
            ))}
          </select>
          {saving && (
            <span className="muted" style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
              Guardando…
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
