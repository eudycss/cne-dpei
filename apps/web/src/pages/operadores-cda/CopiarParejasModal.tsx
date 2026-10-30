import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../../components/Modal';
import { copiarParejasCda } from '../../lib/queries/operadores-cda';
import { mensajeError } from './utils';

/**
 * Copia la lista del día mostrado a otro día (mismas parejas y recintos).
 * Solo se registra: se revisa, se intercambia lo que haga falta y luego se
 * pasa a la app con "Aplicar a la app".
 */
export function CopiarParejasModal({
  desde,
  total,
  onVerDia,
  onClose,
}: {
  desde: string;
  /** Parejas del día de origen (para el texto). */
  total: number;
  /** Lleva al día copiado. */
  onVerDia: (dia: string) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [hacia, setHacia] = useState('');
  const copiar = useMutation({
    mutationFn: () => copiarParejasCda({ desde, hacia }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['parejas-cda'] }),
  });
  const r = copiar.data;
  const mismoDia = hacia === desde;
  const puedeCopiar = /^\d{4}-\d{2}-\d{2}$/.test(hacia) && !mismoDia && !copiar.isPending && !r;

  return (
    <Modal labelledBy="copiar-parejas-titulo" onClose={onClose} maxWidth={520}>
      <form
        className="login-card"
        style={{ width: '100%', maxWidth: 'none' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (puedeCopiar) copiar.mutate();
        }}
        aria-busy={copiar.isPending}
      >
        <h1 id="copiar-parejas-titulo">Copiar la lista a otro día</h1>
        <p className="muted">
          Se copian las {total} pareja(s) del {desde} con su recinto. Solo quedan registradas: revíselas, cambie o intercambie lo que
          haga falta y luego pulse <strong>Aplicar a la app</strong> en ese día.
        </p>

        <div className="field">
          <label htmlFor="copiar-parejas-dia">Copiar al día</label>
          <input
            id="copiar-parejas-dia"
            type="date"
            value={hacia}
            onChange={(e) => setHacia(e.target.value)}
            required
            disabled={!!r}
            aria-describedby={mismoDia ? 'copiar-parejas-mismo-dia' : undefined}
          />
          {mismoDia && (
            <p id="copiar-parejas-mismo-dia" className="muted" style={{ margin: '0.25rem 0 0' }}>
              Elija un día distinto del {desde}.
            </p>
          )}
        </div>

        {copiar.isError && (
          <p className="banner error" role="alert">
            {mensajeError(copiar.error, 'No se pudo copiar la lista')}
          </p>
        )}

        {/* Siempre montada para que el lector de pantalla anuncie el resultado. */}
        <div className={r ? `banner ${r.omitidas.length ? 'aviso' : 'success'}` : 'sr-only'} role="status" aria-live="polite">
          {r && (
            <>
              <p style={{ margin: 0 }}>
                <strong>
                  Se copiaron {r.copiadas} pareja(s) al {hacia}.
                </strong>
                {r.omitidas.length > 0 && ` No se copiaron ${r.omitidas.length}:`}
              </p>
              {r.omitidas.length > 0 && (
                <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
                  {r.omitidas.map((o) => (
                    <li key={o.pareja}>
                      {o.pareja}: {o.motivo}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={copiar.isPending}>
            {r ? 'Cerrar' : 'Cancelar'}
          </button>
          {r ? (
            <button type="button" className="btn" onClick={() => onVerDia(hacia)}>
              Ver la lista del {hacia}
            </button>
          ) : (
            <button type="submit" className="btn" disabled={!puedeCopiar}>
              {copiar.isPending ? 'Copiando…' : 'Copiar'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
