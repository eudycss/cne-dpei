import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { OperadorCda } from '@cne/shared-types';
import { Modal } from '../../components/Modal';
import { getFotoPendienteOperadorCda, revisarFotoPendienteCda } from '../../lib/queries/operadores-cda';
import { useFotoOperadorUrl } from './useFotoOperador';
import { cargoCorto, mensajeError } from './utils';

/** URL local (blob:) de la foto nueva por revisar. Sin caché: cambia si la persona sube otra. */
function useFotoPendienteUrl(operadorId: string): { url: string | null; error: boolean } {
  const { data, isError } = useQuery({
    queryKey: ['operadores-cda', operadorId, 'foto-pendiente'],
    queryFn: () => getFotoPendienteOperadorCda(operadorId),
    gcTime: 0,
    retry: false,
  });
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!data) return setUrl(null);
    const u = URL.createObjectURL(data);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [data]);
  return { url, error: isError };
}

/**
 * La foto actual y la nueva lado a lado. Aprobar: la nueva pasa a la
 * credencial. Rechazar: se descarta y queda la actual.
 */
export function RevisarFotoModal({
  operador: o,
  onClose,
  onRevisada,
}: {
  operador: OperadorCda;
  onClose: () => void;
  onRevisada: () => void;
}) {
  const qc = useQueryClient();
  const actual = useFotoOperadorUrl(o);
  const nueva = useFotoPendienteUrl(o.id);
  const revisar = useMutation({
    mutationFn: (decision: 'aprobar' | 'rechazar') => revisarFotoPendienteCda(o.id, decision),
    onSuccess: (_r, decision) => {
      // La foto de la tarjeta cambia al aprobar: se vuelve a pedir.
      qc.removeQueries({ queryKey: ['operadores-cda', o.id, 'foto'] });
      sileo.success({
        title: decision === 'aprobar' ? 'Foto nueva aprobada' : 'Foto nueva rechazada',
        description: o.apellidosNombres,
      });
      onRevisada();
      onClose();
    },
    // 409: la persona subió otra mientras se revisaba; se muestra la nueva.
    onError: () => void qc.invalidateQueries({ queryKey: ['operadores-cda', o.id, 'foto-pendiente'] }),
  });
  const id = `revisar-foto-${o.id}`;

  // Al body: la tarjeta animada (transform) encerraría el fondo fijo del modal.
  return createPortal(
    <Modal labelledBy={id} onClose={onClose} maxWidth={720}>
      <div className="ocda-modal" aria-busy={revisar.isPending}>
        <div className="ocda-modal-cabecera">
          <div>
            <h2 id={id}>Revisar foto nueva</h2>
            <p className="muted">
              {o.apellidosNombres} · <span className="mono">{o.cedula}</span> · {cargoCorto(o.cargo)}
            </p>
          </div>
          <button type="button" className="ocda-modal-cerrar" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        <div className="ocda-revisar-fotos">
          <figure>
            <figcaption>Actual (en la credencial)</figcaption>
            {actual ? <img src={actual} alt={`Foto actual de ${o.apellidosNombres}`} /> : <p className="muted">Cargando…</p>}
          </figure>
          <figure>
            <figcaption>Nueva (por revisar)</figcaption>
            {nueva.url ? (
              <img src={nueva.url} alt={`Foto nueva de ${o.apellidosNombres}`} />
            ) : (
              <p className="muted">{nueva.error ? 'No se pudo cargar la foto nueva.' : 'Cargando…'}</p>
            )}
          </figure>
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Revise que sea la misma persona y que la foto sirva para la credencial. Al aprobar, la anterior se borra.
        </p>

        {revisar.isError && (
          <div className="banner error" role="alert">
            {mensajeError(revisar.error, 'No se pudo guardar la revisión. Intente de nuevo.')}
          </div>
        )}
        <div className="ocda-modal-acciones">
          <button
            type="button"
            className="btn secondary"
            disabled={revisar.isPending}
            onClick={() => revisar.mutate('rechazar')}
          >
            Rechazar
          </button>
          <button
            type="button"
            className="btn"
            disabled={revisar.isPending || !nueva.url}
            onClick={() => revisar.mutate('aprobar')}
          >
            {revisar.isPending ? 'Guardando…' : 'Aprobar foto nueva'}
          </button>
        </div>
      </div>
    </Modal>,
    document.body,
  );
}
