import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { AccionSyncRecinto, CambioSyncRecinto } from '@cne/shared-types';
import { aplicarSyncRecintos, getPreviewSyncRecintos } from '../../lib/queries/recintos-sync';

interface Props {
  onClose: () => void;
}

const GRUPOS: { accion: AccionSyncRecinto; titulo: string }[] = [
  { accion: 'CREAR', titulo: 'Recintos nuevos' },
  { accion: 'ACTUALIZAR', titulo: 'Recintos que cambian' },
  { accion: 'REACTIVAR', titulo: 'Vuelven a aparecer' },
  { accion: 'OCULTAR', titulo: 'Se ocultan (ya no están en el Sheet; se conserva su historial)' },
];

/**
 * Vista previa de lo que cambiaría al sincronizar los recintos con el Google
 * Sheet. Nada se escribe hasta que el administrador pulsa "Aplicar cambios".
 */
export function SyncRecintosModal({ onClose }: Props) {
  const qc = useQueryClient();
  const dialogoRef = useRef<HTMLDivElement>(null);
  const cerrarRef = useRef<HTMLButtonElement>(null);
  // En un ref: el padre pasa una función nueva en cada render y no debe re-enfocar el modal.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const ocupadoRef = useRef(false);
  const cerrar = () => {
    if (!ocupadoRef.current) onCloseRef.current();
  };

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    cerrarRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (!ocupadoRef.current) onCloseRef.current();
        return;
      }
      if (e.key === 'Tab') atraparFoco(e, dialogoRef.current);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      anterior?.focus?.();
    };
  }, []);

  // Sin caché: cada vez que se abre debe reflejar el Sheet tal como está ahora.
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['recintos-sync-preview'],
    queryFn: getPreviewSyncRecintos,
    gcTime: 0,
    retry: false,
  });

  const aplicar = useMutation({
    mutationFn: aplicarSyncRecintos,
    onSuccess: ({ creados, actualizados, ocultados, errores }) => {
      qc.invalidateQueries({ queryKey: ['recintos'] });
      qc.invalidateQueries({ queryKey: ['recintos-origenes'] });
      sileo[errores.length > 0 ? 'warning' : 'success']({
        title: `Sincronización aplicada: ${creados} nuevo(s), ${actualizados} actualizado(s), ${ocultados} oculto(s).`,
        description: errores.length > 0 ? `${errores.length} recinto(s) se omitieron por errores.` : undefined,
      });
      onCloseRef.current();
    },
    onError: (e: any) => {
      sileo.error({ title: e?.response?.data?.message ?? 'No se pudo aplicar la sincronización' });
    },
  });

  ocupadoRef.current = aplicar.isPending;
  const cambios = data?.cambios ?? [];
  const ocultos = cambios.filter((c) => c.accion === 'OCULTAR').length;
  const puedeAplicar =
    !!data && !data.congelado && !data.ocultamientoMasivo && cambios.length > 0 && !aplicar.isPending && !isFetching;

  function confirmarYAplicar() {
    const mensaje = `Se ocultarán ${ocultos} recinto(s) que ya no están en el Google Sheet. ¿Continuar?`;
    if (ocultos > 0 && !window.confirm(mensaje)) return;
    aplicar.mutate();
  }

  return (
    <div
      className="center"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10, padding: '1rem' }}
      onClick={cerrar}
    >
      <div
        ref={dialogoRef}
        className="login-card"
        style={{ maxWidth: 760, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-recintos-titulo"
        aria-busy={isLoading || aplicar.isPending}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="sync-recintos-titulo">Sincronizar con Google Sheet</h2>
        <p className="muted">
          NO CDA desde “Hoja1” y CDA desde “INFORMACION.TOTAL-CDAS”. Revise los cambios antes de aplicarlos.
        </p>

        {isLoading && <p role="status">Leyendo el Google Sheet…</p>}

        {error && (
          <div className="banner error" role="alert">
            {(error as any)?.response?.data?.message ?? 'No se pudo leer el Google Sheet.'}
          </div>
        )}

        {data && (
          <>
            <p role="status">
              Leídos <strong>{data.leidos.cda}</strong> CDA y <strong>{data.leidos.noCda}</strong> NO CDA ·{' '}
              <strong>{cambios.length}</strong> con cambios · {data.sinCambios} sin cambios
              {data.errores.length > 0 && (
                <>
                  {' '}· <strong>{data.errores.length}</strong> con errores
                </>
              )}
            </p>

            {data.congelado && (
              <div className="banner" role="alert">
                La jornada electoral ya inició: puede revisar los cambios, pero no aplicarlos hasta cerrar el evento.
              </div>
            )}

            {data.ocultamientoMasivo && (
              <div className="banner error" role="alert">
                Se ocultarían {ocultos} recintos de una vez. Revise que el Google Sheet esté completo (hojas y
                columnas) antes de sincronizar.
              </div>
            )}

            {data.errores.length > 0 && (
              <section aria-labelledby="sync-errores">
                <h3 id="sync-errores" style={{ fontSize: '1rem' }}>
                  No se cambiarán ({data.errores.length})
                </h3>
                <div className="banner error">
                  <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
                    {data.errores.map((e) => (
                      <li key={e.codigoRecinto}>
                        <strong>{e.codigoRecinto}</strong> {e.nombre}: {e.error}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {cambios.length === 0 && data.errores.length === 0 && (
              <div className="banner success">El sistema ya coincide con el Google Sheet.</div>
            )}

            {GRUPOS.map(({ accion, titulo }) => {
              const grupo = cambios.filter((c) => c.accion === accion);
              if (grupo.length === 0) return null;
              return (
                <section key={accion} aria-labelledby={`sync-${accion}`}>
                  <h3 id={`sync-${accion}`} style={{ fontSize: '1rem' }}>
                    {titulo} ({grupo.length})
                  </h3>
                  <ul style={{ paddingLeft: '1.1rem' }}>
                    {grupo.map((c) => (
                      <CambioItem key={c.codigoRecinto} cambio={c} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
          <button ref={cerrarRef} className="btn secondary" onClick={cerrar} disabled={aplicar.isPending}>
            Cancelar
          </button>
          <button className="btn secondary" onClick={() => refetch()} disabled={isFetching || aplicar.isPending}>
            {isFetching && !isLoading ? 'Leyendo…' : 'Volver a leer'}
          </button>
          <button className="btn" onClick={confirmarYAplicar} disabled={!puedeAplicar}>
            {aplicar.isPending ? 'Aplicando…' : `Aplicar cambios (${cambios.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}

function CambioItem({ cambio }: { cambio: CambioSyncRecinto }) {
  return (
    <li style={{ marginBottom: '0.5rem' }}>
      <strong>{cambio.codigoRecinto}</strong> {cambio.nombre}
      {cambio.cambios.length > 0 && (
        <ul className="muted" style={{ paddingLeft: '1.1rem', margin: '0.15rem 0 0' }}>
          {cambio.cambios.map((c) => (
            <li key={c.campo}>
              {c.campo}: <span>{c.antes}</span> <span aria-hidden="true">→</span>
              <span className="sr-only"> pasa a </span> <strong>{c.despues}</strong>
            </li>
          ))}
        </ul>
      )}
      {cambio.nota && (
        <p className="muted" style={{ margin: '0.15rem 0 0' }}>
          {cambio.nota}
        </p>
      )}
    </li>
  );
}

/** Mantiene Tab y Shift+Tab dentro del diálogo (WCAG 2.4.3). */
function atraparFoco(e: KeyboardEvent, dialogo: HTMLElement | null) {
  if (!dialogo) return;
  const enfocables = Array.from(
    dialogo.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'),
  );
  if (enfocables.length === 0) return;
  const primero = enfocables[0];
  const ultimo = enfocables[enfocables.length - 1];
  if (e.shiftKey && document.activeElement === primero) {
    e.preventDefault();
    ultimo.focus();
  } else if (!e.shiftKey && document.activeElement === ultimo) {
    e.preventDefault();
    primero.focus();
  }
}
