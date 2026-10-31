import { useMemo, useState } from 'react';
import type { ResetPasswordBulkResult, User } from '@cne/shared-types';

import { Modal } from '../../components/Modal';
import { api } from '../../lib/api';

/**
 * Restablece la clave de varios usuarios a su cédula. Antes de confirmar
 * muestra cuántos son y de qué roles, para no tocar por error a otros
 * (p. ej. a los Asistentes Transversales al restablecer a los operadores).
 */
export function ResetPasswordBulkModal({
  users,
  onClose,
  onDone,
}: {
  users: User[];
  onClose: () => void;
  /** Se llama al cerrar después de restablecer. */
  onDone: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResetPasswordBulkResult | null>(null);

  const porRol = useMemo(() => {
    const conteo = new Map<string, number>();
    for (const u of users) {
      const clave = u.roles.length ? u.roles.join(' + ') : 'Sin rol';
      conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
    }
    return [...conteo.entries()].sort((a, b) => b[1] - a[1]);
  }, [users]);

  async function confirmar() {
    setError(null);
    setSaving(true);
    try {
      const res = await api.post<ResetPasswordBulkResult>('/users/reset-password-bulk', {
        userIds: users.map((u) => u.id),
      });
      setResultado(res.data);
    } catch (e: unknown) {
      const mensaje = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      // Sin respuesta (p. ej. tiempo agotado) el servidor pudo restablecer una parte.
      setError(
        mensaje ??
          'No se recibió respuesta. Puede que una parte sí se haya restablecido: revise el listado antes de reintentar.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal labelledBy="reset-bulk-titulo" onClose={saving ? () => undefined : resultado ? onDone : onClose}>
      <div className="login-card" style={{ width: '100%' }}>
        <h1 id="reset-bulk-titulo">Restablecer claves</h1>

        {!resultado ? (
          <>
            <p>
              Se restablecerá la clave de <strong>{users.length} usuario(s)</strong>:
            </p>
            <ul>
              {porRol.map(([rol, n]) => (
                <li key={rol}>
                  {rol}: {n}
                </li>
              ))}
            </ul>
            <div className="banner" role="note">
              Su clave pasará a ser su cédula, deberán cambiarla al ingresar y se cerrarán sus sesiones
              abiertas. Su propia cuenta no se restablece.
            </div>
            {error && (
              <div className="banner error" role="alert">
                {error}
              </div>
            )}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button type="button" className="btn secondary" onClick={onClose} disabled={saving}>
                Cancelar
              </button>
              <button type="button" className="btn danger" onClick={confirmar} disabled={saving}>
                {saving ? 'Restableciendo…' : `Restablecer ${users.length} claves`}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="banner success" role="status">
              {resultado.restablecidos} clave(s) restablecida(s). Ahora su clave es su cédula.
            </div>
            {resultado.omitidos.length > 0 && (
              <>
                <p>No se restablecieron {resultado.omitidos.length}:</p>
                <ul>
                  {resultado.omitidos.map((o) => (
                    <li key={o.id}>
                      {o.nombre ?? o.id}: {o.motivo}
                    </li>
                  ))}
                </ul>
              </>
            )}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button type="button" className="btn" onClick={onDone}>
                Listo
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
