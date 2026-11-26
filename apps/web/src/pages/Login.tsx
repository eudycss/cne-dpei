import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { Logo } from '../components/Logo';
import { PasswordField } from '../components/PasswordField';
import { apiPublico } from '../lib/api';

/** Pasado este tiempo sin respuesta, se avisa que el servidor puede estar despertando. */
export const LOGIN_LENTO_MS = 4000;

export function Login() {
  const [usuario, setUsuario] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { login, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: { pathname?: string } } };
  const lento = useDemoraLarga(loading, LOGIN_LENTO_MS);

  // La API está en el plan gratuito de Render y puede estar dormida: un ping al
  // abrir el login la despierta mientras la persona escribe su clave.
  useEffect(() => {
    apiPublico.get('/health').catch(() => {
      /* si no responde, el login mostrará su propio error */
    });
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const u = await login(usuario, password);
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
          <label htmlFor="login-usuario">Cédula o correo</label>
          <input
            id="login-usuario"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
          />
        </div>
        <PasswordField
          label="Contraseña"
          autoComplete="current-password"
          required
          value={password}
          onChange={setPassword}
        />
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}
        <button className="btn" type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Ingresando…' : 'Iniciar sesión'}
        </button>
        {/* Región presente desde el inicio para que el lector de pantalla anuncie el texto al aparecer. */}
        <p role="status" className="muted login-despertando">
          {lento ? 'Conectando con el servidor… La primera conexión del día puede tardar hasta un minuto.' : ''}
        </p>
        <p className="muted" style={{ textAlign: 'center', marginTop: '1rem' }}>
          <Link to="/forgot-password">¿Olvidaste tu contraseña?</Link>
        </p>
      </form>
    </div>
  );
}

/** true cuando `activo` lleva más de `ms` encendido; vuelve a false al apagarse. */
function useDemoraLarga(activo: boolean, ms: number): boolean {
  const [largo, setLargo] = useState(false);
  useEffect(() => {
    if (!activo) {
      setLargo(false);
      return;
    }
    const t = setTimeout(() => setLargo(true), ms);
    return () => clearTimeout(t);
  }, [activo, ms]);
  return largo;
}
