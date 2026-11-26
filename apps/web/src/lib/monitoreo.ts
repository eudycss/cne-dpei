import type { ErrorEvent, EventHint } from '@sentry/react';

type SentryModulo = typeof import('@sentry/react');

let sentry: SentryModulo | null = null;

/**
 * Activa el reporte de errores a Sentry solo si hay VITE_SENTRY_DSN. El SDK se
 * descarga aparte (import dinámico) para no engordar el bundle inicial, y nunca
 * envía datos personales: sin IP, sin cookies, y sin el # de las URLs (ahí va el
 * token del enlace de foto CDA).
 */
export async function iniciarMonitoreo(dsn = import.meta.env.VITE_SENTRY_DSN): Promise<boolean> {
  if (!dsn) return false;
  try {
    const modulo = await import('@sentry/react');
    modulo.init({
      dsn,
      environment: import.meta.env.MODE,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend: limpiarEvento,
      beforeBreadcrumb: (miga) => {
        if (miga.data) {
          for (const clave of ['url', 'from', 'to'] as const) {
            if (typeof miga.data[clave] === 'string') miga.data[clave] = sinFragmento(miga.data[clave]);
          }
        }
        return miga;
      },
    });
    sentry = modulo;
    return true;
  } catch {
    // Sin red o bloqueado por el navegador: la app sigue igual, solo sin reportes.
    return false;
  }
}

/** Reporta un error capturado a mano (p. ej. en un ErrorBoundary). No hace nada sin Sentry. */
export function reportarError(error: unknown, contexto?: Record<string, unknown>): void {
  sentry?.captureException(error, contexto ? { extra: contexto } : undefined);
}

export function limpiarEvento(evento: ErrorEvent, _hint?: EventHint): ErrorEvent {
  if (evento.request?.url) evento.request.url = sinFragmento(evento.request.url);
  if (evento.request) {
    delete evento.request.cookies;
    delete evento.request.headers;
  }
  if (evento.user) evento.user = { id: evento.user.id };
  return evento;
}

export function sinFragmento(url: string): string {
  const i = url.indexOf('#');
  return i === -1 ? url : url.slice(0, i);
}
