import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { sileo } from 'sileo';
import type { Kit, NumeroMochilaRequest } from '@cne/shared-types';
import { leerNumeroMochila } from '@cne/shared-validation';
import { Modal } from '../../components/Modal';
import { guardarNumeroMochila } from '../../lib/queries/kits';
import { mensajeError } from '../operadores-cda/utils';

/** El número ya es de otro QR: la API dice cuál, y se puede pasárselo a este. */
function enOtroQr(e: unknown): string | null {
  if (!isAxiosError(e) || e.response?.status !== 409) return null;
  const data = e.response.data as { codigo?: string; message?: string } | undefined;
  return data?.codigo === 'MOCHILA_EN_OTRO_QR' ? data.message ?? 'Ese N.º ya es de otro QR.' : null;
}

/**
 * N.º de la mochila física con el QR de este kit. Es de la mochila, no del
 * evento: se carga una vez y vale en todos los eventos.
 */
export function NumeroMochilaModal({ kit, onClose, onDone }: { kit: Kit; onClose: () => void; onDone: () => void }) {
  const [texto, setTexto] = useState(kit.numeroMochila != null ? String(kit.numeroMochila) : '');
  const [conflicto, setConflicto] = useState<string | null>(null);
  const numero = leerNumeroMochila(texto);
  const invalido = texto.trim() !== '' && numero === null;

  const guardar = useMutation({
    mutationFn: async (body: NumeroMochilaRequest) => (await guardarNumeroMochila(kit.id, body)).data,
    onSuccess: (r) => {
      sileo.success({
        title: r.numeroMochila === null ? 'N.º de mochila quitado' : `Mochila N.º ${r.numeroMochila} guardada`,
        description: r.quitadoDe ? `Se le quitó al QR ${r.quitadoDe}.` : `${kit.nombre} (${r.codigoUnico})`,
      });
      onDone();
    },
    onError: (e) => setConflicto(enOtroQr(e)),
  });
  const ocupado = guardar.isPending;

  return (
    <Modal labelledBy="mochila-titulo" onClose={onClose} maxWidth={460}>
      <form
        className="login-card"
        style={{ width: '100%', maxWidth: 'none' }}
        aria-busy={ocupado}
        onSubmit={(e) => {
          e.preventDefault();
          if (numero !== null && !ocupado) guardar.mutate({ numero });
        }}
      >
        <h1 id="mochila-titulo">N.º de mochila</h1>
        <p>
          <strong>{kit.nombre}</strong> · QR <code>{kit.codigoUnico}</code>
        </p>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Es el número de la mochila física con este QR: se guarda una vez y sirve en todos los eventos.
        </p>
        <div className="field">
          <label htmlFor="mochila-numero">N.º de mochila (1 a 9999)</label>
          <input
            id="mochila-numero"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            maxLength={12}
            value={texto}
            aria-invalid={invalido}
            aria-describedby={invalido ? 'mochila-numero-error' : undefined}
            onChange={(e) => {
              setTexto(e.target.value);
              setConflicto(null);
              guardar.reset();
            }}
          />
          {invalido && (
            <p id="mochila-numero-error" className="error" role="alert" style={{ margin: '0.3rem 0 0' }}>
              Escriba un número de 1 a 9999.
            </p>
          )}
        </div>

        {conflicto ? (
          <div className="banner aviso" role="alert">
            <p style={{ margin: 0 }}>{conflicto}</p>
            <p style={{ margin: '0.4rem 0 0' }}>¿Pasarle ese número a este kit? Al otro QR le quedará sin número.</p>
            <button
              type="button"
              className="btn"
              style={{ marginTop: '0.5rem' }}
              disabled={ocupado || numero === null}
              onClick={() => numero !== null && guardar.mutate({ numero, reemplazar: true })}
            >
              Sí, pasárselo a este kit
            </button>
          </div>
        ) : (
          guardar.isError && (
            <p className="banner error" role="alert">
              {mensajeError(guardar.error, 'No se pudo guardar el N.º de mochila')}
            </p>
          )
        )}

        <div className="row" style={{ justifyContent: 'space-between', gap: '0.5rem', marginTop: '1rem' }}>
          <div>
            {kit.numeroMochila != null && (
              <button
                type="button"
                className="btn secondary"
                disabled={ocupado}
                onClick={() => {
                  if (window.confirm(`¿Quitar el N.º ${kit.numeroMochila} de esta mochila?`)) guardar.mutate({ numero: null });
                }}
              >
                Quitar número
              </button>
            )}
          </div>
          <div className="row" style={{ gap: '0.5rem' }}>
            <button type="button" className="btn secondary" onClick={onClose} disabled={ocupado}>
              Cancelar
            </button>
            <button type="submit" className="btn" disabled={numero === null || numero === kit.numeroMochila || ocupado}>
              {ocupado ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
