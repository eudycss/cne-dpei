import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { sileo } from 'sileo';
import type { Kit } from '@cne/shared-types';
import { Modal } from '../../components/Modal';
import { regenerarCodigoKit } from '../../lib/queries/kits';
import { mensajeError } from '../operadores-cda/utils';

/** El QR solo se cambia antes de que el kit salga de la Delegación (cadena de custodia). */
export const puedeQrNuevo = (kit: Kit) => kit.estado === 'EN_BODEGA' || kit.estado === 'ASIGNADO';

const esCongelado = (e: unknown) => isAxiosError(e) && !!(e.response?.data as { frozen?: boolean } | undefined)?.frozen;

/**
 * "Generar QR nuevo": el QR pegado es del recinto y sirve en todos los eventos,
 * así que cambiarlo es una decisión explícita (p. ej. una etiqueta dañada).
 */
export function QrNuevoModal({ kit, onClose, onDone }: { kit: Kit; onClose: () => void; onDone: () => void }) {
  const [justificacion, setJustificacion] = useState('');
  // La API pide motivo con la jornada iniciada: desde ese aviso, el campo es obligatorio.
  const [pideMotivo, setPideMotivo] = useState(false);
  const motivo = justificacion.trim() || undefined;
  const generar = useMutation({
    mutationFn: async () => (await regenerarCodigoKit(kit.id, motivo)).data,
    onSuccess: (nuevo) => {
      sileo.success({ title: 'QR nuevo generado', description: `${kit.nombre}: ${nuevo.codigoUnico}. Imprima y pegue la etiqueta nueva.` });
      onDone();
    },
    onError: (e) => {
      if (esCongelado(e)) setPideMotivo(true);
    },
  });
  const puede = (!pideMotivo || !!motivo) && !generar.isPending;

  return (
    <Modal labelledBy="qr-nuevo-titulo" onClose={onClose} maxWidth={500}>
      <form
        className="login-card"
        style={{ width: '100%', maxWidth: 'none' }}
        aria-busy={generar.isPending}
        onSubmit={(e) => {
          e.preventDefault();
          if (puede) generar.mutate();
        }}
      >
        <h1 id="qr-nuevo-titulo">Generar QR nuevo</h1>
        <p>
          El QR pegado en <strong>{kit.nombre}</strong> (<code>{kit.codigoUnico}</code>) sirve en todos los eventos. Si genera uno nuevo, el
          pegado deja de funcionar desde ahora y en los próximos eventos; los kits de este recinto en otros eventos que aún no salen también
          toman el código nuevo.
        </p>
        <p className="banner aviso">Después imprima la etiqueta nueva (casilla del kit y «PDF QR») y péguela sobre la anterior.</p>
        {pideMotivo && (
          <div className="field">
            <label htmlFor="qr-nuevo-justificacion">Justificación (la jornada ya inició)</label>
            <input
              id="qr-nuevo-justificacion"
              value={justificacion}
              onChange={(e) => setJustificacion(e.target.value)}
              maxLength={500}
              required
              autoFocus
              autoComplete="off"
            />
          </div>
        )}
        {generar.isError && (
          <p className="banner error" role="alert">
            {mensajeError(generar.error, 'No se pudo generar el QR nuevo')}
          </p>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={generar.isPending}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={!puede}>
            {generar.isPending ? 'Generando…' : 'Sí, generar QR nuevo'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
