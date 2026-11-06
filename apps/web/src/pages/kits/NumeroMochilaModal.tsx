import { sileo } from 'sileo';
import type { NumeroMochilaResponse } from '@cne/shared-types';
import { Modal } from '../../components/Modal';
import { FormNumeroMochila, type KitMochila } from './FormNumeroMochila';

/** Aviso común al guardar desde la tabla o desde el escáner. */
export function avisarMochilaGuardada(r: NumeroMochilaResponse, kitNombre: string) {
  sileo.success({
    title: r.numeroMochila === null ? 'N.º de mochila quitado' : `Mochila N.º ${r.numeroMochila} guardada`,
    description: r.quitadoDe ? `Se le quitó al QR ${r.quitadoDe}.` : `${kitNombre} (${r.codigoUnico})`,
  });
}

/**
 * N.º de la mochila física con el QR de este kit (desde la tabla). Es de la
 * mochila, no del evento: se carga una vez y vale en todos los eventos.
 */
export function NumeroMochilaModal({
  kit,
  puedeReemplazar,
  onClose,
  onDone,
}: {
  kit: KitMochila;
  puedeReemplazar: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  return (
    <Modal labelledBy="mochila-titulo" onClose={onClose} maxWidth={460}>
      <div className="login-card" style={{ width: '100%', maxWidth: 'none' }}>
        <h1 id="mochila-titulo">N.º de mochila</h1>
        <p>
          <strong>{kit.nombre}</strong> · QR <code>{kit.codigoUnico}</code>
        </p>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Es el número de la mochila física con este QR: se guarda una vez y sirve en todos los eventos.
        </p>
        <FormNumeroMochila
          kit={kit}
          puedeReemplazar={puedeReemplazar}
          idCampo="mochila-numero"
          onCancelar={onClose}
          onGuardado={(r) => {
            avisarMochilaGuardada(r, kit.nombre);
            onDone();
          }}
        />
      </div>
    </Modal>
  );
}
