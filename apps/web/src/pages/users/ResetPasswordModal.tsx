import { useState } from 'react';
import type { User } from '@cne/shared-types';
import { api } from '../../lib/api';

interface Props {
  user: User;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Restablece la contraseña de un usuario. Tras confirmar, muestra la
 * contraseña temporal generada para que el administrador la entregue.
 */
export function ResetPasswordModal({ user, onClose, onDone }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function confirm() {
    setError(null);
    setLoading(true);
    try {
      const res = await api.post<{ temporaryPassword: string }>(
        `/users/${user.id}/reset-password`,
      );
      setTempPassword(res.data.temporaryPassword);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'No se pudo restablecer la contraseña');
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard no disponible */
    }
  }

  return (
    <div className="center" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10 }}>
      <div className="login-card" style={{ maxWidth: 480 }}>
        <h1>Restablecer contraseña</h1>

        {!tempPassword ? (
          <>
            <p className="muted">
              Se generará una contraseña temporal para{' '}
              <strong>{user.nombres} {user.apellidos}</strong> ({user.email}).
              El usuario deberá cambiarla en su próximo inicio de sesión y sus
              sesiones activas se cerrarán.
            </p>
            {error && <div className="banner error">{error}</div>}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button className="btn secondary" onClick={onClose} disabled={loading}>
                Cancelar
              </button>
              <button className="btn danger" onClick={confirm} disabled={loading}>
                {loading ? 'Restableciendo…' : 'Restablecer'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="banner success">
              Contraseña temporal generada. Entrégala al usuario; deberá
              cambiarla al ingresar.
            </div>
            <div
              className="row"
              style={{ justifyContent: 'space-between', background: '#f3f4f6', padding: '0.6rem 0.8rem', borderRadius: 6 }}
            >
              <code style={{ fontSize: '1rem' }}>{tempPassword}</code>
              <button className="btn secondary" style={{ padding: '0.3rem 0.6rem' }} onClick={copy}>
                {copied ? '¡Copiado!' : 'Copiar'}
              </button>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button className="btn" onClick={onDone}>Listo</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
