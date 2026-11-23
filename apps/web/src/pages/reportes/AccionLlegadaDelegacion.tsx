import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { ReporteNoCdaDetalle } from '@cne/shared-types';
import { api } from '../../lib/api';
import { Modal } from '../../components/Modal';

type Accion = 'marcar' | 'deshacer';

const TEXTO: Record<Accion, { boton: string; titulo: string; confirmar: string; ok: string }> = {
  marcar: {
    boton: 'Marcar llegada',
    titulo: 'Marcar llegada a la Delegación',
    confirmar: 'Sí, llegó',
    ok: 'Llegada registrada',
  },
  deshacer: {
    boton: 'Deshacer',
    titulo: 'Deshacer la llegada',
    confirmar: 'Sí, deshacer',
    ok: 'Llegada deshecha',
  },
};

function mensajeError(e: unknown): string {
  const msg = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof msg === 'string' ? msg : 'No se pudo completar la acción';
}

/**
 * Botón (con confirmación) para marcar o deshacer la llegada a la Delegación de
 * un NO CDA sin CDA. Al terminar se recarga el reporte. El API revisa los permisos.
 */
export function AccionLlegadaDelegacion({ noCda, accion }: { noCda: ReporteNoCdaDetalle; accion: Accion }) {
  const [abierto, setAbierto] = useState(false);
  const queryClient = useQueryClient();
  const texto = TEXTO[accion];
  const tituloId = `llegada-delegacion-${accion}-${noCda.id}`;

  const mutacion = useMutation({
    mutationFn: () => {
      const url = `/tracking/no-cda/${noCda.id}/llegada-delegacion`;
      return accion === 'marcar' ? api.post(url) : api.delete(url);
    },
    onSuccess: async () => {
      setAbierto(false);
      // Primero se recarga el reporte (hora y quién marcó); el aviso va después.
      await queryClient.invalidateQueries({ queryKey: ['reporte-no-cda'] });
      sileo.success({ title: `${texto.ok}: ${noCda.codigoRecinto}` });
    },
    onError: (e) => {
      sileo.error({ title: mensajeError(e) });
      // P. ej. "ya registrada" (otro la marcó antes): se recarga para mostrar el estado real.
      void queryClient.invalidateQueries({ queryKey: ['reporte-no-cda'] });
    },
  });

  return (
    <>
      <button
        type="button"
        className="btn secondary no-print"
        style={{ fontSize: '0.8rem', padding: '0.2rem 0.6rem', marginLeft: '0.5rem', minHeight: 28 }}
        onClick={() => setAbierto(true)}
        aria-label={`${texto.boton}: ${noCda.codigoRecinto} — ${noCda.nombre}`}
      >
        {texto.boton}
      </button>
      {abierto && (
        <Modal labelledBy={tituloId} onClose={() => !mutacion.isPending && setAbierto(false)} maxWidth={480}>
          <div className="login-card" style={{ width: '100%' }}>
            <h1 id={tituloId}>{texto.titulo}</h1>
            <p>
              <strong>
                {noCda.codigoRecinto} — {noCda.nombre}
              </strong>{' '}
              ({noCda.juntas} {noCda.juntas === 1 ? 'junta' : 'juntas'})
            </p>
            <p className="muted">
              {accion === 'marcar'
                ? 'No tiene CDA: entrega sus actas directo en la Delegación. Se registra con la hora actual y su usuario.'
                : 'La llegada vuelve a quedar pendiente. Úselo solo si se marcó por error.'}
            </p>
            <div className="row" style={{ gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn secondary" onClick={() => setAbierto(false)} disabled={mutacion.isPending}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => mutacion.mutate()}
                disabled={mutacion.isPending}
                aria-busy={mutacion.isPending}
              >
                {mutacion.isPending ? 'Guardando…' : texto.confirmar}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
