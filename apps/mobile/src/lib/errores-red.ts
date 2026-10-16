import axios from 'axios';

export function isNetworkError(e: unknown): boolean {
  return axios.isAxiosError(e) && !e.response;
}

/** Sin red o error del servidor (5xx, p. ej. Render despertando): vale la pena reintentar. */
export function isTransientError(e: unknown): boolean {
  if (!axios.isAxiosError(e)) return false;
  return isNetworkError(e) || (e.response?.status ?? 0) >= 500;
}
