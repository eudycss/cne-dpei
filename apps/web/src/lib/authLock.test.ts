import { describe, it, expect, afterEach, vi } from 'vitest';
import { withTokenRefreshLock } from './authLock';

describe('withTokenRefreshLock', () => {
  const originalLocks = (navigator as any).locks;

  afterEach(() => {
    Object.defineProperty(navigator, 'locks', {
      value: originalLocks,
      configurable: true,
      writable: true,
    });
  });

  it('usa navigator.locks.request cuando existe', async () => {
    const request = vi.fn((_name: string, fn: () => Promise<unknown>) => fn());
    Object.defineProperty(navigator, 'locks', {
      value: { request },
      configurable: true,
      writable: true,
    });

    const fn = vi.fn().mockResolvedValue('resultado');
    const result = await withTokenRefreshLock(fn);

    expect(request).toHaveBeenCalledWith('cne-token-refresh', fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe('resultado');
  });

  it('serializa llamadas concurrentes cuando navigator.locks existe', async () => {
    let active = 0;
    let maxActive = 0;
    const request = vi.fn(async (_name: string, fn: () => Promise<unknown>) => {
      // Emula el comportamiento real de Web Locks: una llamada a la vez.
      while (active > 0) {
        await Promise.resolve();
      }
      active++;
      try {
        return await fn();
      } finally {
        active--;
      }
    });
    Object.defineProperty(navigator, 'locks', {
      value: { request },
      configurable: true,
      writable: true,
    });

    const order: number[] = [];
    const makeTask = (id: number) => async () => {
      maxActive = Math.max(maxActive, active);
      order.push(id);
      return id;
    };

    await Promise.all([
      withTokenRefreshLock(makeTask(1)),
      withTokenRefreshLock(makeTask(2)),
    ]);

    expect(maxActive).toBeLessThanOrEqual(1);
  });

  it('ejecuta la función directamente si navigator.locks no existe (fallback)', async () => {
    Object.defineProperty(navigator, 'locks', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const fn = vi.fn().mockResolvedValue('sin-lock');
    const result = await withTokenRefreshLock(fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(result).toBe('sin-lock');
  });

  it('propaga el rechazo si la función falla', async () => {
    Object.defineProperty(navigator, 'locks', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const fn = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(withTokenRefreshLock(fn)).rejects.toThrow('boom');
  });
});
