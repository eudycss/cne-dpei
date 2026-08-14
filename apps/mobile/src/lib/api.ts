import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';

// EXPO_PUBLIC_API_URL en .env (dev client local) o eas.json (EAS Build).
// La app requiere prebuild nativo (background location, config plugins) y
// nunca corre en Expo Go, así que no hay rama storeClient que resolver.
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://cne-imbabura-api.onrender.com';

const ACCESS_KEY = 'cne.access';
const REFRESH_KEY = 'cne.refresh';

export const tokenStore = {
  getAccess: () => SecureStore.getItemAsync(ACCESS_KEY),
  getRefresh: () => SecureStore.getItemAsync(REFRESH_KEY),
  set: async (access: string, refresh: string) => {
    await SecureStore.setItemAsync(ACCESS_KEY, access);
    await SecureStore.setItemAsync(REFRESH_KEY, refresh);
  },
  clear: async () => {
    await SecureStore.deleteItemAsync(ACCESS_KEY);
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  },
};

export const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  // Render free tier hace cold-start del backend (30-50s documentados) tras
  // inactividad: 15s se quedaba corto y disparaba el catch de "refresh
  // fallido" por timeout, no por token inválido.
  timeout: 45000,
});

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await tokenStore.getAccess();
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshing: Promise<string> | null = null;

// Emisor simple de eventos: AuthContext se suscribe para enterarse cuando
// api.ts invalida la sesión (401/403 real de /auth/refresh) y así reflejar
// el logout en la UI en vez de dejar una sesión "zombie".
const sessionExpiredListeners = new Set<() => void>();

export function onSessionExpired(cb: () => void): () => void {
  sessionExpiredListeners.add(cb);
  return () => sessionExpiredListeners.delete(cb);
}

function notifySessionExpired(): void {
  sessionExpiredListeners.forEach((cb) => cb());
}

/** true solo si el propio /auth/refresh respondió 401/403 (rechazo explícito). */
function isRefreshRejection(err: unknown): boolean {
  return axios.isAxiosError(err) && (err.response?.status === 401 || err.response?.status === 403);
}

api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const original = err.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (err.response?.status !== 401 || original._retry) return Promise.reject(err);
    const refresh = await tokenStore.getRefresh();
    if (!refresh) return Promise.reject(err);
    try {
      if (!refreshing) {
        refreshing = axios
          .post(`${BASE_URL}/auth/refresh`, { refreshToken: refresh })
          .then(async (r) => {
            await tokenStore.set(r.data.accessToken, r.data.refreshToken);
            return r.data.accessToken;
          })
          .finally(() => {
            refreshing = null;
          });
      }
      const newAccess = await refreshing;
      original._retry = true;
      original.headers.Authorization = `Bearer ${newAccess}`;
      return api(original);
    } catch (refreshErr) {
      // Timeout, error de red o 5xx (p. ej. cold-start de Render) no
      // significan que el refresh token sea inválido: solo tratamos la
      // sesión como expirada si /auth/refresh rechazó explícitamente con
      // 401/403. En cualquier otro caso propagamos el error original sin
      // tocar SecureStore ni notificar a la UI.
      if (isRefreshRejection(refreshErr)) {
        await tokenStore.clear();
        notifySessionExpired();
      }
      return Promise.reject(err);
    }
  },
);
