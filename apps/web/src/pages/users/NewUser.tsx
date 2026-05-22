import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createUserSchema } from '@cne/shared-validation';
import { api } from '../../lib/api';

export function NewUser() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    cedula: '',
    email: '',
    nombres: '',
    apellidos: '',
    telefono: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ email: string; initialPassword: string } | null>(null);

  function update(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = createUserSchema.safeParse({
      ...form,
      telefono: form.telefono || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Datos inválidos');
      return;
    }
    try {
      const res = await api.post('/users', parsed.data);
      setCreated({ email: res.data.email, initialPassword: res.data.initialPassword });
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'No se pudo crear');
    }
  }

  if (created) {
    return (
      <>
        <h2>Usuario creado</h2>
        <div className="card">
          <p>El usuario <strong>{created.email}</strong> fue creado correctamente.</p>
          <div className="banner">
            Contraseña inicial: <code style={{ background: '#fff', padding: '0.2rem 0.4rem' }}>{created.initialPassword}</code>
            <br />
            <small>El usuario deberá cambiarla en su primer inicio de sesión.</small>
          </div>
          <button className="btn" onClick={() => navigate('/users')}>Volver al listado</button>
        </div>
      </>
    );
  }

  return (
    <>
      <h2>Nuevo usuario</h2>
      <form className="card" onSubmit={onSubmit} style={{ maxWidth: 520 }}>
        <div className="field">
          <label>Cédula (10 dígitos)</label>
          <input value={form.cedula} onChange={update('cedula')} required />
        </div>
        <div className="field">
          <label>Email</label>
          <input type="email" value={form.email} onChange={update('email')} required />
        </div>
        <div className="field">
          <label>Nombres</label>
          <input value={form.nombres} onChange={update('nombres')} required />
        </div>
        <div className="field">
          <label>Apellidos</label>
          <input value={form.apellidos} onChange={update('apellidos')} required />
        </div>
        <div className="field">
          <label>Teléfono (opcional)</label>
          <input value={form.telefono} onChange={update('telefono')} />
        </div>
        {error && <div className="banner error">{error}</div>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn secondary" type="button" onClick={() => navigate('/users')}>
            Cancelar
          </button>
          <button className="btn" type="submit">Crear</button>
        </div>
      </form>
    </>
  );
}
