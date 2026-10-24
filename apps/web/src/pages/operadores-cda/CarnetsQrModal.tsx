import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { OperadorCda } from '@cne/shared-types';
import { Modal } from '../../components/Modal';
import { useDescargaPdf } from '../../lib/useDescargaPdf';
import { anularCredencialCda, getCredencialesVigentesCda, pedirCarnetsCda } from '../../lib/queries/operadores-cda';
import { hoyEcuador, mensajeError } from './utils';
import { useGrupoCda } from './grupo';

const CLAVE = ['credenciales-cda'];
/** Mismo tope que emitirCarnetsCdaSchema (un PDF de 20 hojas). */
const MAX_CARNETS = 200;

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleDateString('es-EC', { timeZone: 'America/Guayaquil', day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Emisión de carnets QR (solo administrador). Generar el PDF emite carnets
 * nuevos: el código anterior de esas personas deja de servir, por eso se
 * avisa cuántos ya tenían uno. "Anular" es para un carnet perdido.
 */
export function CarnetsQrModal({ operadores, onClose }: { operadores: OperadorCda[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { plural } = useGrupoCda();
  const vigentes = useQuery({ queryKey: CLAVE, queryFn: getCredencialesVigentesCda });
  const emitidoEn = useMemo(
    () => new Map((vigentes.data ?? []).map((v) => [v.operadorId, v.emitidaEn])),
    [vigentes.data],
  );
  // Por defecto, los que aún no tienen carnet (los primeros en imprimirse).
  const [elegidos, setElegidos] = useState<ReadonlySet<string> | null>(null);
  const seleccion = elegidos ?? new Set(operadores.filter((o) => !emitidoEn.has(o.id)).map((o) => o.id));
  const reemplazan = operadores.filter((o) => seleccion.has(o.id) && emitidoEn.has(o.id)).length;
  const { descargando, descargar } = useDescargaPdf('No se pudieron generar los carnets');

  const anular = useMutation({
    mutationFn: (o: OperadorCda) => anularCredencialCda(o.id),
    onSuccess: (_r, o) => {
      sileo.success({ title: 'Carnet anulado', description: o.apellidosNombres });
      qc.invalidateQueries({ queryKey: CLAVE });
    },
    onError: (e) => sileo.error({ title: mensajeError(e, 'No se pudo anular el carnet') }),
  });

  const alternar = (id: string) =>
    setElegidos(() => {
      const s = new Set(seleccion);
      if (s.has(id)) s.delete(id);
      else s.add(id);
      return s;
    });

  async function generar(e: FormEvent) {
    e.preventDefault();
    const ids = operadores.filter((o) => seleccion.has(o.id)).map((o) => o.id);
    if (ids.length === 0 || ids.length > MAX_CARNETS) return;
    // Reimprimir anula el carnet que la persona ya tiene: se confirma (también si llegó con Enter).
    if (
      reemplazan > 0 &&
      !window.confirm(
        `${reemplazan === 1 ? '1 persona ya tiene' : `${reemplazan} personas ya tienen`} carnet. ` +
          'Al generar, su carnet actual deja de registrar asistencia. ¿Continuar?',
      )
    ) {
      return;
    }
    await descargar('carnets', () => pedirCarnetsCda(ids), `carnets_cda_${hoyEcuador()}.pdf`);
    qc.invalidateQueries({ queryKey: CLAVE });
  }

  function confirmarAnular(o: OperadorCda) {
    if (window.confirm(`¿Anular el carnet de ${o.apellidosNombres}? Su código dejará de registrar asistencia.`)) {
      anular.mutate(o);
    }
  }

  const ocupado = descargando !== null;

  return (
    <Modal labelledBy="carnets-qr-titulo" onClose={onClose} maxWidth={640}>
      <form className="ocda-modal" onSubmit={generar} aria-busy={ocupado || vigentes.isLoading}>
        <div className="ocda-modal-cabecera">
          <span className="ocda-modal-icono" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 5h18v14H3zM7 9h4v6H7zM14 10h4M14 14h3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <h2 id="carnets-qr-titulo">Carnets QR</h2>
            <p className="muted">PDF tamaño tarjeta, 10 por hoja, para imprimir y recortar.</p>
          </div>
          <button type="button" className="ocda-modal-cerrar" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {vigentes.error && (
          <div className="banner error" role="alert">
            No se pudo saber quién ya tiene carnet.
          </div>
        )}
        {reemplazan > 0 && (
          <div className="banner" role="status">
            {reemplazan === 1 ? '1 persona elegida ya tiene carnet' : `${reemplazan} personas elegidas ya tienen carnet`}: al
            generar, su carnet anterior deja de funcionar.
          </div>
        )}

        <div className="ocda-modal-acciones" style={{ justifyContent: 'flex-start' }}>
          <button type="button" className="ocda-btn-texto" onClick={() => setElegidos(new Set(operadores.map((o) => o.id)))}>
            Elegir todos
          </button>
          <button
            type="button"
            className="ocda-btn-texto"
            onClick={() => setElegidos(new Set(operadores.filter((o) => !emitidoEn.has(o.id)).map((o) => o.id)))}
          >
            Solo sin carnet
          </button>
          <button type="button" className="ocda-btn-texto" onClick={() => setElegidos(new Set())}>
            Ninguno
          </button>
        </div>

        <fieldset className="ocda-carnets-lista">
          <legend className="sr-only">{plural[0].toUpperCase() + plural.slice(1)} para imprimir carnet</legend>
          {operadores.map((o) => {
            const emitido = emitidoEn.get(o.id);
            return (
              <div key={o.id} className="ocda-carnets-fila">
                <label>
                  <input type="checkbox" checked={seleccion.has(o.id)} onChange={() => alternar(o.id)} />
                  <span>{o.apellidosNombres}</span>
                </label>
                <span className="ocda-form-ayuda">{emitido ? `Carnet del ${fechaCorta(emitido)}` : 'Sin carnet'}</span>
                {emitido && (
                  <button
                    type="button"
                    className="ocda-btn-texto peligro"
                    onClick={() => confirmarAnular(o)}
                    disabled={anular.isPending}
                    aria-label={`Anular carnet de ${o.apellidosNombres}`}
                  >
                    Anular
                  </button>
                )}
              </div>
            );
          })}
        </fieldset>

        {seleccion.size > MAX_CARNETS && (
          <div className="banner error" role="alert">
            Se pueden generar hasta {MAX_CARNETS} carnets a la vez; elija menos personas.
          </div>
        )}
        <p role="status" className="sr-only">
          {ocupado ? 'Generando carnets…' : ''}
        </p>
        <div className="ocda-modal-acciones">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cerrar
          </button>
          <button type="submit" className="btn" disabled={ocupado || seleccion.size === 0 || seleccion.size > MAX_CARNETS || vigentes.isLoading}>
            {ocupado ? 'Generando…' : `Generar ${seleccion.size} carnet${seleccion.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
