import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

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
  timeout: 15000,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStore.getAccess();
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
      if (!refreshing) {
        refreshing = axios
          .post(`${BASE_URL}/auth/refresh`, { refreshToken: refresh })
          .then((r) => {
            tokenStore.set(r.data.accessToken, r.data.refreshToken);
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
      tokenStore.clear();
      window.location.assign('/login');
      return Promise.reject(err);
    }
  },
);
