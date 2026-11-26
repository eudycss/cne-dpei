import { FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { Logo } from '../components/Logo';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setOk(true);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'No se pudo procesar la solicitud');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="center">
      <form className="login-card" onSubmit={onSubmit}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
          <Logo height={60} />
        </div>
        <h1>Recuperar contraseña</h1>
        <p className="muted" style={{ marginBottom: '1rem' }}>
          Ingresa tu email y, si existe una cuenta asociada, te enviaremos un enlace para
          restablecer tu contraseña.
        </p>
        <div className="field">
          <label htmlFor="forgot-email">Correo</label>
          <input
            id="forgot-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {error && <div className="banner error" role="alert">{error}</div>}
        {ok && (
          <div className="banner success" role="status">
            Si el correo existe, te enviamos un enlace de recuperación.
          </div>
        )}
        <button className="btn" type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Enviando…' : 'Enviar enlace'}
        </button>
        <p className="muted" style={{ textAlign: 'center', marginTop: '1rem' }}>
          <Link to="/login">Volver a iniciar sesión</Link>
        </p>
      </form>
    </main>
  );
}
