import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Orden de resolución del backend:
// 1) EXPO_PUBLIC_API_URL (.env) — necesario en dispositivo físico: debe ser la
//    IP LAN de la PC (p. ej. http://192.168.1.50:3000). Si está definida, gana.
// 2) extra.apiUrl de app.json.
// 3) En emulador Android, "localhost" apunta al propio emulador; se traduce al
//    alias del host 10.0.2.2. iOS simulator y web sí resuelven localhost.
function resolveBaseUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv;

  const configured =
    (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://localhost:3000';
  if (Platform.OS === 'android') {
    return configured.replace(/(\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/, '$110.0.2.2');
  }
  return configured;
}

const BASE_URL = resolveBaseUrl();

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
  timeout: 15000,
});

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await tokenStore.getAccess();
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshing: Promise<string> | null = null;

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
    } catch {
      await tokenStore.clear();
      return Promise.reject(err);
    }
  },
);
