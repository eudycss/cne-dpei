import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { NumeroMochilaRequest, NumeroMochilaResponse } from '@cne/shared-types';
import { leerNumeroMochila } from '@cne/shared-validation';
import { guardarNumeroMochila } from '../../lib/queries/kits';
import { mensajeError } from '../operadores-cda/utils';

/** Lo que el formulario necesita del kit (de la tabla o de un QR escaneado). */
export interface KitMochila {
  id: string;
  nombre: string;
  codigoUnico: string;
  numeroMochila?: number | null;
}

/** El número ya es de otro QR: la API dice cuál. */
function enOtroQr(e: unknown): string | null {
  if (!isAxiosError(e) || e.response?.status !== 409) return null;
  const data = e.response.data as { codigo?: string; message?: string } | undefined;
  return data?.codigo === 'MOCHILA_EN_OTRO_QR' ? data.message ?? 'Ese N.º ya es de otro QR.' : null;
}

/**
 * Campo del N.º de mochila con Guardar y Quitar. Si el número ya es de otro QR
 * lo explica; solo con `puedeReemplazar` (administrador) ofrece pasárselo a este.
 */
export function FormNumeroMochila({
  kit,
  puedeReemplazar,
  idCampo,
  autoFocus = true,
  onGuardado,
  onCancelar,
}: {
  kit: KitMochila;
  puedeReemplazar: boolean;
  idCampo: string;
  autoFocus?: boolean;
  onGuardado: (r: NumeroMochilaResponse) => void;
  onCancelar: () => void;
}) {
  const actual = kit.numeroMochila ?? null;
  const [texto, setTexto] = useState(actual !== null ? String(actual) : '');
  const [conflicto, setConflicto] = useState<string | null>(null);
  const numero = leerNumeroMochila(texto);
  const invalido = texto.trim() !== '' && numero === null;

  const guardar = useMutation({
    mutationFn: async (body: NumeroMochilaRequest) => (await guardarNumeroMochila(kit.id, body)).data,
    onSuccess: onGuardado,
    onError: (e) => setConflicto(enOtroQr(e)),
  });
  const ocupado = guardar.isPending;

  return (
    <form
      aria-busy={ocupado}
      onSubmit={(e) => {
        e.preventDefault();
        if (numero !== null && !ocupado) guardar.mutate({ numero });
      }}
    >
      <div className="field">
        <label htmlFor={idCampo}>N.º de mochila (1 a 9999)</label>
        <input
          id={idCampo}
          inputMode="numeric"
          autoComplete="off"
          autoFocus={autoFocus}
          maxLength={12}
          value={texto}
          aria-invalid={invalido}
          aria-describedby={invalido ? `${idCampo}-error` : undefined}
          onChange={(e) => {
            setTexto(e.target.value);
            setConflicto(null);
            guardar.reset();
          }}
        />
        {invalido && (
          <p id={`${idCampo}-error`} className="error" role="alert" style={{ margin: '0.3rem 0 0' }}>
            Escriba un número de 1 a 9999.
          </p>
        )}
      </div>

      {conflicto ? (
        <div className="banner aviso" role="alert">
          <p style={{ margin: 0 }}>{conflicto}</p>
          {puedeReemplazar && (
            <>
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
            </>
          )}
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
          {actual !== null && (
            <button
              type="button"
              className="btn secondary"
              disabled={ocupado}
              onClick={() => {
                if (window.confirm(`¿Quitar el N.º ${actual} de esta mochila?`)) guardar.mutate({ numero: null });
              }}
            >
              Quitar número
            </button>
          )}
        </div>
        <div className="row" style={{ gap: '0.5rem' }}>
          <button type="button" className="btn secondary" onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={numero === null || numero === actual || ocupado}>
            {ocupado ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </form>
  );
}
