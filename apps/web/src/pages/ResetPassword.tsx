import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { strongPasswordSchema } from '@cne/shared-validation';
import { api } from '../lib/api';
import { Logo } from '../components/Logo';
import { PasswordField } from '../components/PasswordField';

export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError('La confirmación no coincide');
      return;
    }
    const parse = strongPasswordSchema.safeParse(newPassword);
    if (!parse.success) {
      setError(parse.error.issues[0]?.message ?? 'Contraseña inválida');
      return;
    }
    try {
      await api.post('/auth/reset-password', { token, newPassword });
      setOk(true);
      setTimeout(() => navigate('/login', { replace: true }), 1200);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'No se pudo restablecer la contraseña');
    }
  }

  if (!token) {
    return (
      <div className="center">
        <div className="login-card">
          <div className="banner error">Enlace de recuperación inválido o expirado</div>
          <p className="muted" style={{ textAlign: 'center', marginTop: '1rem' }}>
            <Link to="/forgot-password">Solicitar un nuevo enlace</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="center">
      <form className="login-card" onSubmit={onSubmit}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
          <Logo height={60} />
        </div>
        <h1>Restablecer contraseña</h1>
        <p className="muted" style={{ marginBottom: '1rem' }}>
          Entre 6 y 8 caracteres con mayúsculas, minúsculas, dígitos y símbolos.
        </p>
        <PasswordField
          label="Nueva contraseña"
          required
          value={newPassword}
          onChange={setNew}
        />
        <PasswordField
          label="Confirmar nueva contraseña"
          required
          value={confirm}
          onChange={setConfirm}
        />
        {error && <div className="banner error">{error}</div>}
        {ok && <div className="banner success">Contraseña actualizada</div>}
        <button className="btn" type="submit" style={{ width: '100%' }}>
          Restablecer contraseña
        </button>
      </form>
    </div>
  );
}
