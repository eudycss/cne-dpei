import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { api } from './api';

const QUEUE_KEY = 'cne:offline_queue';

interface QueuedAction {
  id: string;
  endpoint: string;
  method: 'post' | 'patch';
  payload: object;
  enqueuedAt: string;
}

async function getQueue(): Promise<QueuedAction[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? (JSON.parse(raw) as QueuedAction[]) : [];
}

async function saveQueue(queue: QueuedAction[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
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

let flushing = false;

export async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const queue = await getQueue();
    if (queue.length === 0) return;
    const remaining: QueuedAction[] = [];
    for (let i = 0; i < queue.length; i++) {
      const action = queue[i];
      try {
        await api[action.method](action.endpoint, action.payload);
      } catch (e) {
        if (isTransientError(e)) {
          // Sin red o error del servidor (5xx, ej. Render despertando): mantener en cola
          // esta acción y todas las que quedan por procesar, no solo la que falló.
          remaining.push(...queue.slice(i));
          break; // no seguir procesando si el backend no está respondiendo bien
        }
        // Error 4xx: descartar (error de validación, no reintentable).
      }
    }
    // Releer antes de guardar: lo que se encoló mientras se esperaba al servidor
    // no estaba en `queue` y se perdería al sobrescribir la cola con `remaining`.
    const procesadas = new Set(queue.map((a) => a.id));
    await conCandado(async () => {
      const encoladasDurante = (await getQueue()).filter((a) => !procesadas.has(a.id));
      await saveQueue([...remaining, ...encoladasDurante]);
    });
  } finally {
    flushing = false;
  }
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

export function isNetworkError(e: unknown): boolean {
  return axios.isAxiosError(e) && !e.response;
}

function isTransientError(e: unknown): boolean {
  if (!axios.isAxiosError(e)) return false;
  return isNetworkError(e) || (e.response?.status ?? 0) >= 500;
}

export async function withOffline<T>(
  endpoint: string,
  method: 'post' | 'patch',
  payload: object,
  fn: () => Promise<T>,
): Promise<T | null> {
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

export function usePendingCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const pendientes = await sincronizarPendientes();
        if (!cancelled) setCount(pendientes);
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

  return count;
}
