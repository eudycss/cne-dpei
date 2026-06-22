import { FormEvent, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { updateUserSchema } from '@cne/shared-validation';
import type { Role, User } from '@cne/shared-types';
import { api } from '../../lib/api';

interface Props {
  user: User;
  isAdmin: boolean;
  onClose: () => void;
  onDone: () => void;
}

export function EditUserModal({ user, isAdmin, onClose, onDone }: Props) {
  const [form, setForm] = useState({
    nombres: user.nombres,
    apellidos: user.apellidos,
    email: user.email,
    telefono: user.telefono ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: roles } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => (await api.get<Role[]>('/roles')).data,
    enabled: isAdmin,
  });
  const rolOriginalId = roles?.find((r) => r.nombre === user.roles[0])?.id ?? '';
  const [rolId, setRolId] = useState('');
  useEffect(() => {
    setRolId(rolOriginalId);
  }, [rolOriginalId]);

  function update(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = updateUserSchema.safeParse({
      nombres: form.nombres,
      apellidos: form.apellidos,
      email: form.email,
      telefono: form.telefono || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos');
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/users/${user.id}`, parsed.data);
      if (isAdmin && rolId && rolId !== rolOriginalId) {
        await api.post('/users/assign-roles', { userIds: [user.id], roleIds: [rolId] });
      }
      onDone();
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="center" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10 }}>
      <form className="login-card" style={{ maxWidth: 480 }} onSubmit={onSubmit}>
        <h1>Editar usuario</h1>
        <p className="muted" style={{ marginBottom: '1rem' }}>
          Cédula: <strong>{user.cedula}</strong> (no editable)
        </p>
        <div className="field">
          <label>Nombres</label>
          <input value={form.nombres} onChange={update('nombres')} required />
        </div>
        <div className="field">
          <label>Apellidos</label>
          <input value={form.apellidos} onChange={update('apellidos')} required />
        </div>
        <div className="field">
          <label>Email</label>
          <input type="email" value={form.email} onChange={update('email')} required />
        </div>
        <div className="field">
          <label>Teléfono (opcional)</label>
          <input value={form.telefono} onChange={update('telefono')} />
        </div>
        {isAdmin && (
          <div className="field">
            <label>Rol</label>
            <select value={rolId} onChange={(e) => setRolId(e.target.value)}>
              {roles?.map((r) => (
                <option key={r.id} value={r.id}>{r.nombre}</option>
              ))}
            </select>
          </div>
        )}
        {error && <div className="banner error">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn" disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </form>
    </div>
  );
}
