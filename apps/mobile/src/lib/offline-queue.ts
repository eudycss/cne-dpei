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

export async function enqueue(item: Omit<QueuedAction, 'id' | 'enqueuedAt'>): Promise<void> {
  const queue = await getQueue();
  queue.push({ ...item, id: Date.now().toString(), enqueuedAt: new Date().toISOString() });
  await saveQueue(queue);
}

let flushing = false;

export async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const queue = await getQueue();
    if (queue.length === 0) return;
    const remaining: QueuedAction[] = [];
    for (const action of queue) {
      try {
        await api[action.method](action.endpoint, action.payload);
      } catch (e) {
        if (axios.isAxiosError(e) && !e.response) {
          // Aún sin red: mantener en cola.
          remaining.push(action);
          break; // no seguir procesando si no hay red
        }
        // Error 4xx/5xx: descartar (no reintentable).
      }
    }
    await saveQueue(remaining);
  } finally {
    flushing = false;
  }
}

export function isNetworkError(e: unknown): boolean {
  return axios.isAxiosError(e) && !e.response;
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
    if (isNetworkError(e)) {
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
      const q = await getQueue();
      if (!cancelled) setCount(q.length);
    };

    refresh();

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refresh();
        flushQueue();
      }
    });

    // ponytail: polling cada 15s para actualizar el badge si flush completó en background
    const interval = setInterval(refresh, 15_000);

    return () => {
      cancelled = true;
      appStateSub.remove();
      clearInterval(interval);
    };
  }, []);

  return count;
}
