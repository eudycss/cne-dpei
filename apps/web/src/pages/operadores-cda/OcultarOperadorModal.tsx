import { useMutation } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { OperadorCda } from '@cne/shared-types';
import { Modal } from '../../components/Modal';
import { cambiarActivoOperadorCda } from '../../lib/queries/operadores-cda';
import { mensajeError } from './utils';

/**
 * Confirma la baja lógica. Se avisa lo que no tiene vuelta atrás: el cron de
 * la madrugada borra la foto de los ocultos (LOPDP) y reactivar no la recupera.
 */
export function OcultarOperadorModal({
  operador: o,
  onClose,
  onHecho,
}: {
  operador: OperadorCda;
  onClose: () => void;
  onHecho: () => void;
}) {
  const ocultar = useMutation({
    mutationFn: () => cambiarActivoOperadorCda(o.id, false),
    onSuccess: () => {
      sileo.success({ title: 'Operador oculto', description: o.apellidosNombres });
      onHecho();
      onClose();
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo ocultar al operador') }),
  });

  return (
    <Modal labelledBy="ocultar-operador-titulo" onClose={onClose}>
      <div className="ocda-modal" aria-busy={ocultar.isPending}>
        <div className="ocda-modal-cabecera">
          <div>
            <h2 id="ocultar-operador-titulo">¿Ocultar a este operador?</h2>
            <p className="muted">{o.apellidosNombres}</p>
          </div>
          <button type="button" className="ocda-modal-cerrar" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>
        <ul className="ocda-aviso-lista">
          <li>Deja de aparecer en Asistencia y en Actas de entrega. Lo ya registrado se conserva.</li>
          <li>Puede reactivarlo cuando quiera desde “Mostrar ocultos”.</li>
          {o.tieneFoto && (
            <li>
              <strong>Su foto se eliminará esta madrugada</strong> (protección de datos). Si lo reactiva después de
              eso, tendrá que enviarle un enlace nuevo para que la vuelva a subir.
            </li>
          )}
        </ul>
        <div className="ocda-modal-acciones">
          <button type="button" className="btn secondary" onClick={onClose} disabled={ocultar.isPending} autoFocus>
            Cancelar
          </button>
          <button type="button" className="btn danger" onClick={() => ocultar.mutate()} disabled={ocultar.isPending}>
            {ocultar.isPending ? 'Ocultando…' : 'Ocultar'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
