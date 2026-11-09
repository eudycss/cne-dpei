import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import { Modal } from '../../components/Modal';
import { borrarDiaParejasCda, moverDiaParejasCda } from '../../lib/queries/operadores-cda';
import { mensajeError } from './utils';

/** Refresca la lista y lo que depende de ella (quien va en Parejas está convocado ese día). */
function useRefrescarDias() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['parejas-cda'] });
    qc.invalidateQueries({ queryKey: ['convocatoria-cda'] });
    qc.invalidateQueries({ queryKey: ['asistencia-cda'] });
  };
}

function MoverDiaModal({ dia, onMovido, onClose }: { dia: string; onMovido: (hacia: string) => void; onClose: () => void }) {
  const refrescar = useRefrescarDias();
  const [hacia, setHacia] = useState('');
  const mover = useMutation({
    mutationFn: () => moverDiaParejasCda({ desde: dia, hacia }),
    onSuccess: (r) => {
      refrescar();
      sileo.success({ title: `${r.movidas} pareja(s) movidas al ${hacia}` });
      onMovido(hacia);
      onClose();
    },
  });
  const mismoDia = hacia === dia;
  const puedeMover = /^\d{4}-\d{2}-\d{2}$/.test(hacia) && !mismoDia && !mover.isPending;

  return (
    <Modal labelledBy="mover-dia-titulo" onClose={onClose} maxWidth={480}>
      <form
        className="login-card"
        style={{ width: '100%', maxWidth: 'none' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (puedeMover) mover.mutate();
        }}
        aria-busy={mover.isPending}
      >
        <h1 id="mover-dia-titulo">Cambiar la fecha de la lista</h1>
        <p className="muted">Toda la lista del {dia} pasa al día que elija. Ese día debe estar vacío.</p>
        <div className="field">
          <label htmlFor="mover-dia-fecha">Nueva fecha</label>
          <input
            id="mover-dia-fecha"
            type="date"
            value={hacia}
            onChange={(e) => setHacia(e.target.value)}
            required
            aria-describedby={mismoDia ? 'mover-dia-mismo' : undefined}
          />
          {mismoDia && (
            <p id="mover-dia-mismo" className="muted" style={{ margin: '0.25rem 0 0' }}>
              Elija un día distinto del {dia}.
            </p>
          )}
        </div>
        {mover.isError && (
          <p className="banner error" role="alert">
            {mensajeError(mover.error, 'No se pudo cambiar la fecha')}
          </p>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={mover.isPending}>
            Cancelar
          </button>
          <button type="submit" className="btn" disabled={!puedeMover}>
            {mover.isPending ? 'Cambiando…' : 'Cambiar fecha'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function BorrarDiaModal({ dia, onBorrado, onClose }: { dia: string; onBorrado: () => void; onClose: () => void }) {
  const refrescar = useRefrescarDias();
  const [confirmacion, setConfirmacion] = useState('');
  const borrar = useMutation({
    mutationFn: () => borrarDiaParejasCda(dia),
    onSuccess: () => {
      refrescar();
      sileo.success({ title: `Lista del ${dia} borrada` });
      onBorrado();
      onClose();
    },
  });
  const puedeBorrar = confirmacion.trim() === dia && !borrar.isPending;

  return (
    <Modal labelledBy="borrar-dia-titulo" onClose={onClose} maxWidth={480}>
      <form
        className="login-card"
        style={{ width: '100%', maxWidth: 'none' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (puedeBorrar) borrar.mutate();
        }}
        aria-busy={borrar.isPending}
      >
        <h1 id="borrar-dia-titulo">Borrar la lista del día</h1>
        <p className="muted" id="borrar-dia-texto">
          Se quitan todas las parejas y reservas del {dia}. Esta acción no se puede deshacer y queda en la bitácora.
        </p>
        <div className="field">
          <label htmlFor="borrar-dia-confirmacion">Para confirmar, escriba {dia}</label>
          <input
            id="borrar-dia-confirmacion"
            value={confirmacion}
            onChange={(e) => setConfirmacion(e.target.value)}
            autoComplete="off"
            required
            aria-describedby="borrar-dia-texto"
          />
        </div>
        {borrar.isError && (
          <p className="banner error" role="alert">
            {mensajeError(borrar.error, 'No se pudo borrar la lista')}
          </p>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={borrar.isPending}>
            Cancelar
          </button>
          <button type="submit" className="btn danger" disabled={!puedeBorrar}>
            {borrar.isPending ? 'Borrando…' : 'Borrar lista'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Cambiar la fecha o borrar la lista del día mostrado (solo administrador).
 * El servidor es quien protege las listas con kits o con jornada real; aquí
 * solo se evita ofrecer lo que ya se sabe que va a rechazar.
 */
export function AccionesDiaParejas({
  dia,
  conKit,
  onMovido,
  onBorrado,
}: {
  dia: string;
  /** Alguna pareja del día ya tiene kit. */
  conKit: boolean;
  onMovido: (hacia: string) => void;
  onBorrado: () => void;
}) {
  const [accion, setAccion] = useState<'mover' | 'borrar' | null>(null);
  const cerrar = () => setAccion(null);

  if (conKit) return <p className="muted">Esta lista ya tiene kits asignados: no se puede cambiar de fecha ni borrar.</p>;
  return (
    <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap', margin: '0 0 0.75rem' }}>
      <button type="button" className="ocda-btn-texto" onClick={() => setAccion('mover')}>
        Cambiar fecha
      </button>
      <button type="button" className="ocda-btn-texto peligro" onClick={() => setAccion('borrar')}>
        Borrar lista
      </button>
      {accion === 'mover' && <MoverDiaModal dia={dia} onMovido={onMovido} onClose={cerrar} />}
      {accion === 'borrar' && <BorrarDiaModal dia={dia} onBorrado={onBorrado} onClose={cerrar} />}
    </div>
  );
}
