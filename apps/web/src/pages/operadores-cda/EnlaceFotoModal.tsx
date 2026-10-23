import { useState } from 'react';
import type { EnlaceFotoCdaCreado, OperadorCda } from '@cne/shared-types';
import { Modal } from '../../components/Modal';
import { crearEnlaceFotoCda, urlEnlaceFotoCda } from '../../lib/queries/operadores-cda';
import { numeroWhatsApp, partirNombre } from './utils';

function mensajeDe(e: unknown, porDefecto: string): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? porDefecto;
}

function venceEl(iso: string): string {
  return new Date(iso).toLocaleString('es-EC', {
    timeZone: 'America/Guayaquil',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

/**
 * Genera el enlace personal de foto y lo deja listo para copiar o enviar por
 * WhatsApp (diseño 02 de Figma). Solo se genera al pulsar el botón: abrir la
 * ventana no anula un enlace que ya se envió.
 */
export function EnlaceFotoModal({ operador, onClose }: { operador: OperadorCda; onClose: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const [enlace, setEnlace] = useState<EnlaceFotoCdaCreado | null>(null);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generar() {
    setGenerando(true);
    setError(null);
    setCopiado(false);
    try {
      setEnlace(await crearEnlaceFotoCda(operador.id));
    } catch (e) {
      setEnlace(null);
      setError(mensajeDe(e, 'No se pudo generar el enlace. Intente de nuevo.'));
    } finally {
      setGenerando(false);
    }
  }

  const url = enlace ? urlEnlaceFotoCda(enlace.token) : null;
  const numero = numeroWhatsApp(operador.telefono);
  const nombre = partirNombre(operador.apellidosNombres).nombres.split(' ')[0] || operador.apellidosNombres;
  const whatsapp =
    url && enlace
      ? `https://wa.me/${numero ?? ''}?text=${encodeURIComponent(
          `Hola ${nombre}, para su credencial de Operador CDA del CNE Imbabura suba su foto en este enlace personal ` +
            `(vence el ${venceEl(enlace.expiraEn)}): ${url}`,
        )}`
      : null;

  async function copiar() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <Modal labelledBy="enlace-foto-titulo" onClose={onClose} maxWidth={520}>
      <div className="ocda-modal" aria-busy={generando}>
        <div className="ocda-modal-cabecera">
          <span className="ocda-modal-icono" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 16V4m0 0l-5 5m5-5l5 5M5 20h14" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <h2 id="enlace-foto-titulo">Enlace para subir foto</h2>
            <p className="muted">
              {operador.apellidosNombres} · <span className="mono">{operador.cedula}</span>
            </p>
          </div>
          <button type="button" className="ocda-modal-cerrar" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {/* Región de estado siempre presente: así se anuncian "Generando…" y "Copiado". */}
        <p className="ocda-modal-estado" role="status">
          {generando ? 'Generando enlace…' : copiado ? 'Enlace copiado.' : ''}
        </p>
        {!enlace && !generando && (
          <p className="muted" style={{ margin: 0 }}>
            Genere el enlace personal y envíelo por WhatsApp. Sirve una sola vez y caduca en 48 horas. Si ya había
            enviado uno a esta persona, ese deja de funcionar.
          </p>
        )}
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}

        {url && enlace && (
          <>
            <div className="ocda-enlace">
              <label htmlFor="enlace-foto-url" className="sr-only">
                Enlace personal
              </label>
              <input
                id="enlace-foto-url"
                className="mono"
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
              />
              <button type="button" className="btn secondary" onClick={copiar}>
                {copiado ? 'Copiado' : 'Copiar'}
              </button>
            </div>
            <p className="ocda-enlace-aviso">
              Enlace único para esta persona: sirve una sola vez y caduca el {venceEl(enlace.expiraEn)}. Si genera
              otro, este deja de funcionar.
            </p>
            {!numero && (
              <p className="muted" style={{ margin: 0 }}>
                El operador no tiene un celular válido registrado: elija el contacto en WhatsApp.
              </p>
            )}
          </>
        )}

        <div className="ocda-modal-acciones">
          <button
            type="button"
            className={enlace ? 'btn secondary' : 'btn'}
            disabled={generando}
            onClick={() => void generar()}
          >
            {enlace ? 'Generar otro' : 'Generar enlace'}
          </button>
          {whatsapp && (
            <a className="btn" href={whatsapp} target="_blank" rel="noopener noreferrer">
              Enviar por WhatsApp
            </a>
          )}
        </div>
      </div>
    </Modal>
  );
}
