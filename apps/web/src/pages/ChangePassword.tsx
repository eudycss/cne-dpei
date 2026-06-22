import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { strongPasswordSchema } from '@cne/shared-validation';
import { api } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { Logo } from '../components/Logo';
import { PasswordField } from '../components/PasswordField';

export function ChangePassword() {
  const { markPasswordChanged } = useAuth();
  const [currentPassword, setCurrent] = useState('');
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
      await api.post('/auth/change-password', { currentPassword, newPassword });
      markPasswordChanged();
      setOk(true);
      setTimeout(() => navigate('/users', { replace: true }), 800);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'No se pudo cambiar la contraseña');
    }
  }

  return (
    <div className="center">
      <form className="login-card" onSubmit={onSubmit}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
          <Logo height={60} />
        </div>
        <h1>Cambia tu contraseña</h1>
        <p className="muted" style={{ marginBottom: '1rem' }}>
          Por seguridad, debes cambiar la contraseña inicial. Entre 6 y 8 caracteres con
          mayúsculas, minúsculas, dígitos y símbolos.
        </p>
        <PasswordField
          label="Contraseña actual"
          required
          value={currentPassword}
          onChange={setCurrent}
        />
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
          Cambiar contraseña
        </button>
      </form>
    </div>
  );
}
