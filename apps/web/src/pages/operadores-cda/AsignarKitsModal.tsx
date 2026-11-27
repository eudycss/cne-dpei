import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AplicarParejasCdaResult, ParejaCdaFila } from '@cne/shared-types';
import { Modal } from '../../components/Modal';
import { asignarKitsParejasCda } from '../../lib/queries/operadores-cda';
import { mensajeError, portadorDe } from './utils';

/**
 * Parejas por pedido: cada una se asigna en serie en el servidor; en tandas
 * chicas ningún pedido llega al límite de tiempo de la web (45 s) y se ve el avance.
 */
export const TANDA_ASIGNAR_KITS = 20;

/**
 * "Asignar kit" a varias parejas a la vez (todas las sin kit o las elegidas):
 * muestra a quién le queda cada kit, avisa de las parejas sin Android y, con
 * la jornada congelada, pide la justificación. Lo que falle en una pareja se
 * muestra aquí con su motivo; las demás quedan asignadas.
 */
export function AsignarKitsModal({
  dia,
  parejas,
  congelado = false,
  justificacionInicial = '',
  onResultado,
  onClose,
}: {
  dia: string;
  parejas: ParejaCdaFila[];
  congelado?: boolean;
  justificacionInicial?: string;
  onResultado: (r: AplicarParejasCdaResult) => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [justificacion, setJustificacion] = useState(justificacionInicial);
  const motivo = justificacion.trim() || undefined;
  const [avance, setAvance] = useState(0);
  const asignar = useMutation({
    mutationFn: async () => {
      const ids = parejas.map((p) => p.id);
      const total: AplicarParejasCdaResult = { enApp: 0, kitsCreados: 0, sinKit: 0, errores: [] };
      for (let i = 0; i < ids.length; i += TANDA_ASIGNAR_KITS) {
        const r = await asignarKitsParejasCda(dia, ids.slice(i, i + TANDA_ASIGNAR_KITS), motivo);
        total.enApp += r.enApp;
        total.kitsCreados += r.kitsCreados;
        total.sinKit += r.sinKit;
        total.errores.push(...r.errores);
        setAvance(Math.min(i + TANDA_ASIGNAR_KITS, ids.length));
      }
      return total;
    },
    onSuccess: (r) => {
      onResultado(r);
      // Con errores se queda abierto para mostrar cuáles y por qué.
      if (!r.errores.length) onClose();
    },
    // Una tanda rechazada (p. ej. la lista cambió): lo ya asignado queda; hay que recargar para seguir.
    onSettled: () => qc.invalidateQueries({ queryKey: ['parejas-cda'] }),
  });
  const sinAndroid = parejas.filter((p) => portadorDe(p).dispositivo === 'IPHONE');
  const errores = asignar.data?.errores ?? [];
  // Tras un error tampoco se reintenta con la misma lista: puede estar desactualizada.
  const terminado = asignar.isSuccess || asignar.isError;
  const puedeAsignar = parejas.length > 0 && (!congelado || !!motivo) && !asignar.isPending && !terminado;

  return (
    <Modal labelledBy="asignar-kits-titulo" onClose={onClose} maxWidth={620}>
      <form
        className="login-card"
        style={{ width: '100%', maxWidth: 'none' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (puedeAsignar) asignar.mutate();
        }}
        aria-busy={asignar.isPending}
      >
        <h1 id="asignar-kits-titulo">Asignar kit a {parejas.length} pareja(s)</h1>
        <p>
          Cada pareja recibe su kit (uno libre del recinto o uno nuevo con los artículos activos del catálogo) en la app de quien tiene
          Android, y su nombre sale en el QR.
        </p>
        <div className="ocda-tabla" style={{ maxHeight: 260 }} tabIndex={0} role="region" aria-label="Parejas a las que se asignará el kit">
          <table>
            <thead>
              <tr>
                <th scope="col">Recinto</th>
                <th scope="col">Llevará el kit</th>
              </tr>
            </thead>
            <tbody>
              {parejas.map((p) => {
                const portador = portadorDe(p);
                return (
                  <tr key={p.id}>
                    <td>
                      <span className="mono">{p.recinto.codigo}</span> · {p.recinto.nombre}
                    </td>
                    <td>
                      {portador.apellidosNombres}
                      {portador.dispositivo === 'IPHONE' && <span className="ocda-estado aviso" style={{ marginLeft: 6 }}>iPhone</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {sinAndroid.length > 0 && (
          <p className="banner aviso">
            {sinAndroid.length} pareja(s) no tienen a nadie con Android: la APK no se instala en iPhone. Se les asigna el kit igual, pero no se
            podrán rastrear ni marcar en la app.
          </p>
        )}

        {congelado && (
          <div className="field">
            <label htmlFor="asignar-kits-justificacion">Justificación (la jornada ya inició)</label>
            <input
              id="asignar-kits-justificacion"
              value={justificacion}
              onChange={(e) => setJustificacion(e.target.value)}
              maxLength={500}
              required
              aria-describedby="asignar-kits-justificacion-ayuda"
              autoComplete="off"
              disabled={terminado}
            />
            <p id="asignar-kits-justificacion-ayuda" className="muted" style={{ margin: '0.25rem 0 0' }}>
              Obligatoria: queda en la bitácora.
            </p>
          </div>
        )}

        {asignar.isError && (
          <p className="banner error" role="alert">
            {mensajeError(asignar.error, 'No se pudieron asignar los kits')}
            {avance > 0 && ` Se alcanzaron a asignar ${avance} de ${parejas.length}.`} Cierre la ventana para ver la lista actualizada.
          </p>
        )}
        {terminado && errores.length > 0 && (
          <div className="banner error" role="alert">
            <p style={{ margin: 0 }}>
              <strong>
                {asignar.data!.enApp} kit(s) asignado(s) · {errores.length} pareja(s) sin kit:
              </strong>
            </p>
            <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
              {errores.map((e) => (
                <li key={e.pareja}>
                  <strong>{e.pareja}:</strong> {e.error}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button type="button" className="btn secondary" onClick={onClose} disabled={asignar.isPending}>
            {terminado ? 'Cerrar' : 'Cancelar'}
          </button>
          {!terminado && (
            <button
              type="submit"
              className="btn"
              disabled={!puedeAsignar}
              aria-describedby={congelado && !motivo ? 'asignar-kits-justificacion-ayuda' : undefined}
            >
              {asignar.isPending ? `Asignando… ${avance} de ${parejas.length}` : `Asignar ${parejas.length} kit(s)`}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
