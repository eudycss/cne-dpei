import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { api } from './api';
import { esReintentableEnCola, esYaRegistrado, isNetworkError, isTransientError } from './errores-red';
import { FotoMilitarPerdidaError, resolverFotoMilitarEnPayload } from './offline-foto-militar';

const QUEUE_KEY = 'cne:offline_queue';
const RECHAZADAS_KEY = 'cne:offline_rechazadas';
const MAX_MOTIVO = 200;
const MAX_RECHAZADAS = 50;
// Las posiciones GPS van cada pocos segundos: un rechazo de una sola no
// merece un aviso al operador y llenaría la lista.
const SIN_AVISO_DE_RECHAZO = new Set(['/tracking/posiciones']);

/** Registro que el servidor no aceptó al sincronizar: se muestra al operador con el motivo. */
export interface AccionRechazada {
  id: string;
  endpoint: string;
  motivo: string;
  registradaEn: string;
  rechazadaEn: string;
}

interface QueuedAction {
  id: string;
  endpoint: string;
  method: 'post' | 'patch';
  payload: object;
  enqueuedAt: string;
}

function leerLista<T>(raw: string | null): T[] {
  if (!raw) return [];
  try {
    const lista = JSON.parse(raw);
    return Array.isArray(lista) ? (lista as T[]) : [];
  } catch {
    return []; // dato corrupto: mejor seguir operando que dejar la cola inservible
  }
}

async function getQueue(): Promise<QueuedAction[]> {
  return leerLista<QueuedAction>(await AsyncStorage.getItem(QUEUE_KEY));
}

async function saveQueue(queue: QueuedAction[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

async function getRechazadas(): Promise<AccionRechazada[]> {
  return leerLista<AccionRechazada>(await AsyncStorage.getItem(RECHAZADAS_KEY));
}

function motivoDeRechazo(e: unknown): string {
  if (e instanceof FotoMilitarPerdidaError) return e.message;
  const mensaje = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  const texto = Array.isArray(mensaje) ? mensaje.join('. ') : typeof mensaje === 'string' ? mensaje : '';
  return (texto || 'El servidor no aceptó el registro.').slice(0, MAX_MOTIVO);
}

// Serializa las secciones leer-modificar-guardar de la cola (nunca los POST de red,
// para no bloquear un enqueue mientras se espera al servidor): sin esto, un enqueue
// intercalado con otro, o con el guardado final del flush, podía perder o duplicar acciones.
let candado: Promise<unknown> = Promise.resolve();
function conCandado<T>(fn: () => Promise<T>): Promise<T> {
  const resultado = candado.then(fn);
  candado = resultado.catch(() => undefined);
  return resultado;
}

export async function enqueue(item: Omit<QueuedAction, 'id' | 'enqueuedAt'>): Promise<void> {
  await conCandado(async () => {
    const queue = await getQueue();
    // Sufijo aleatorio: dos acciones en el mismo milisegundo no deben compartir id,
    // porque el flush usa el id para distinguir lo ya procesado de lo nuevo.
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    queue.push({ ...item, id, enqueuedAt: new Date().toISOString() });
    await saveQueue(queue);
  });
}

let envioEnCurso: Promise<void> | null = null;
// Cambia con cada vaciarCola (cierre de sesión o cambio de operador): un envío
// que empezó antes no debe seguir enviando ni volver a guardar la cola vieja.
let epoca = 0;

/** Envía la cola en orden. Si ya hay un envío en curso, devuelve ese mismo (no lo duplica). */
export function flushQueue(): Promise<void> {
  if (!envioEnCurso) {
    envioEnCurso = enviarCola().finally(() => {
      envioEnCurso = null;
    });
  }
  return envioEnCurso;
}

async function enviarCola(): Promise<void> {
  const epocaInicial = epoca;
  const queue = await getQueue();
  if (queue.length === 0) return;
  const remaining: QueuedAction[] = [];
  const rechazadas: AccionRechazada[] = [];
  for (let i = 0; i < queue.length; i++) {
    if (epoca !== epocaInicial) return;
    const action = queue[i];
    let payload: object;
    try {
      // Una recepción de kit encolada sin señal lleva un marcador en vez de la
      // URL de la foto: se sube la foto aquí, justo antes, para respetar el
      // orden que exige el servidor (foto → recepción → llegada).
      payload = await resolverFotoMilitarEnPayload(action.payload);
    } catch (e) {
      if (esReintentableEnCola(e)) {
        // La foto todavía no sube: se conserva esta acción y todo lo que depende de ella.
        remaining.push(...queue.slice(i));
        break;
      }
      rechazadas.push(aRechazada(action, e));
      continue;
    }
    try {
      await api[action.method](action.endpoint, payload);
    } catch (e) {
      if (esReintentableEnCola(e)) {
        // Sin red, error del servidor (5xx, ej. Render despertando) o sin sesión
        // válida (401): mantener en cola esta acción y todas las que quedan por
        // procesar, no solo la que falló.
        remaining.push(...queue.slice(i));
        break; // no seguir procesando si el backend no está respondiendo bien
      }
      // 409: ya estaba registrado (la respuesta anterior se perdió); no es un error.
      if (esYaRegistrado(e)) continue;
      // Otro 4xx: no se reintenta, pero queda a la vista del operador con el motivo.
      rechazadas.push(aRechazada(action, e));
    }
  }
  // Releer antes de guardar: lo que se encoló mientras se esperaba al servidor
  // no estaba en `queue` y se perdería al sobrescribir la cola con `remaining`.
  const procesadas = new Set(queue.map((a) => a.id));
  await conCandado(async () => {
    if (epoca !== epocaInicial) return; // se cerró sesión durante el envío
    const encoladasDurante = (await getQueue()).filter((a) => !procesadas.has(a.id));
    await saveQueue([...remaining, ...encoladasDurante]);
    const visibles = rechazadas.filter((r) => !SIN_AVISO_DE_RECHAZO.has(r.endpoint));
    if (visibles.length > 0) {
      const todas = [...(await getRechazadas()), ...visibles].slice(-MAX_RECHAZADAS);
      await AsyncStorage.setItem(RECHAZADAS_KEY, JSON.stringify(todas));
    }
  });
}

function aRechazada(action: QueuedAction, e: unknown): AccionRechazada {
  return {
    id: action.id,
    endpoint: action.endpoint,
    motivo: motivoDeRechazo(e),
    registradaEn: action.enqueuedAt,
    rechazadaEn: new Date().toISOString(),
  };
}

/** Registros rechazados al sincronizar, para mostrarlos al operador. */
export async function leerRechazadas(): Promise<AccionRechazada[]> {
  return getRechazadas();
}

/**
 * El operador ya vio estos rechazos (y avisó a su supervisor): se quitan de la
 * lista. Solo los ids indicados, para no borrar uno que llegó mientras tanto.
 */
export async function descartarRechazadas(ids: string[]): Promise<void> {
  const quitar = new Set(ids);
  await conCandado(async () => {
    const quedan = (await getRechazadas()).filter((r) => !quitar.has(r.id));
    await AsyncStorage.setItem(RECHAZADAS_KEY, JSON.stringify(quedan));
  });
}

/**
 * Al cerrar sesión o entrar otro operador: lo pendiente es del operador
 * anterior y no debe enviarse con la sesión de otro (quedaría a su nombre).
 */
export async function vaciarCola(): Promise<void> {
  epoca++;
  await conCandado(async () => {
    await AsyncStorage.removeItem(QUEUE_KEY);
    await AsyncStorage.removeItem(RECHAZADAS_KEY);
  });
}

/**
 * Reintenta enviar la cola si hay acciones pendientes y devuelve cuántas quedan.
 * Sin esto, lo encolado solo se reenviaba tras otra acción online o al volver del
 * background — y en "Jornada completada" ya no quedan más acciones que lo disparen.
 */
export async function sincronizarPendientes(): Promise<number> {
  if ((await getQueue()).length > 0) await flushQueue();
  return (await getQueue()).length;
}

/** Acciones aún sin enviar, sin intentar enviarlas (a diferencia de sincronizarPendientes). */
export async function contarPendientes(): Promise<number> {
  return (await getQueue()).length;
}

export { isNetworkError, isTransientError };

export async function withOffline<T>(
  endpoint: string,
  method: 'post' | 'patch',
  payload: object,
  fn: () => Promise<T>,
  { enOrden = true }: { enOrden?: boolean } = {},
): Promise<T | null> {
  // Los pasos de la jornada dependen de los anteriores (el servidor rechaza la
  // llegada si faltan recepciones de kit). Si quedan acciones sin enviar, se
  // envían primero; si siguen pendientes, esta va a la cola detrás de ellas.
  // `enOrden: false` para lo que no depende de nada (posiciones GPS, incidencias).
  if (enOrden && (await contarPendientes()) > 0) {
    await flushQueue();
    // Si había un envío en curso, lo encolado mientras tanto se envía en una segunda pasada.
    if ((await contarPendientes()) > 0) await flushQueue();
    if ((await contarPendientes()) > 0) {
      await enqueue({ endpoint, method, payload: { ...payload, desdeOffline: true } });
      return null;
    }
  }
  try {
    const result = await fn();
    flushQueue(); // best-effort, sin await
    return result;
  } catch (e) {
    if (isTransientError(e)) {
      await enqueue({ endpoint, method, payload: { ...payload, desdeOffline: true } });
      return null;
    }
    throw e;
  }
}

/**
 * Estado de la sincronización para la barra superior: cuántos registros faltan
 * por enviar y cuáles rechazó el servidor (con su motivo).
 */
export function useEstadoSincronizacion(): {
  pendientes: number;
  rechazadas: AccionRechazada[];
  descartar: (ids: string[]) => Promise<void>;
} {
  const [pendientes, setPendientes] = useState(0);
  const [rechazadas, setRechazadas] = useState<AccionRechazada[]>([]);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const n = await sincronizarPendientes();
        const r = await leerRechazadas();
        if (!cancelled) {
          setPendientes(n);
          setRechazadas(r);
        }
      } catch {
        // Fallo de AsyncStorage: se reintenta en el próximo ciclo; el badge conserva su valor.
      }
    };

    // Al montar (cubre el cold start), al volver al foreground y cada 15 s:
    // reintenta lo pendiente y actualiza el badge.
    refresh();

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });

    const interval = setInterval(refresh, 15_000);

    return () => {
      cancelled = true;
      appStateSub.remove();
      clearInterval(interval);
    };
  }, []);

  const descartar = useCallback(async (ids: string[]) => {
    await descartarRechazadas(ids);
    setRechazadas((actuales) => actuales.filter((r) => !ids.includes(r.id)));
  }, []);

  return { pendientes, rechazadas, descartar };
}
