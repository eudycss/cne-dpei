import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { AnalisisCertificadoEvatics, DecisionEvatics, FilaEvatics } from '@cne/shared-types';
import { revisarEvaticsSchema } from '@cne/shared-validation';
import { Modal } from '../../components/Modal';
import { getFotoEvatics, revisarEvatics } from '../../lib/queries/evatics';
import { mensajeError } from './utils';

const estadoHttp = (e: unknown) => (e as { response?: { status?: number } })?.response?.status;

/** Lo que sugirió la IA, en palabras. Nunca decide: lo dice la propia pantalla. */
export function sugerenciaIa(a: AnalisisCertificadoEvatics | null): { texto: string; clase: string } {
  if (!a || a.estado === 'EN_COLA') return { texto: 'Aún sin leer', clase: 'vacio' };
  if (a.estado === 'NO_DISPONIBLE') return { texto: 'Sin IA', clase: 'vacio' };
  if (a.esCertificado === false) return { texto: 'No parece un certificado', clase: 'error' };
  if (a.legible === false) return { texto: 'No se lee bien', clase: 'aviso' };
  if (a.nombreCoincide === true) return { texto: 'El nombre coincide', clase: 'ok' };
  if (a.nombreCoincide === false) return { texto: 'El nombre no coincide', clase: 'error' };
  return { texto: 'No se leyó el nombre', clase: 'aviso' };
}

/** URL local (blob:) de la foto; se libera al cambiar o cerrar. */
function useFotoUrl(fila: FilaEvatics, anterior: boolean) {
  const version = anterior ? fila.fotoAnteriorSubidaEn : fila.subidoEn;
  const q = useQuery({
    queryKey: ['evatics-foto', fila.certificadoId, version, anterior],
    queryFn: () => getFotoEvatics(fila.certificadoId as string, version as string, anterior),
    enabled: Boolean(fila.certificadoId && version),
    staleTime: Infinity,
    retry: false,
  });
  // Derivada (no en estado): al alternar actual/anterior nunca se pinta una URL ya revocada.
  const url = useMemo(() => (q.data ? URL.createObjectURL(q.data) : null), [q.data]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  return { url, cargando: q.isLoading, error: q.error };
}

/**
 * Foto del certificado con la sugerencia de la IA y la decisión del
 * supervisor. Si la persona subió otra foto mientras tanto (409), se cierra y
 * se recarga el listado: nunca se decide sobre una foto que no se vio.
 */
export function RevisarEvaticsModal({ fila, onClose }: { fila: FilaEvatics; onClose: () => void }) {
  const qc = useQueryClient();
  const [anterior, setAnterior] = useState(false);
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [errorMotivo, setErrorMotivo] = useState<string | null>(null);
  const foto = useFotoUrl(fila, anterior);
  const ia = sugerenciaIa(fila.analisis);
  // Aprobar o rechazar solo con la foto actual en pantalla: nunca sobre una que no se vio.
  const sinFotoActual = !foto.url || anterior;

  function fotoCambio() {
    sileo.error({ title: 'La persona subió otra foto: ábrala de nuevo para revisarla' });
    void qc.invalidateQueries({ queryKey: ['evatics'] });
    onClose();
  }
  useEffect(() => {
    if (estadoHttp(foto.error) === 409) fotoCambio();
  }, [foto.error]);

  const revisar = useMutation({
    mutationFn: (decision: DecisionEvatics) =>
      revisarEvatics(fila.certificadoId as string, {
        decision,
        subidoEn: fila.subidoEn as string,
        ...(decision === 'RECHAZADO' ? { motivo: motivo.trim() } : {}),
      }),
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['evatics'] });
      sileo.success({
        title: `${fila.apellidosNombres}: certificado ${r.estado === 'APROBADO' ? 'aprobado' : 'rechazado'}`,
      });
      onClose();
    },
    onError: (e) => {
      if (estadoHttp(e) === 409) fotoCambio();
      else sileo.error({ title: mensajeError(e, 'No se pudo guardar la revisión') });
    },
  });

  function rechazar() {
    const r = revisarEvaticsSchema.safeParse({ decision: 'RECHAZADO', motivo, subidoEn: fila.subidoEn });
    const issue = r.success ? null : r.error.issues.find((i) => i.path[0] === 'motivo');
    if (issue) {
      setErrorMotivo(issue.message);
      document.getElementById('evx-motivo')?.focus();
      return;
    }
    setErrorMotivo(null);
    revisar.mutate('RECHAZADO');
  }

  const a = fila.analisis;
  return (
    <Modal labelledBy="evx-revisar-titulo" onClose={onClose} maxWidth={760}>
      <div className="ocda-modal" aria-busy={revisar.isPending}>
        <div className="ocda-modal-cabecera">
          <div>
            <h2 id="evx-revisar-titulo">{fila.apellidosNombres}</h2>
            <p className="muted">
              {fila.cargo} · {fila.canton} · C.I. <span className="mono">{fila.cedula}</span>
            </p>
          </div>
          <button type="button" className="ocda-modal-cerrar" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {fila.tieneFotoAnterior && fila.fotoAnteriorSubidaEn && (
          <div className="ocda-filtros" role="group" aria-label="Foto que se muestra" style={{ margin: 0 }}>
            {[false, true].map((v) => (
              <button
                key={String(v)}
                type="button"
                className="ocda-chip"
                aria-pressed={anterior === v}
                onClick={() => setAnterior(v)}
              >
                {anterior === v && <span aria-hidden="true">✓ </span>}
                {v ? 'Foto anterior' : 'Foto actual'}
              </button>
            ))}
          </div>
        )}

        <div className="evx-foto">
          {foto.url ? (
            <a href={foto.url} target="_blank" rel="noopener noreferrer" title="Abrir en tamaño completo">
              <img src={foto.url} alt={`Certificado de ${fila.apellidosNombres}${anterior ? ' (foto anterior)' : ''}`} />
            </a>
          ) : foto.error && estadoHttp(foto.error) !== 409 ? (
            <p className="banner error" role="alert">
              {mensajeError(foto.error, 'No se pudo abrir la foto.')}
            </p>
          ) : (
            <p className="muted" role="status">
              Abriendo la foto…
            </p>
          )}
        </div>

        <dl className="evx-ia">
          <div>
            <dt>Sugerencia de la IA</dt>
            <dd>
              <span className={`ocda-estado ${ia.clase}`}>{ia.texto}</span>
            </dd>
          </div>
          {a?.estado === 'LISTO' && (
            <div>
              <dt>Nombre que leyó</dt>
              <dd>{a.nombreLeido ?? '—'}</dd>
            </div>
          )}
          {a?.proveedor && (
            <div>
              <dt>Leído por</dt>
              <dd>{a.proveedor}</dd>
            </div>
          )}
        </dl>
        <p className="ocda-enlace-aviso">
          La IA solo sugiere: compare usted el nombre del certificado con el de la persona antes de decidir.
        </p>

        {fila.esPropio ? (
          <div className="banner" role="status">
            Es su propio certificado: lo revisa otro supervisor.
          </div>
        ) : rechazando ? (
          <div className="ocda-form">
            <div className="ocda-form-campo ancho">
              <label htmlFor="evx-motivo">Motivo del rechazo (la persona lo verá)</label>
              <textarea
                id="evx-motivo"
                rows={3}
                maxLength={300}
                value={motivo}
                autoFocus
                aria-required="true"
                aria-invalid={errorMotivo ? true : undefined}
                aria-describedby={errorMotivo ? 'evx-motivo-error' : undefined}
                onChange={(e) => setMotivo(e.target.value)}
              />
              {errorMotivo && (
                <span id="evx-motivo-error" className="ocda-form-error">
                  {errorMotivo}
                </span>
              )}
            </div>
          </div>
        ) : null}

        {!fila.esPropio && (
          <div className="ocda-modal-acciones">
            {rechazando ? (
              <>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setRechazando(false)}
                  disabled={revisar.isPending}
                >
                  Volver
                </button>
                <button
                  type="button"
                  className="btn danger"
                  onClick={rechazar}
                  disabled={revisar.isPending || sinFotoActual}
                >
                  {revisar.isPending ? 'Guardando…' : 'Rechazar certificado'}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => setRechazando(true)}
                  disabled={revisar.isPending || sinFotoActual}
                >
                  Rechazar…
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => revisar.mutate('APROBADO')}
                  disabled={revisar.isPending || sinFotoActual}
                >
                  {revisar.isPending ? 'Guardando…' : 'Aprobar'}
                </button>
              </>
            )}
          </div>
        )}
        {anterior && !fila.esPropio && (
          <p className="ocda-pie">Para decidir, vuelva a la foto actual.</p>
        )}
      </div>
    </Modal>
  );
}
