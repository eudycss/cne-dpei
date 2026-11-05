import { useMemo, useRef, useState } from 'react';
import type { ResetPasswordBulkResult, User } from '@cne/shared-types';

import { Modal } from '../../components/Modal';
import { api } from '../../lib/api';

/**
 * Usuarios por petición: 132 de una vez superaban el tiempo de espera de la
 * web. Debe ser ≤ al máximo de resetPasswordBulkSchema (50).
 */
export const TAMANO_LOTE = 20;

/**
 * Restablece la clave de varios usuarios a su cédula. Antes de confirmar
 * muestra cuántos son y de qué roles, para no tocar por error a otros
 * (p. ej. a los Asistentes Transversales al restablecer a los operadores).
 */
export function ResetPasswordBulkModal({
  users: usersAlAbrir,
  onClose,
  onDone,
}: {
  users: User[];
  onClose: () => void;
  /** Se llama al cerrar después de restablecer. */
  onDone: () => void;
}) {
  // Fija la lista al abrir: el avance indexa sobre ella y un refetch del listado no debe moverla.
  const [users] = useState(usersAlAbrir);
  const enCurso = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResetPasswordBulkResult | null>(null);
  // Avance entre lotes: si uno falla, "Continuar" sigue desde ahí sin repetir los ya hechos.
  const [hechos, setHechos] = useState(0);
  const [acumulado, setAcumulado] = useState<ResetPasswordBulkResult>({ restablecidos: 0, omitidos: [] });
  const faltan = users.length - hechos;
  const cerrar = hechos > 0 ? onDone : onClose;

  const porRol = useMemo(() => {
    const conteo = new Map<string, number>();
    for (const u of users) {
      const clave = u.roles.length ? u.roles.join(' + ') : 'Sin rol';
      conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
    }
    return [...conteo.entries()].sort((a, b) => b[1] - a[1]);
  }, [users]);

  async function confirmar() {
    if (enCurso.current) return;
    enCurso.current = true;
    setError(null);
    setSaving(true);
    let enviados = hechos;
    let total = acumulado;
    try {
      while (enviados < users.length) {
        const lote = users.slice(enviados, enviados + TAMANO_LOTE);
        const res = await api.post<ResetPasswordBulkResult>('/users/reset-password-bulk', {
          userIds: lote.map((u) => u.id),
        });
        total = {
          restablecidos: total.restablecidos + res.data.restablecidos,
          omitidos: [...total.omitidos, ...res.data.omitidos],
        };
        enviados += lote.length;
        setHechos(enviados);
        setAcumulado(total);
      }
      setResultado(total);
    } catch (e: unknown) {
      const mensaje = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      const restantes = users.length - enviados;
      const avance = enviados > 0 ? `Van ${total.restablecidos} restablecida(s). ` : '';
      const boton = enviados > 0 ? `Continuar con ${restantes} claves` : `Restablecer ${users.length} claves`;
      // Sin respuesta (p. ej. tiempo agotado) el servidor pudo restablecer una parte del lote.
      setError(
        `${avance}${mensaje ?? 'No se recibió respuesta: puede que alguno del último grupo sí se haya restablecido.'} ` +
          `Faltan ${restantes}: pulse "${boton}" para seguir.`,
      );
    } finally {
      enCurso.current = false;
      setSaving(false);
    }
  }

  return (
    <Modal labelledBy="reset-bulk-titulo" onClose={saving ? () => undefined : resultado ? onDone : cerrar}>
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
            {/* Siempre montado: los lectores de pantalla anuncian los cambios de una región ya presente. */}
            <p role="status" style={{ minHeight: '1.2em', margin: 0 }}>
              {saving ? `Restableciendo ${hechos} de ${users.length}…` : ''}
            </p>
            {error && (
              <div className="banner error" role="alert">
                {error}
              </div>
            )}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button type="button" className="btn secondary" onClick={cerrar} disabled={saving}>
                Cancelar
              </button>
              <button type="button" className="btn danger" onClick={confirmar} disabled={saving}>
                {saving ? 'Restableciendo…' : hechos > 0 ? `Continuar con ${faltan} claves` : `Restablecer ${users.length} claves`}
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
