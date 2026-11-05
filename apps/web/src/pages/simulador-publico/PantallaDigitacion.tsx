import { useEffect, useRef, useState } from 'react';
import type { ActaSimulador, EstadoIntentoSimulador } from '@cne/shared-types';
import {
  borradorActaSimulador,
  espaciado,
  estadoHttp,
  estadoSimulador,
  guardarActaSimulador,
  mensajeDe,
  nuevaActaSimulador,
  reloj,
  trazoDeFila,
} from '../../lib/queries/simulador-publico';

/** Mantiene la sesión "en uso" (la API bloquea el retome desde otro equipo por 2 min). */
export const LATIDO_MS = 45_000;
/** Lo escrito se manda como borrador tras esta pausa al digitar (cuenta si el tiempo se acaba). */
export const BORRADOR_MS = 3_000;

/** Atajos del SIER: Alt+Q pide la nueva acta y Alt+W la envía. Por código de tecla: no depende del idioma del teclado. */
export function atajo(e: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'code'>): 'nueva' | 'guardar' | null {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  if (e.code === 'KeyQ') return 'nueva';
  if (e.code === 'KeyW') return 'guardar';
  return null;
}

type Enfocar = 'nueva' | 'caja' | null;

interface Props {
  token: string;
  estadoInicial: EstadoIntentoSimulador;
  onTerminada: (estado: EstadoIntentoSimulador) => void;
  onSesionPerdida: () => void;
}

/** Solo dígitos, hasta 3 (como la caja del SIER). */
const limpiar = (v: string) => v.replace(/\D/g, '').slice(0, 3);
const aValor = (v: string): number | null => (v === '' ? null : Number(v));

/**
 * La pantalla de Digitación: cada fila trae el número en letras (manuscrito) y
 * en tres casilleros, y una caja para digitarlo. Vale lo que dicen las letras.
 */
export function PantallaDigitacion({ token, estadoInicial, onTerminada, onSesionPerdida }: Props) {
  const [estado, setEstado] = useState(estadoInicial);
  const [acta, setActa] = useState<ActaSimulador | null>(null);
  const [valores, setValores] = useState<string[]>([]);
  const [incorrectas, setIncorrectas] = useState<number[]>([]);
  const [mensaje, setMensaje] = useState('Pulse «Nueva acta» (Alt+Q) para empezar a digitar.');
  const [aviso, setAviso] = useState<{ perfectas: number; de: number } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  /** Adónde va el foco cuando termina la llamada en curso (un control deshabilitado no lo recibe). */
  const [enfocar, setEnfocar] = useState<Enfocar>('nueva');
  const [ahora, setAhora] = useState(() => Date.now());
  const cajas = useRef<(HTMLInputElement | null)[]>([]);
  const botonNueva = useRef<HTMLButtonElement>(null);
  /** Candado síncrono: un Enter con autorepetición no manda dos guardados. */
  const enVuelo = useRef(false);
  // En refs: los temporizadores no deben reiniciarse cuando cambian estas funciones.
  const alTerminar = useRef(onTerminada);
  alTerminar.current = onTerminada;
  const alPerderSesion = useRef(onSesionPerdida);
  alPerderSesion.current = onSesionPerdida;
  /** Último borrador enviado (no se repite si no cambió). */
  const ultimoBorrador = useRef('');

  const restante = Date.parse(estado.venceEn) - ahora;

  /** Una respuesta tardía (p. ej. un latido que salió antes de guardar) no hace retroceder el avance. */
  const actualizarEstado = (e: EstadoIntentoSimulador) =>
    setEstado((previo) => (e.completadas < previo.completadas ? previo : e));

  /** Errores comunes: sesión perdida, práctica terminada, acta ya cerrada u otro. */
  async function manejarError(e: unknown, porDefecto: string) {
    const status = estadoHttp(e);
    if (status === 401) return alPerderSesion.current();
    if (status === 409) {
      try {
        const e2 = await estadoSimulador(token);
        if (e2.terminado) return alTerminar.current(e2);
        actualizarEstado(e2);
      } catch {
        /* se muestra el mensaje de abajo */
      }
      // El acta ya no se puede guardar (p. ej. se guardó en otra pestaña): se suelta para pedir otra.
      setActa(null);
      setIncorrectas([]);
      const motivo = mensajeDe(e, porDefecto).replace(/[.!?]?$/, '.');
      setMensaje(`${motivo} Pulse «Nueva acta» (Alt+Q) para seguir.`);
      setEnfocar('nueva');
      return;
    }
    setMensaje(mensajeDe(e, porDefecto));
    setEnfocar(acta ? 'caja' : 'nueva');
  }

  // Cronómetro (el plazo real lo controla la API; esto solo lo muestra).
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Al llegar a 0, confirmar con la API y cerrar.
  const vencido = restante <= 0;
  const borradorActual = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (!vencido) return;
    // Primero lo que quedó escrito en el acta abierta (cuenta como registros), luego el cierre.
    borradorActual
      .current()
      .then(() => estadoSimulador(token))
      .then((e) => (e.terminado ? alTerminar.current(e) : actualizarEstado(e)))
      .catch((e) => (estadoHttp(e) === 401 ? alPerderSesion.current() : undefined));
  }, [vencido, token]);

  // Latido: mantiene la sesión como "en uso" mientras la pantalla esté abierta.
  useEffect(() => {
    const t = setInterval(() => {
      if (enVuelo.current) return; // guardar o pedir acta ya marcan la sesión como en uso
      estadoSimulador(token)
        .then((e) => (e.terminado ? alTerminar.current(e) : actualizarEstado(e)))
        .catch((e) => (estadoHttp(e) === 401 ? alPerderSesion.current() : undefined));
    }, LATIDO_MS);
    return () => clearInterval(t);
  }, [token]);

  // Foco pendiente, cuando ya no hay llamada en curso.
  useEffect(() => {
    if (!enfocar || ocupado) return;
    if (enfocar === 'nueva') botonNueva.current?.focus();
    else if (enfocar === 'caja') cajas.current[incorrectas[0] ?? 0]?.focus();
    setEnfocar(null);
  }, [enfocar, ocupado, incorrectas]);

  // Borrador: lo escrito en el acta abierta, tras una pausa al digitar.
  async function mandarBorrador() {
    if (!acta) return;
    const clave = `${acta.id}:${valores.join(',')}`;
    if (clave === ultimoBorrador.current || valores.every((v) => v === '')) return;
    ultimoBorrador.current = clave;
    try {
      await borradorActaSimulador(token, acta.id, valores.map(aValor));
    } catch {
      ultimoBorrador.current = ''; // se reintenta en la próxima pausa o al cerrar
    }
  }
  borradorActual.current = mandarBorrador;
  useEffect(() => {
    if (!acta) return;
    const t = setTimeout(() => void borradorActual.current(), BORRADOR_MS);
    return () => clearTimeout(t);
  }, [acta, valores]);

  // Atajos Alt+Q / Alt+W en toda la pantalla.
  const acciones = useRef({ nueva: () => {}, guardar: () => {} });
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const a = atajo(e);
      if (!a) return;
      e.preventDefault();
      acciones.current[a]();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // Avisos de tiempo, una sola vez cada uno (no el reloj segundo a segundo).
  const avisoTiempo = restante <= 60_000 ? 'Queda menos de 1 minuto.' : restante <= 5 * 60_000 ? 'Quedan menos de 5 minutos.' : '';

  async function conCandado(fn: () => Promise<void>) {
    if (enVuelo.current) return;
    enVuelo.current = true;
    setOcupado(true);
    try {
      await fn();
    } finally {
      enVuelo.current = false;
      setOcupado(false);
    }
  }

  const nuevaActa = () =>
    conCandado(async () => {
      if (acta) return; // primero hay que guardar la que está abierta
      try {
        const r = await nuevaActaSimulador(token);
        actualizarEstado(r.estado);
        if (!r.acta) return alTerminar.current(r.estado);
        setActa(r.acta);
        setValores(r.acta.filas.map(() => ''));
        setIncorrectas([]);
        setAviso(null);
        setMensaje(`Acta ${r.acta.numero}: digite el número que dicen las letras en cada fila (Tab pasa de fila; Alt+W envía).`);
        setEnfocar('caja');
      } catch (e) {
        await manejarError(e, 'No se pudo traer el acta. Intente de nuevo.');
      }
    });

  const guardar = () =>
    conCandado(async () => {
      if (!acta) return;
      try {
        const r = await guardarActaSimulador(token, acta.id, valores.map(aValor));
        actualizarEstado(r.estado);
        if (!r.guardada) {
          setIncorrectas(r.filasIncorrectas);
          const filas = r.filasIncorrectas.map((i) => i + 1).join(', ');
          setMensaje(`Hay ${r.filasIncorrectas.length} fila(s) con error (${filas}). Corríjalas y vuelva a guardar (Alt+W).`);
          setEnfocar('caja');
          return;
        }
        if (r.estado.terminado) return alTerminar.current(r.estado);
        setActa(null);
        setIncorrectas([]);
        setAviso(r.aviso);
        // Un solo anuncio: el aviso de cada 20 actas va dentro del mismo mensaje.
        const veinte = r.aviso ? ` Digitó ${r.aviso.perfectas} de ${r.aviso.de} actas sin errores.` : '';
        setMensaje(`Acta ${acta.numero} guardada.${veinte} Pulse «Nueva acta» (Alt+Q) para seguir.`);
        setEnfocar('nueva');
      } catch (e) {
        await manejarError(e, 'No se pudo guardar el acta. Intente de nuevo.');
      }
    });

  acciones.current = { nueva: () => void nuevaActa(), guardar: () => void guardar() };

  const avance = Math.min(100, Math.round((estado.completadas / estado.metaActas) * 100));
  const pocoTiempo = restante <= 5 * 60_000;

  return (
    <div className="sier-pantalla">
      <aside className="sier-lateral" aria-label="Su práctica">
        <p className="sier-lateral-nombre">{estado.nombre}</p>
        <p className="sier-lateral-cargo">{estado.cargo}</p>
        <p className="sier-lateral-practica">
          {estado.practica} · intento {estado.numeroIntento}
        </p>
        <div className={`sier-reloj${pocoTiempo ? ' poco' : ''}`}>
          <span>Tiempo restante</span>
          {/* El reloj no se anuncia cada segundo: solo se lee si la persona llega a él. */}
          <strong>{reloj(restante)}</strong>
          {avisoTiempo && <em className="sier-reloj-aviso">{avisoTiempo}</em>}
        </div>
        <p className="sr-only" role="status">
          {avisoTiempo}
        </p>
        <div className="sier-avance">
          <span>
            Actas: <strong>{estado.completadas}</strong> de {estado.metaActas}
          </span>
          <div
            className="sier-barra"
            role="progressbar"
            aria-label="Avance de la meta"
            aria-valuemin={0}
            aria-valuemax={estado.metaActas}
            aria-valuenow={estado.completadas}
            aria-valuetext={`${estado.completadas} de ${estado.metaActas} actas`}
          >
            <div style={{ width: `${avance}%` }} />
          </div>
          <span className="sier-suave">Sin errores: {estado.perfectas}</span>
        </div>
        <div className="sier-registros">
          <span>Registros digitados</span>
          <strong>{estado.filasDigitadas}</strong>
          <span className="sier-suave">Correctos: {estado.filasCorrectas}</span>
        </div>
      </aside>

      <section className="sier-trabajo" aria-labelledby="sier-digitacion-titulo">
        <p className="sier-migas">Simulador / Proceso / Digitación</p>
        <h2 id="sier-digitacion-titulo" className="sr-only">
          Digitación
        </h2>
        <div className="sier-barra-botones" role="toolbar" aria-label="Acciones del acta">
          <button
            type="button"
            ref={botonNueva}
            className="sier-btn azul"
            aria-keyshortcuts="Alt+Q"
            disabled={ocupado || !!acta}
            onClick={() => void nuevaActa()}
          >
            Nueva acta <kbd aria-hidden="true">Alt+Q</kbd>
          </button>
          <button
            type="button"
            className="sier-btn verde"
            aria-keyshortcuts="Alt+W"
            disabled={ocupado || !acta}
            onClick={() => void guardar()}
          >
            Guardar <kbd aria-hidden="true">Alt+W</kbd>
          </button>
          <label className="sr-only" htmlFor="sier-novedad">
            Novedad
          </label>
          <select id="sier-novedad" className="sier-select" disabled aria-describedby="sier-novedad-nota">
            <option>Seleccione Novedad</option>
          </select>
          <button type="button" className="sier-btn marino" disabled aria-describedby="sier-novedad-nota">
            Guardar novedad
          </button>
          <span id="sier-novedad-nota" className="sier-suave">
            Las novedades se habilitarán más adelante.
          </span>
        </div>

        <p className="sier-mensaje" role="status">
          {mensaje}
        </p>
        {aviso && (
          // Ya se anunció en el mensaje de arriba: aquí es solo visual.
          <div className="sier-aviso-20">
            Digitó <strong>{aviso.perfectas} de {aviso.de}</strong> actas sin errores.
            <button
              type="button"
              className="sier-btn claro"
              onClick={() => {
                setAviso(null);
                setEnfocar('nueva');
              }}
            >
              Entendido
            </button>
          </div>
        )}

        {acta && (
          <ol className="sier-acta" aria-label={`Acta ${acta.numero}`}>
            {acta.filas.map((f, i) => {
              const trazo = trazoDeFila(acta.id, i);
              const mal = incorrectas.includes(i);
              const id = `sier-fila-${i}`;
              return (
                <li key={i} className={`sier-fila${mal ? ' mal' : ''}`}>
                  <span
                    className="sier-letras"
                    aria-hidden="true"
                    style={{ transform: `rotate(${trazo.giro}deg) scale(${trazo.escala})`, paddingLeft: trazo.sangria }}
                  >
                    {espaciado(f.letras)}
                  </span>
                  <span className="sier-casilleros" aria-hidden="true">
                    {f.digitos.split('').map((d, j) => (
                      <span key={j}>{d}</span>
                    ))}
                  </span>
                  <label htmlFor={id} className="sr-only">
                    {`Fila ${i + 1}: ${f.letras}; casilleros ${f.digitos}`}
                  </label>
                  <input
                    id={id}
                    ref={(el) => (cajas.current[i] = el)}
                    className="sier-caja"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={3}
                    value={valores[i] ?? ''}
                    aria-invalid={mal || undefined}
                    aria-describedby={mal ? `${id}-revisar` : undefined}
                    onChange={(e) => {
                      const v = limpiar(e.target.value);
                      setValores((xs) => xs.map((x, k) => (k === i ? v : x)));
                    }}
                  />
                  {mal && (
                    <span id={`${id}-revisar`} className="sr-only">
                      Revisar esta fila
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
