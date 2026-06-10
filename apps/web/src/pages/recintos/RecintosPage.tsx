import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

  return (
    <>
      <h2>Recintos Electorales</h2>
      <div className="card">
        <div className="row">
          <SearchInput
            placeholder="Buscar por nombre, código o parroquia"
            value={search}
            onChange={(v) => { setSearch(v); setPage(1); }}
            style={{ flex: 1 }}
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
          {isAdmin && (
            <button className="btn" onClick={() => setShowCreate(true)}>+ Nuevo</button>
          )}
        </div>

        {isLoading ? (
          <p className="muted">Cargando…</p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th>Cantón</th>
                  <th>Parroquia / Zona</th>
                  <th>Tipo</th>
                  <th>Internet</th>
                  <th>Cobertura</th>
                  <th>Electores</th>
                  {isAdmin && <th style={{ width: 180 }}>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {data?.items.map((r) => (
                  <tr key={r.id}>
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
                    <td>{r.tieneInternet ? 'Sí' : 'No'}</td>
                    <td>{r.coberturaMovil ? 'Sí' : 'No'}</td>
                    <td>{r.numeroElectores ?? '—'}</td>
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
                ))}
                {data?.items.length === 0 && (
                  <tr>
                    <td
                      colSpan={isAdmin ? 9 : 8}
                      className="muted"
                      style={{ textAlign: 'center', padding: '1.5rem' }}
                    >
                      No hay recintos registrados
                    </td>
                  </tr>
                )}
              </tbody>
            </table>

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
          }}
        />
      )}
    </>
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
      className="center"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        zIndex: 10,
        overflowY: 'auto',
        padding: '2rem 0',
      }}
    >
      <form
        className="login-card"
        style={{ maxWidth: 560, width: '100%' }}
        onSubmit={onSubmit}
      >
        <h1>{recinto ? 'Editar recinto' : 'Nuevo recinto'}</h1>

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

        <div className="field">
          <label>Parroquia (opcional)</label>
          <input value={form.parroquia} onChange={textField('parroquia')} maxLength={120} />
        </div>

        <div className="field">
          <label>Zona (opcional)</label>
          <input value={form.zona} onChange={textField('zona')} maxLength={120} />
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

        <div className="row">
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

        <div className="field">
          <label>Número de electores (opcional)</label>
          <input
            type="number"
            min={0}
            value={form.numeroElectores}
            onChange={textField('numeroElectores')}
          />
        </div>

        <div className="row" style={{ gap: '1.5rem' }}>
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

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
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
