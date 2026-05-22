import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Paginated, Role, User } from '@cne/shared-types';
import { api } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';

export function UsersList() {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes('ADMINISTRADOR') ?? false;
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showAssign, setShowAssign] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ['users', { page, search: debounced }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: '20' });
      if (debounced) params.set('search', debounced);
      const res = await api.get<Paginated<User>>(`/users?${params}`);
      return res.data;
    },
  });

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / data.pageSize));
  }, [data]);

  function toggle(id: string) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  return (
    <>
      <h2>Usuarios</h2>
      <div className="card">
        <div className="row">
          <input
            placeholder="Buscar por nombre, email o cédula"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            style={{ flex: 1, padding: '0.5rem', border: '1px solid #d1d5db', borderRadius: 6 }}
          />
          {isAdmin && (
            <>
              <Link to="/users/new" className="btn">+ Nuevo</Link>
              <Link to="/users/upload" className="btn secondary">Cargar Excel/CSV</Link>
              <button
                className="btn secondary"
                disabled={selected.size === 0}
                onClick={() => setShowAssign(true)}
              >
                Asignar roles ({selected.size})
              </button>
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
                  {isAdmin && <th style={{ width: 30 }}></th>}
                  <th>Cédula</th>
                  <th>Nombres</th>
                  <th>Email</th>
                  <th>Teléfono</th>
                  <th>Roles</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((u) => (
                  <tr key={u.id}>
                    {isAdmin && (
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(u.id)}
                          onChange={() => toggle(u.id)}
                        />
                      </td>
                    )}
                    <td>{u.cedula}</td>
                    <td>{u.nombres} {u.apellidos}</td>
                    <td>{u.email}</td>
                    <td>{u.telefono ?? '—'}</td>
                    <td>{u.roles.map((r) => <span key={r} className="badge">{r}</span>)}</td>
                    <td>{u.activo ? '✓ Activo' : '✗ Inactivo'}</td>
                  </tr>
                ))}
                {data?.items.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted" style={{ textAlign: 'center', padding: '1.5rem' }}>
                      No hay usuarios
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: '1rem', justifyContent: 'space-between' }}>
              <span className="muted">
                {data ? `${data.total} usuarios · página ${page} de ${totalPages}` : ''}
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

      {showAssign && (
        <AssignRolesModal
          userIds={[...selected]}
          onClose={() => setShowAssign(false)}
          onDone={() => {
            setShowAssign(false);
            setSelected(new Set());
            qc.invalidateQueries({ queryKey: ['users'] });
          }}
        />
      )}
    </>
  );
}

function AssignRolesModal({
  userIds,
  onClose,
  onDone,
}: {
  userIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { data: roles } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => (await api.get<Role[]>('/roles')).data,
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setErr(null);
    if (picked.size === 0) {
      setErr('Selecciona al menos un rol');
      return;
    }
    try {
      await api.post('/users/assign-roles', { userIds, roleIds: [...picked] });
      onDone();
    } catch (e: any) {
      setErr(e?.response?.data?.message ?? 'Error al asignar');
    }
  }

  return (
    <div className="center" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10 }}>
      <div className="login-card" style={{ maxWidth: 480 }}>
        <h1>Asignar roles</h1>
        <p className="muted">
          Reemplazará los roles actuales de <strong>{userIds.length}</strong> usuario(s).
        </p>
        {roles?.map((r) => (
          <label key={r.id} style={{ display: 'block', margin: '0.4rem 0' }}>
            <input
              type="checkbox"
              checked={picked.has(r.id)}
              onChange={() => {
                setPicked((s) => {
                  const n = new Set(s);
                  n.has(r.id) ? n.delete(r.id) : n.add(r.id);
                  return n;
                });
              }}
            />{' '}
            {r.nombre}
          </label>
        ))}
        {err && <div className="banner error">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button className="btn secondary" onClick={onClose}>Cancelar</button>
          <button className="btn" onClick={submit}>Asignar</button>
        </div>
      </div>
    </div>
  );
}
