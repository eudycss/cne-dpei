import { FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Logo } from '../components/Logo';
import { PasswordField } from '../components/PasswordField';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { login, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: { pathname?: string } } };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const u = await login(email, password);
      if (u.debeCambiarPwd) {
        navigate('/change-password', { replace: true });
      } else {
        const dest = location.state?.from?.pathname ?? '/';
        navigate(dest, { replace: true });
      }
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Credenciales inválidas');
    }
  }

  return (
    <div className="center">
      <form className="login-card" onSubmit={onSubmit}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
          <Logo height={72} />
        </div>
        <h1>CNE Imbabura</h1>
        <p className="muted" style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
          Sistema de Trazabilidad y Logística Electoral
        </p>
        <div className="field">
          <label>Email</label>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <PasswordField
          label="Contraseña"
          autoComplete="current-password"
          required
          value={password}
          onChange={setPassword}
        />
        {error && <div className="banner error">{error}</div>}
        <button className="btn" type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Ingresando…' : 'Iniciar sesión'}
        </button>
      </form>
    </div>
  );
}
