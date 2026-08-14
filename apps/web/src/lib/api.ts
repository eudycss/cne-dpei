import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { withTokenRefreshLock } from './authLock';

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

const ACCESS_KEY = 'cne.access';
const REFRESH_KEY = 'cne.refresh';

export const tokenStore = {
  getAccess: () => localStorage.getItem(ACCESS_KEY),
  getRefresh: () => localStorage.getItem(REFRESH_KEY),
  set: (access: string, refresh: string) => {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  },
  clear: () => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  },
};

export const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  // Render free tier hace cold-start del backend (30-50s documentados) tras
  // inactividad: 15s se quedaba corto y disparaba el catch de "refresh
  // fallido" por timeout, no por token inválido.
  timeout: 45000,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStore.getAccess();
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshing: Promise<string> | null = null;

/** true solo si el propio /auth/refresh respondió 401/403 (rechazo explícito). */
function isRefreshRejection(err: unknown): boolean {
  return axios.isAxiosError(err) && (err.response?.status === 401 || err.response?.status === 403);
}

async function refreshAccessToken(): Promise<string> {
  if (refreshing) return refreshing;
  refreshing = withTokenRefreshLock(async () => {
    // Otra pestaña pudo haber ganado la carrera de refresh mientras
    // esperábamos el lock: releemos el storage en vez de reusar el token
    // que teníamos capturado antes de entrar aquí.
    const currentRefresh = tokenStore.getRefresh();
    if (!currentRefresh) {
      throw new Error('No hay refresh token disponible');
    }
    const r = await axios.post(`${BASE_URL}/auth/refresh`, { refreshToken: currentRefresh });
    tokenStore.set(r.data.accessToken, r.data.refreshToken);
    return r.data.accessToken as string;
  }).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

api.interceptors.response.use(
  (res) => res,
  async (err: AxiosError) => {
    const original = err.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (err.response?.status !== 401 || original._retry) {
      return Promise.reject(err);
    }
    const refresh = tokenStore.getRefresh();
    if (!refresh) {
      tokenStore.clear();
      window.location.assign('/login');
      return Promise.reject(err);
    }
    try {
      const newAccess = await refreshAccessToken();
      original._retry = true;
      original.headers.Authorization = `Bearer ${newAccess}`;
      return api(original);
    } catch (refreshErr) {
      // Timeout, error de red o 5xx (p. ej. cold-start de Render) no
      // significan que el refresh token sea inválido: solo lo tratamos
      // como sesión expirada si /auth/refresh rechazó explícitamente con
      // 401/403. En cualquier otro caso propagamos el error original sin
      // tocar el storage de tokens.
      if (isRefreshRejection(refreshErr)) {
        tokenStore.clear();
        window.location.assign('/login');
      }
      return Promise.reject(err);
    }
  },
);
