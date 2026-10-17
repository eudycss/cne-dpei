import axios from 'axios';

export function isNetworkError(e: unknown): boolean {
  return axios.isAxiosError(e) && !e.response;
}

/** Sin red o error del servidor (5xx, p. ej. Render despertando): vale la pena reintentar. */
export function isTransientError(e: unknown): boolean {
  if (!axios.isAxiosError(e)) return false;
  return isNetworkError(e) || (e.response?.status ?? 0) >= 500;
}

/**
 * Para la cola offline: además de red y 5xx, se reintenta más tarde ante
 * 401 (sesión sin token, p. ej. tras un login sin conexión, o vencida),
 * 408 (timeout) y 429 (demasiadas peticiones). Ninguno dice que el registro
 * sea inválido, así que no se debe dar por rechazado.
 */
export function esReintentableEnCola(e: unknown): boolean {
  if (isTransientError(e)) return true;
  const status = axios.isAxiosError(e) ? e.response?.status : undefined;
  return status === 401 || status === 408 || status === 429;
}

/** 409: el servidor ya tenía ese registro (p. ej. se envió, pero la respuesta se perdió). */
export function esYaRegistrado(e: unknown): boolean {
  return axios.isAxiosError(e) && e.response?.status === 409;
}
