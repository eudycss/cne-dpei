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
    cedula: user.cedula,
    nombres: user.nombres,
    apellidos: user.apellidos,
    email: user.email ?? '',
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
    const cedula = form.cedula.trim();
    const parsed = updateUserSchema.safeParse({
      // Solo se envía si cambió: así una cédula antigua inválida no bloquea editar otros datos
      cedula: cedula !== user.cedula ? cedula : undefined,
      nombres: form.nombres,
      apellidos: form.apellidos,
      // Las cuentas CDA no tienen correo: vacío = no se envía (no se puede borrar uno existente).
      email: form.email.trim() || undefined,
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
      <form
        className="login-card"
        style={{ maxWidth: 480 }}
        onSubmit={onSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="editar-usuario-titulo"
      >
        <h1 id="editar-usuario-titulo">Editar usuario</h1>
        <div className="field">
          <label htmlFor="editar-usuario-cedula">Cédula (10 dígitos)</label>
          <input
            id="editar-usuario-cedula"
            value={form.cedula}
            // Solo dígitos: tolera cédulas pegadas con espacios o guiones
            onChange={(e) => setForm((f) => ({ ...f, cedula: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
            inputMode="numeric"
            autoComplete="off"
            aria-describedby="editar-usuario-cedula-ayuda"
            required
          />
          <small id="editar-usuario-cedula-ayuda" className="muted">
            Corregirla no afecta sus asignaciones, kits ni actas.
          </small>
        </div>
        <div className="field">
          <label htmlFor="editar-usuario-nombres">Nombres</label>
          <input id="editar-usuario-nombres" value={form.nombres} onChange={update('nombres')} required />
        </div>
        <div className="field">
          <label htmlFor="editar-usuario-apellidos">Apellidos</label>
          <input id="editar-usuario-apellidos" value={form.apellidos} onChange={update('apellidos')} required />
        </div>
        <div className="field">
          <label htmlFor="editar-usuario-email">Email</label>
          <input id="editar-usuario-email" type="email" value={form.email} onChange={update('email')} required={user.email !== null} />
        </div>
        <div className="field">
          <label htmlFor="editar-usuario-telefono">Teléfono (opcional)</label>
          <input id="editar-usuario-telefono" value={form.telefono} onChange={update('telefono')} />
        </div>
        {isAdmin && (
          <div className="field">
            <label htmlFor="editar-usuario-rol">Rol</label>
            <select id="editar-usuario-rol" value={rolId} onChange={(e) => setRolId(e.target.value)}>
              {roles?.map((r) => (
                <option key={r.id} value={r.id}>{r.nombre}</option>
              ))}
            </select>
          </div>
        )}
        {error && <div className="banner error" role="alert">{error}</div>}
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
