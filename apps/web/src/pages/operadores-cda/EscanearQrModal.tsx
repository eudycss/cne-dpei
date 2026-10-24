import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { AsistenciaCdaFila, ConsultaQrCda, TipoMarcaAsistenciaCda } from '@cne/shared-types';
import { tokenCredencialQrCdaSchema } from '@cne/shared-validation';
import { Modal } from '../../components/Modal';
import { consultarQrCda, marcarQrCda } from '../../lib/queries/operadores-cda';
import { CamaraQr } from './CamaraQr';
import { useFotoOperadorUrl } from './useFotoOperador';
import { useEnLinea } from '../../lib/useEnLinea';
import { cargoCorto, horaEcuador, iniciales, mensajeError } from './utils';

type Confirmacion = { token: string; consulta: ConsultaQrCda };

const ETIQUETA: Record<TipoMarcaAsistenciaCda, string> = { ENTRADA: 'entrada', SALIDA: 'salida' };
/** La cámara lee el mismo código varias veces por segundo: se ignora si se repite en este lapso. */
const REPETIDO_MS = 4000;

/**
 * Asistencia con el carnet QR. El código llega de un lector USB (teclea el
 * código y Enter en el campo, que siempre tiene el foco) o de la cámara. Leer
 * no marca nada: se muestra la foto para comparar con la persona y quien
 * escanea confirma. Después vuelve a esperar el siguiente carnet. Solo con
 * conexión: sin red no se lee ni se marca (no hay cola sin conexión).
 */
export function EscanearQrModal({
  onClose,
  onMarcado,
}: {
  onClose: () => void;
  onMarcado: (fila: AsistenciaCdaFila) => void;
}) {
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmacion, setConfirmacion] = useState<Confirmacion | null>(null);
  const [ultima, setUltima] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const enLinea = useEnLinea();
  const [camara, setCamara] = useState(false);
  const campoRef = useRef<HTMLInputElement>(null);
  const ultimoLeido = useRef<{ token: string; en: number } | null>(null);

  const volverAEsperar = () => {
    setConfirmacion(null);
    setCodigo('');
    // Tras el render: el campo vuelve a existir.
    setTimeout(() => campoRef.current?.focus(), 0);
  };

  const consultar = useMutation({
    mutationFn: (token: string) => consultarQrCda(token),
    onSuccess: (consulta, token) => {
      setError(null);
      setConfirmacion({ token, consulta });
    },
    onError: (e) => {
      setError(mensajeError(e, 'No se pudo leer el carnet'));
      volverAEsperar();
    },
  });

  const marcar = useMutation({
    mutationFn: ({ token, tipo }: { token: string; tipo: TipoMarcaAsistenciaCda }) => marcarQrCda(token, tipo),
    onSuccess: (fila, { tipo }) => {
      const hora = horaEcuador((tipo === 'ENTRADA' ? fila.entradaEn : fila.salidaEn)!);
      const texto = `${tipo === 'ENTRADA' ? 'Entrada' : 'Salida'} registrada a las ${hora}`;
      sileo.success({ title: texto, description: fila.operador.apellidosNombres });
      setUltima(`${texto}: ${fila.operador.apellidosNombres}`);
      onMarcado(fila);
      volverAEsperar();
    },
    onError: (e) => {
      setError(mensajeError(e, 'No se pudo registrar la marca'));
      volverAEsperar();
    },
  });

  function procesar(valor: string) {
    if (!enLinea || consultar.isPending || marcar.isPending || confirmacion) return;
    const r = tokenCredencialQrCdaSchema.safeParse(valor);
    if (!r.success) {
      setError(r.error.issues[0]?.message ?? 'Código no reconocido');
      setCodigo('');
      return;
    }
    const ahora = Date.now();
    if (ultimoLeido.current?.token === r.data && ahora - ultimoLeido.current.en < REPETIDO_MS) {
      setAviso('Ese carnet se acaba de leer: espere unos segundos para leerlo otra vez');
      setCodigo('');
      return;
    }
    ultimoLeido.current = { token: r.data, en: ahora };
    setError(null);
    setAviso(null);
    consultar.mutate(r.data);
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    if (codigo.trim()) procesar(codigo);
  }

  return (
    <Modal labelledBy="escanear-qr-titulo" onClose={onClose} maxWidth={560}>
      <div className="ocda-modal" aria-busy={consultar.isPending || marcar.isPending}>
        <div className="ocda-modal-cabecera">
          <span className="ocda-modal-icono" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path
                d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4M8 12h8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div>
            <h2 id="escanear-qr-titulo">Escanear carnet</h2>
            <p className="muted">Entrada o salida de hoy con el carnet QR del operador.</p>
          </div>
          <button type="button" className="ocda-modal-cerrar" onClick={onClose} aria-label="Cerrar">
            ×
          </button>
        </div>

        {!enLinea && (
          <div className="banner error" role="alert">
            Sin conexión a internet: el carnet solo se puede escanear con conexión. Reintente cuando vuelva la red.
          </div>
        )}
        {error && (
          <div className="banner error" role="alert">
            {error}
          </div>
        )}
        <p role="status" className={ultima || aviso ? 'ocda-qr-ultima' : 'sr-only'}>
          {consultar.isPending ? 'Leyendo carnet…' : marcar.isPending ? 'Registrando…' : aviso ?? ultima ?? ''}
        </p>

        {confirmacion && (
          <Confirmar
            confirmacion={confirmacion}
            registrando={marcar.isPending}
            sinConexion={!enLinea}
            onConfirmar={(tipo) => marcar.mutate({ token: confirmacion.token, tipo })}
            onCancelar={volverAEsperar}
          />
        )}
        {!confirmacion && (
          <form onSubmit={enviar} className="ocda-qr-lector">
            <label htmlFor="escanear-qr-codigo">Código del carnet</label>
            <input
              id="escanear-qr-codigo"
              ref={campoRef}
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={consultar.isPending || !enLinea}
              aria-describedby="escanear-qr-ayuda"
            />
            <span id="escanear-qr-ayuda" className="ocda-form-ayuda">
              Con el lector USB, apunte al carnet: el código se escribe solo. También puede usar la cámara.
            </span>
            <div className="ocda-modal-acciones">
              <button type="button" className="btn secondary" onClick={() => setCamara((c) => !c)} aria-pressed={camara}>
                {camara ? 'Apagar cámara' : 'Usar cámara'}
              </button>
              <button type="submit" className="btn" disabled={!codigo.trim() || consultar.isPending}>
                Buscar
              </button>
            </div>
          </form>
        )}
        {/* Fuera del formulario: mientras se confirma, la cámara se pausa en vez de apagarse. */}
        {camara && (
          <CamaraQr
            pausado={!!confirmacion}
            onLeido={procesar}
            onError={(m) => {
              setError(m);
              setCamara(false);
            }}
          />
        )}
      </div>
    </Modal>
  );
}

function Confirmar({
  confirmacion: { consulta },
  registrando,
  sinConexion,
  onConfirmar,
  onCancelar,
}: {
  confirmacion: Confirmacion;
  registrando: boolean;
  sinConexion: boolean;
  onConfirmar: (tipo: TipoMarcaAsistenciaCda) => void;
  onCancelar: () => void;
}) {
  const { operador: o, siguiente, entradaEn, salidaEn, salidaDesde } = consulta;
  const foto = useFotoOperadorUrl(o);
  // Se evalúa al mostrar: si espera, puede cancelar y volver a escanear.
  const [ahora] = useState(() => Date.now());
  const salidaEnEspera = siguiente === 'SALIDA' && salidaDesde !== null && Date.parse(salidaDesde) > ahora;
  const puedeMarcar = siguiente !== 'COMPLETO' && !salidaEnEspera;
  // Sin foto el QR solo no basta (podría ser una foto del carnet de otro): se pide constancia de la cédula.
  const pideCedula = puedeMarcar && !o.tieneFoto;
  const [cedulaVerificada, setCedulaVerificada] = useState(false);
  const cancelarRef = useRef<HTMLButtonElement>(null);
  const verificarRef = useRef<HTMLInputElement>(null);
  const confirmarRef = useRef<HTMLButtonElement>(null);
  // Foco al control que toca usar: confirmar, la casilla de la cédula o, sin nada que marcar, "Escanear otro".
  useEffect(() => {
    (pideCedula ? verificarRef : puedeMarcar ? confirmarRef : cancelarRef).current?.focus();
  }, [pideCedula, puedeMarcar]);

  return (
    <div className="ocda-qr-confirmar">
      <div className="ocda-qr-persona">
        <span className={`ocda-qr-foto${o.tieneFoto ? ' con-foto' : ''}`}>
          {foto ? <img src={foto} alt={`Foto de ${o.apellidosNombres}`} /> : <span aria-hidden="true">{iniciales(o.apellidosNombres)}</span>}
        </span>
        <div>
          <p className="ocda-qr-nombre">{o.apellidosNombres}</p>
          <p className="muted">
            C.I. {o.cedula} · {cargoCorto(o.cargo)}
          </p>
          {!o.tieneFoto && <p className="ocda-form-ayuda">Sin foto registrada: verifique la cédula.</p>}
          {entradaEn && <p className="muted">Entrada de hoy: {horaEcuador(entradaEn)}</p>}
          {salidaEn && <p className="muted">Salida de hoy: {horaEcuador(salidaEn)}</p>}
        </div>
      </div>

      {siguiente === 'COMPLETO' ? (
        <div className="banner" role="status">
          Ya registró la entrada y la salida de hoy.
        </div>
      ) : (
        <p className="ocda-qr-pregunta">
          {o.tieneFoto ? 'Compare la foto con la persona y confirme.' : 'Confirme la identidad de la persona.'}
        </p>
      )}
      {salidaEnEspera && (
        <div className="banner" role="status">
          La salida con el carnet se acepta desde las {horaEcuador(salidaDesde)} (evita marcarla por un segundo escaneo).
        </div>
      )}
      {pideCedula && (
        <label className="ocda-qr-verificar">
          <input
            ref={verificarRef}
            type="checkbox"
            checked={cedulaVerificada}
            onChange={(e) => setCedulaVerificada(e.target.checked)}
          />
          Verifiqué la cédula de identidad de la persona
        </label>
      )}

      <div className="ocda-modal-acciones">
        <button
          type="button"
          className="btn secondary"
          onClick={onCancelar}
          ref={cancelarRef}
          disabled={registrando}
        >
          {siguiente === 'COMPLETO' ? 'Escanear otro' : 'Cancelar'}
        </button>
        {siguiente !== 'COMPLETO' && (
          <button
            type="button"
            className="btn"
            ref={confirmarRef}
            disabled={registrando || sinConexion || !puedeMarcar || (pideCedula && !cedulaVerificada)}
            onClick={() => onConfirmar(siguiente)}
          >
            {registrando ? 'Registrando…' : `Registrar ${ETIQUETA[siguiente]}`}
          </button>
        )}
      </div>
    </div>
  );
}
