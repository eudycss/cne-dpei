/**
 * Serializa la renovación del refresh token entre pestañas del mismo origen
 * usando la Web Locks API.
 *
 * El refresh token del backend es de un solo uso (rotación): si dos pestañas
 * intentan refrescar casi al mismo tiempo, la segunda llega con un refresh
 * token ya invalidado por la primera y termina borrando los tokens recién
 * guardados. `navigator.locks.request` asegura que solo una pestaña ejecute
 * la renovación a la vez; las demás esperan su turno.
 *
 * Si el entorno no soporta Web Locks (navegadores viejos, jsdom en tests),
 * se ejecuta la función directamente sin serializar entre pestañas — sigue
 * habiendo dedupe dentro de la misma pestaña vía la variable `refreshing`
 * en `api.ts`.
 */
const LOCK_NAME = 'cne-token-refresh';

export function withTokenRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== 'function') {
    return fn();
  }
  return locks.request(LOCK_NAME, fn);
}
