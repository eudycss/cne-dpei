import { FormEvent, useEffect, useRef, useState } from 'react';
import { isAxiosError } from 'axios';
import type { MochilaPorQr } from '@cne/shared-types';
import { leerCodigoQrKit } from '@cne/shared-validation';
import { Modal } from '../../components/Modal';
import { CamaraQr } from '../operadores-cda/CamaraQr';
import { buscarMochilaPorQr } from '../../lib/queries/kits';
import { mensajeError } from '../operadores-cda/utils';
import { FormNumeroMochila } from './FormNumeroMochila';
import { avisarMochilaGuardada } from './NumeroMochilaModal';

/** Tras ver una mochila (o un QR que no existe), la cámara no vuelve a buscar ese mismo código por este tiempo. */
export const ESPERA_MISMO_QR_MS = 5000;

/**
 * Escanear mochilas (administrador y técnico supervisor): lee el QR del kit con
 * la cámara o escrito a mano; si la mochila ya tiene número lo muestra y deja
 * corregirlo, si no pide registrarlo. Después sigue con la siguiente sin volver
 * a pedir permiso de cámara.
 */
export function EscanearMochilasModal({
  puedeReemplazar,
  onClose,
  onGuardado,
}: {
  puedeReemplazar: boolean;
  onClose: () => void;
  onGuardado: () => void;
}) {
  const [camara, setCamara] = useState(true);
  const [codigo, setCodigo] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mochila, setMochila] = useState<MochilaPorQr | null>(null);
  const [corrigiendo, setCorrigiendo] = useState(false);
  const [ultima, setUltima] = useState<string | null>(null);
  // En refs (no en estado): la cámara llama varias veces por segundo y el estado llega tarde.
  const enCurso = useRef(false);
  const abierta = useRef(false);
  /** La cámara no vuelve a buscar este código hasta esa hora (sigue frente al lector, o no existe). */
  const bloqueado = useRef<{ codigo: string; hasta: number } | null>(null);
  const tituloRef = useRef<HTMLHeadingElement>(null);

  // Al volver de una mochila, el foco va al título (el formulario que lo tenía desapareció).
  const habiaMochila = useRef(false);
  useEffect(() => {
    if (habiaMochila.current && !mochila) tituloRef.current?.focus();
    habiaMochila.current = !!mochila;
  }, [mochila]);

  const bloquear = (codigo: string) => {
    bloqueado.current = { codigo, hasta: Date.now() + ESPERA_MISMO_QR_MS };
  };

  /** `desdeCamara`: lecturas automáticas (se ignoran repetidas); escrito a mano siempre se busca. */
  async function buscar(valor: string, desdeCamara: boolean) {
    if (enCurso.current || abierta.current) return;
    const leido = leerCodigoQrKit(valor);
    if (!leido) {
      setError('Ese código no es de un kit. Escanee la etiqueta pegada en la mochila.');
      return;
    }
    const b = bloqueado.current;
    if (desdeCamara && b?.codigo === leido && Date.now() < b.hasta) return;
    enCurso.current = true;
    setBuscando(true);
    setError(null);
    setUltima(null);
    try {
      const r = (await buscarMochilaPorQr(leido)).data;
      abierta.current = true;
      setMochila(r);
      setCorrigiendo(r.numeroMochila === null);
      setCodigo('');
    } catch (e) {
      // Si no existe, la cámara no lo repite; si fue la red, se puede reintentar enseguida.
      const status = isAxiosError(e) ? e.response?.status : (e as { response?: { status?: number } })?.response?.status;
      if (status === 400 || status === 404) bloquear(leido);
      else bloqueado.current = null;
      setError(mensajeError(e, 'No se pudo buscar ese QR. Revise la conexión e intente de nuevo.'));
    } finally {
      enCurso.current = false;
      setBuscando(false);
    }
  }

  function siguiente() {
    // La mochila sigue frente a la cámara: no reabrirla enseguida.
    if (mochila) bloquear(mochila.codigoUnico);
    abierta.current = false;
    setMochila(null);
    setCorrigiendo(false);
    setError(null);
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (codigo.trim()) void buscar(codigo, false);
  }

  return (
    <Modal labelledBy="escanear-mochilas-titulo" onClose={onClose} maxWidth={560}>
      <div className="ocda-modal" aria-busy={buscando}>
        <div className="ocda-modal-cabecera">
          <div>
            <h2 id="escanear-mochilas-titulo" ref={tituloRef} tabIndex={-1}>
              Escanear mochilas
            </h2>
            <p className="muted">Escanee el QR pegado en la mochila para ver o registrar su número.</p>
          </div>
          <button type="button" className="ocda-modal-cerrar" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}
        <p role="status" className={buscando || ultima ? 'ocda-qr-ultima' : 'sr-only'}>
          {buscando ? 'Buscando el kit…' : ultima ?? ''}
        </p>

        {mochila ? (
          <section aria-labelledby="mochila-escaneada-titulo">
            <h3 id="mochila-escaneada-titulo" style={{ margin: '0.25rem 0' }}>
              {mochila.recinto ? `${mochila.recinto.codigoRecinto} · ${mochila.recinto.nombre}` : mochila.nombreKit}
            </h3>
            <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: '0.85rem' }}>
              QR <code>{mochila.codigoUnico}</code> · {mochila.evento}
            </p>
            {mochila.numeroMochila !== null && (
              <div className="banner success">
                Esta mochila ya tiene el <strong>N.º {mochila.numeroMochila}</strong>.
              </div>
            )}
            {corrigiendo ? (
              <FormNumeroMochila
                key={mochila.kitId}
                kit={{ id: mochila.kitId, nombre: mochila.nombreKit, codigoUnico: mochila.codigoUnico, numeroMochila: mochila.numeroMochila }}
                puedeReemplazar={puedeReemplazar}
                idCampo="escanear-mochila-numero"
                onCancelar={siguiente}
                onGuardado={(r) => {
                  avisarMochilaGuardada(r, mochila.nombreKit);
                  setUltima(
                    r.numeroMochila === null
                      ? `QR ${r.codigoUnico}: número quitado. Escanee la siguiente.`
                      : `QR ${r.codigoUnico} = mochila N.º ${r.numeroMochila}. Escanee la siguiente.`,
                  );
                  onGuardado();
                  siguiente();
                }}
              />
            ) : (
              <div className="ocda-modal-acciones">
                <button type="button" className="btn secondary" onClick={() => setCorrigiendo(true)}>
                  Corregir número
                </button>
                <button type="button" className="btn" onClick={siguiente} autoFocus>
                  Escanear siguiente
                </button>
              </div>
            )}
          </section>
        ) : (
          <form onSubmit={enviar} className="ocda-qr-lector">
            <label htmlFor="escanear-mochila-codigo">Código del QR (si la cámara no lo lee)</label>
            <input
              id="escanear-mochila-codigo"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={40}
              disabled={buscando}
              aria-describedby="escanear-mochila-ayuda"
            />
            <span id="escanear-mochila-ayuda" className="ocda-form-ayuda">
              Son las 8 letras y números impresos bajo el QR.
            </span>
            <div className="ocda-modal-acciones">
              <button type="button" className="btn secondary" onClick={() => setCamara((c) => !c)}>
                {camara ? 'Apagar cámara' : 'Usar cámara'}
              </button>
              <button type="submit" className="btn" disabled={!codigo.trim() || buscando}>
                Buscar
              </button>
            </div>
          </form>
        )}

        {/* Fuera del formulario: mientras se ve una mochila la cámara se pausa en vez de apagarse. */}
        {camara && (
          <CamaraQr
            pausado={!!mochila || buscando}
            queLee="el QR del kit"
            indicacion="Centre el QR pegado en la mochila"
            onLeido={(valor) => void buscar(valor, true)}
            onError={(m) => {
              setError(`${m}. Puede escribir el código a mano.`);
              setCamara(false);
            }}
          />
        )}
      </div>
    </Modal>
  );
}
