import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ErrorEvent } from '@sentry/react';

const init = vi.fn();
const captureException = vi.fn();
vi.mock('@sentry/react', () => ({ init, captureException }));

describe('monitoreo (Sentry)', () => {
  beforeEach(() => {
    vi.resetModules();
    init.mockClear();
    captureException.mockClear();
  });

  it('sin DSN no carga Sentry y reportarError no hace nada', async () => {
    const m = await import('./monitoreo');
    expect(await m.iniciarMonitoreo('')).toBe(false);
    m.reportarError(new Error('x'));
    expect(init).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it('con DSN inicia sin datos personales ni trazas, y reporta errores', async () => {
    const m = await import('./monitoreo');
    expect(await m.iniciarMonitoreo('https://clave@o1.ingest.sentry.io/1')).toBe(true);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://clave@o1.ingest.sentry.io/1', sendDefaultPii: false, tracesSampleRate: 0 }),
    );
    const error = new Error('boom');
    m.reportarError(error, { componentStack: 'en Kits' });
    expect(captureException).toHaveBeenCalledWith(error, { extra: { componentStack: 'en Kits' } });
  });

  it('quita el # de las URLs (token del enlace de foto), cookies, cabeceras y datos del usuario', async () => {
    const { limpiarEvento } = await import('./monitoreo');
    const evento = {
      request: { url: 'https://web/foto-cda#token-secreto', cookies: { a: '1' }, headers: { Authorization: 'Bearer x' } },
      user: { id: 'u1', email: 'a@b.c', ip_address: '1.2.3.4' },
    } as unknown as ErrorEvent;
    const limpio = limpiarEvento(evento);
    expect(limpio.request?.url).toBe('https://web/foto-cda');
    expect(limpio.request?.cookies).toBeUndefined();
    expect(limpio.request?.headers).toBeUndefined();
    expect(limpio.user).toEqual({ id: 'u1' });
  });

  it('las migas de navegación tampoco llevan el #', async () => {
    const m = await import('./monitoreo');
    await m.iniciarMonitoreo('https://clave@o1.ingest.sentry.io/1');
    const { beforeBreadcrumb } = init.mock.calls[0][0];
    const miga = beforeBreadcrumb({ category: 'navigation', data: { from: '/foto-cda#tok', to: '/x#y' } });
    expect(miga.data).toEqual({ from: '/foto-cda', to: '/x' });
  });
});
