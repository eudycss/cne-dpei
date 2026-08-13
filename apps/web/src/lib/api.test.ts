import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('axios', () => {
  const instance: any = vi.fn((config: any) => Promise.resolve({ config, retried: true }));
  instance.interceptors = {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  };
  return {
    __esModule: true,
    default: {
      create: vi.fn(() => instance),
      post: vi.fn(),
      // Implementación mínima suficiente para los tests: los errores axios
      // reales (rechazo HTTP, timeout, network error) traen isAxiosError=true.
      isAxiosError: (err: any) => !!err && err.isAxiosError === true,
    },
  };
});

import axios from 'axios';
import { tokenStore } from './api';

const mockInstance = (axios.create as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
// Capturados una sola vez: clearAllMocks() en cada test borra el historial de
// llamadas (.mock.calls), y el registro de interceptores solo ocurre al importar api.ts.
const requestInterceptor = mockInstance.interceptors.request.use.mock.calls[0][0];
const responseErrorHandler = mockInstance.interceptors.response.use.mock.calls[0][1];

/** Error axios de rechazo HTTP explícito (p. ej. refresh token inválido). */
function httpError(status: number) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status },
  });
}

/** Error axios sin response: timeout o falla de red (cold-start de Render). */
function networkError(message = 'timeout of 45000ms exceeded') {
  return Object.assign(new Error(message), { isAxiosError: true });
}

// jsdom expone window.location.assign como no configurable en algunas
// versiones, así que vi.spyOn falla con "Cannot redefine property". En vez
// de eso, reemplazamos window.location completo por un objeto con un spy.
const originalLocation = window.location;
let assignSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  assignSpy = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, assign: assignSpy },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
});

describe('request interceptor', () => {
  it('agrega Authorization si hay token y el header no está seteado', () => {
    localStorage.setItem('cne.access', 'token-123');
    const config = { headers: {} };

    const result = requestInterceptor(config);

    expect(result.headers.Authorization).toBe('Bearer token-123');
  });

  it('no toca el header si ya viene seteado', () => {
    localStorage.setItem('cne.access', 'token-123');
    const config = { headers: { Authorization: 'Bearer existente' } };

    const result = requestInterceptor(config);

    expect(result.headers.Authorization).toBe('Bearer existente');
  });

  it('no agrega header si no hay token', () => {
    const config = { headers: {} };

    const result = requestInterceptor(config);

    expect(result.headers.Authorization).toBeUndefined();
  });
});

describe('response interceptor — refresh en 401', () => {
  it('rechaza directo si el error no es 401', async () => {
    const err = { response: { status: 500 }, config: { headers: {} } };
    await expect(responseErrorHandler(err)).rejects.toBe(err);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('rechaza sin reintentar si original._retry ya está en true', async () => {
    const err = { response: { status: 401 }, config: { headers: {}, _retry: true } };
    await expect(responseErrorHandler(err)).rejects.toBe(err);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('limpia tokens y redirige a /login si no hay refresh token guardado', async () => {
    const err = { response: { status: 401 }, config: { headers: {} } };

    await expect(responseErrorHandler(err)).rejects.toBe(err);

    expect(axios.post).not.toHaveBeenCalled();
    expect(assignSpy).toHaveBeenCalledWith('/login');
  });

  it('renueva el token y reintenta la request original si el refresh funciona', async () => {
    localStorage.setItem('cne.refresh', 'refresh-token');
    (axios.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { accessToken: 'nuevo-access', refreshToken: 'nuevo-refresh' },
    });
    const original: any = { headers: {} };
    const err = { response: { status: 401 }, config: original };

    const result = await responseErrorHandler(err);

    expect(tokenStore.getAccess()).toBe('nuevo-access');
    expect(tokenStore.getRefresh()).toBe('nuevo-refresh');
    expect(original.headers.Authorization).toBe('Bearer nuevo-access');
    expect(original._retry).toBe(true);
    expect(mockInstance).toHaveBeenCalledWith(original);
    expect(result).toEqual({ config: original, retried: true });
  });

  it('limpia los tokens y redirige a /login si /auth/refresh responde 401', async () => {
    localStorage.setItem('cne.refresh', 'refresh-token');
    (axios.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(httpError(401));
    const err = { response: { status: 401 }, config: { headers: {} } };

    await expect(responseErrorHandler(err)).rejects.toBe(err);

    expect(tokenStore.getAccess()).toBeNull();
    expect(tokenStore.getRefresh()).toBeNull();
    expect(assignSpy).toHaveBeenCalledWith('/login');
  });

  it('limpia los tokens y redirige a /login si /auth/refresh responde 403', async () => {
    localStorage.setItem('cne.refresh', 'refresh-token');
    (axios.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(httpError(403));
    const err = { response: { status: 401 }, config: { headers: {} } };

    await expect(responseErrorHandler(err)).rejects.toBe(err);

    expect(tokenStore.getAccess()).toBeNull();
    expect(assignSpy).toHaveBeenCalledWith('/login');
  });

  it('NO limpia tokens ni redirige si /auth/refresh falla por timeout', async () => {
    localStorage.setItem('cne.access', 'access-viejo');
    localStorage.setItem('cne.refresh', 'refresh-token');
    (axios.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      networkError('timeout of 45000ms exceeded'),
    );
    const err = { response: { status: 401 }, config: { headers: {} } };

    await expect(responseErrorHandler(err)).rejects.toBe(err);

    expect(tokenStore.getAccess()).toBe('access-viejo');
    expect(tokenStore.getRefresh()).toBe('refresh-token');
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('NO limpia tokens ni redirige si /auth/refresh falla por error de red', async () => {
    localStorage.setItem('cne.access', 'access-viejo');
    localStorage.setItem('cne.refresh', 'refresh-token');
    (axios.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(networkError('Network Error'));
    const err = { response: { status: 401 }, config: { headers: {} } };

    await expect(responseErrorHandler(err)).rejects.toBe(err);

    expect(tokenStore.getAccess()).toBe('access-viejo');
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('NO limpia tokens ni redirige si /auth/refresh responde 502 (cold-start de Render)', async () => {
    localStorage.setItem('cne.access', 'access-viejo');
    localStorage.setItem('cne.refresh', 'refresh-token');
    (axios.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(httpError(502));
    const err = { response: { status: 401 }, config: { headers: {} } };

    await expect(responseErrorHandler(err)).rejects.toBe(err);

    expect(tokenStore.getAccess()).toBe('access-viejo');
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it('dedupe: dos 401 concurrentes solo disparan un POST /auth/refresh', async () => {
    localStorage.setItem('cne.refresh', 'refresh-token');
    (axios.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { accessToken: 'nuevo-access', refreshToken: 'nuevo-refresh' },
    });
    const err1 = { response: { status: 401 }, config: { headers: {} } };
    const err2 = { response: { status: 401 }, config: { headers: {} } };

    await Promise.all([responseErrorHandler(err1), responseErrorHandler(err2)]);

    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});

describe('tokenStore', () => {
  it('set guarda access y refresh', () => {
    tokenStore.set('a', 'r');
    expect(localStorage.getItem('cne.access')).toBe('a');
    expect(localStorage.getItem('cne.refresh')).toBe('r');
  });

  it('clear borra access y refresh', () => {
    localStorage.setItem('cne.access', 'a');
    localStorage.setItem('cne.refresh', 'r');
    tokenStore.clear();
    expect(localStorage.getItem('cne.access')).toBeNull();
    expect(localStorage.getItem('cne.refresh')).toBeNull();
  });
});
