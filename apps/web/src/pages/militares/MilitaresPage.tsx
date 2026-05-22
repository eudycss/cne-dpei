import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Militar, Paginated, Recinto } from '@cne/shared-types';
import { createMilitarSchema, updateMilitarSchema } from '@cne/shared-validation';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { SearchInput } from '../../components/SearchInput';

export function MilitaresPage() {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes('ADMINISTRADOR') ?? false;
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Militar | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ['militares', { page, search: debounced }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (debounced) params.set('search', debounced);
      const res = await api.get<Paginated<Militar>>(`/militares?${params}`);
      return res.data;
    },
  });

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / data.pageSize));
  }, [data]);

  async function handleDelete(id: string, nombre: string) {
    if (!window.confirm(`¿Seguro que deseas eliminar a ${nombre}?`)) return;
    setDeletingId(id);
    try {
      await api.delete(`/militares/${id}`);
      qc.invalidateQueries({ queryKey: ['militares'] });
    } catch (e: any) {
      window.alert(e?.response?.data?.message ?? 'No se pudo eliminar');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <h2>Militares</h2>
      <div className="card">
        <div className="row">
          <SearchInput
            placeholder="Buscar por nombre, apellido o cédula"
            value={search}
            onChange={(v) => { setSearch(v); setPage(1); }}
            style={{ flex: 1 }}
          />
          {isAdmin && (
            <>
              <button className="btn" onClick={() => setShowCreate(true)}>+ Nuevo</button>
              <Link to="/militares/upload" className="btn secondary">Cargar Excel/CSV</Link>
            </>
          )}
        </div>

        {isLoading ? (
          <p className="muted">Cargando…</p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Cédula</th>
                  <th>Nombres</th>
                  <th>Recinto asignado</th>
                  {isAdmin && <th style={{ width: 180 }}>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {data?.items.map((m) => (
                  <tr key={m.id}>
                    <td>{m.cedula}</td>
                    <td>{m.nombres} {m.apellidos}</td>
                    <td>
                      {m.recintoNombre ?? '—'}
                      {m.recintoCodigo && (
                        <span className="muted"> ({m.recintoCodigo})</span>
                      )}
                    </td>
                    {isAdmin && (
                      <td>
                        <div className="row" style={{ margin: 0, gap: '0.35rem' }}>
                          <button
                            className="btn secondary"
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                            onClick={() => setEditing(m)}
                          >
                            Editar
                          </button>
                          <button
                            className="btn danger"
                            style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem' }}
                            disabled={deletingId === m.id}
                            onClick={() => handleDelete(m.id, `${m.nombres} ${m.apellidos}`)}
                          >
                            Eliminar
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {data?.items.length === 0 && (
                  <tr>
                    <td
                      colSpan={isAdmin ? 4 : 3}
                      className="muted"
                      style={{ textAlign: 'center', padding: '1.5rem' }}
                    >
                      No hay militares registrados
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

            <div className="row" style={{ marginTop: '1rem', justifyContent: 'space-between' }}>
              <span className="muted">
                {data
                  ? `${data.total} militar(es) · página ${page} de ${totalPages}`
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
        <MilitarModal
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey: ['militares'] });
          }}
        />
      )}

      {editing && (
        <MilitarModal
          militar={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['militares'] });
          }}
        />
      )}
    </>
  );
}

// ─── Modal crear / editar ─────────────────────────────────────────────────────

function MilitarModal({
  militar,
  onClose,
  onDone,
}: {
  militar?: Militar;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    cedula: militar?.cedula ?? '',
    nombres: militar?.nombres ?? '',
    apellidos: militar?.apellidos ?? '',
    recintoId: militar?.recintoId ?? '',
  });
  const [recintoSearch, setRecintoSearch] = useState(
    militar ? `${militar.recintoNombre ?? ''} (${militar.recintoCodigo ?? ''})` : '',
  );
  const [showDropdown, setShowDropdown] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Cargar todos los recintos (137 registros — caben en memoria)
  const { data: allRecintos } = useQuery({
    queryKey: ['recintos-all'],
    queryFn: async () => {
      const res = await api.get<Paginated<Recinto>>('/recintos?pageSize=200');
      return res.data.items;
    },
    staleTime: Infinity,
  });

  const filteredRecintos = useMemo(() => {
    if (!allRecintos) return [];
    const q = recintoSearch.toLowerCase().trim();
    if (!q || form.recintoId) return [];
    return allRecintos
      .filter(
        (r) =>
          r.nombre.toLowerCase().includes(q) ||
          r.codigoRecinto.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [allRecintos, recintoSearch, form.recintoId]);

  function field(k: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  function selectRecinto(r: Recinto) {
    setForm((f) => ({ ...f, recintoId: r.id }));
    setRecintoSearch(`${r.nombre} (${r.codigoRecinto})`);
    setShowDropdown(false);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.recintoId) {
      setError('Busca y selecciona un recinto de la lista');
      return;
    }
    const payload = {
      cedula: form.cedula,
      nombres: form.nombres,
      apellidos: form.apellidos,
      recintoId: form.recintoId,
    };
    const schema = militar ? updateMilitarSchema : createMilitarSchema;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos');
      return;
    }
    setSaving(true);
    try {
      if (militar) {
        await api.patch(`/militares/${militar.id}`, parsed.data);
      } else {
        await api.post('/militares', parsed.data);
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
      className="center"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10 }}
    >
      <form
        className="login-card"
        style={{ maxWidth: 520, width: '100%' }}
        onSubmit={onSubmit}
      >
        <h1>{militar ? 'Editar militar' : 'Nuevo militar'}</h1>

        <div className="field">
          <label>Cédula</label>
          <input
            value={form.cedula}
            onChange={field('cedula')}
            required
            maxLength={10}
            inputMode="numeric"
            placeholder="10 dígitos"
          />
        </div>

        <div className="field">
          <label>Nombres</label>
          <input value={form.nombres} onChange={field('nombres')} required />
        </div>

        <div className="field">
          <label>Apellidos</label>
          <input value={form.apellidos} onChange={field('apellidos')} required />
        </div>

        {/* Selector de recinto con búsqueda */}
        <div className="field" style={{ position: 'relative' }}>
          <label>Recinto</label>
          <div style={{ position: 'relative' }}>
            <input
              placeholder="Escribe el nombre o código del recinto…"
              value={recintoSearch}
              onChange={(e) => {
                setRecintoSearch(e.target.value);
                setForm((f) => ({ ...f, recintoId: '' }));
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              autoComplete="off"
              style={{ paddingRight: form.recintoId ? '2.2rem' : undefined }}
            />
            {form.recintoId && (
              <button
                type="button"
                title="Limpiar recinto"
                onClick={() => {
                  setForm((f) => ({ ...f, recintoId: '' }));
                  setRecintoSearch('');
                  setShowDropdown(false);
                }}
                style={{
                  position: 'absolute',
                  right: '0.5rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0.1rem 0.2rem',
                  color: '#6b7280',
                  fontSize: '1rem',
                  lineHeight: 1,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                ✕
              </button>
            )}
          </div>
          {showDropdown && filteredRecintos.length > 0 && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: '100%',
                background: '#fff',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                maxHeight: 200,
                overflowY: 'auto',
                zIndex: 20,
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              }}
            >
              {filteredRecintos.map((r) => (
                <div
                  key={r.id}
                  style={{
                    padding: '0.45rem 0.7rem',
                    cursor: 'pointer',
                    borderBottom: '1px solid #f3f4f6',
                    fontSize: '0.85rem',
                  }}
                  onMouseDown={() => selectRecinto(r)}
                >
                  <strong>{r.codigoRecinto}</strong> — {r.nombre}
                  {r.cantonNombre && (
                    <span className="muted"> · {r.cantonNombre}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <div className="banner error">{error}</div>}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Guardando…' : militar ? 'Guardar cambios' : 'Crear'}
          </button>
        </div>
      </form>
    </div>
  );
}
