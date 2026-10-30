import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AplicarParejasCdaResult, ParejaCdaFila } from '@cne/shared-types';
import { Modal } from '../../components/Modal';
import { asignarKitParejaCda } from '../../lib/queries/operadores-cda';
import { mensajeError } from './utils';

/**
 * Botón "Asignar kit" de una fila "Sin kit": el kit del recinto pasa al
 * operador de la pareja (o se crea con los artículos por defecto). Si algo
 * falla (p. ej. la persona no es Operador CDA), el motivo queda aquí.
 */
export function AsignarKitModal({
  pareja,
  congelado = false,
  justificacionInicial = '',
  onResultado,
  onClose,
}: {
  pareja: ParejaCdaFila;
  congelado?: boolean;
  justificacionInicial?: string;
  onResultado: (r: AplicarParejasCdaResult) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [justificacion, setJustificacion] = useState(justificacionInicial);
  const motivo = justificacion.trim() || undefined;
  const asignar = useMutation({
    mutationFn: () => asignarKitParejaCda(pareja.id, motivo),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['parejas-cda'] });
      // Con error se queda abierto para mostrar el motivo.
      if (!r.errores.length) {
        onResultado(r);
        onClose();
      }
    },
  });
  const errores = asignar.data?.errores ?? [];
  const iphone = pareja.operador.dispositivo === 'IPHONE';
  const puedeAsignar = (!congelado || !!motivo) && !asignar.isPending;

  return (
    <Modal labelledBy="asignar-kit-titulo" onClose={onClose} maxWidth={520}>
      <form
        className="login-card"
        style={{ width: '100%', maxWidth: 'none' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (puedeAsignar) asignar.mutate();
        }}
        aria-busy={asignar.isPending}
      >
        <h1 id="asignar-kit-titulo">Asignar kit</h1>
        <p>
          El kit del recinto <strong>{`${pareja.recinto.codigo} · ${pareja.recinto.nombre}`}</strong> quedará en la app de{' '}
          <strong>{pareja.operador.apellidosNombres}</strong>. Si el recinto aún no tiene kit, se crea con los artículos activos
          del catálogo.
        </p>
        {iphone && (
          <p className="banner aviso">
            {pareja.operador.apellidosNombres} usa iPhone: la APK no se instala ahí. Puede asignarle el kit igual, pero no podrá
            marcar en la app; considere cambiar el operador.
          </p>
        )}

        {congelado && (
          <div className="field">
            <label htmlFor="asignar-kit-justificacion">Justificación (la jornada ya inició)</label>
            <input
              id="asignar-kit-justificacion"
              value={justificacion}
              onChange={(e) => setJustificacion(e.target.value)}
              maxLength={500}
              required
              aria-describedby="asignar-kit-justificacion-ayuda"
              autoComplete="off"
            />
            <p id="asignar-kit-justificacion-ayuda" className="muted" style={{ margin: '0.25rem 0 0' }}>
              Obligatoria: queda en la bitácora.
            </p>
          </div>
        )}

        {asignar.isError && (
          <p className="banner error" role="alert">
            {mensajeError(asignar.error, 'No se pudo asignar el kit')}
          </p>
        )}
        {errores.length > 0 && (
          <div className="banner error" role="alert">
            <p style={{ margin: 0 }}>
              <strong>No se asignó el kit:</strong>
            </p>
            <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
              {errores.map((e) => (
                <li key={e.pareja}>{e.error}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={asignar.isPending}>
            {errores.length ? 'Cerrar' : 'Cancelar'}
          </button>
          <button
            type="submit"
            className="btn"
            disabled={!puedeAsignar}
            aria-describedby={congelado && !motivo ? 'asignar-kit-justificacion-ayuda' : undefined}
          >
            {asignar.isPending ? 'Asignando…' : 'Asignar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
