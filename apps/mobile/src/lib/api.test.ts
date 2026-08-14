jest.mock('axios', () => {
  const instance: any = jest.fn((config: any) => Promise.resolve({ config, retried: true }));
  instance.interceptors = {
    request: { use: jest.fn() },
    response: { use: jest.fn() },
  };
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => instance),
      post: jest.fn(),
      // Implementación mínima suficiente para los tests: los errores axios
      // reales (rechazo HTTP, timeout, network error) traen isAxiosError=true.
      isAxiosError: (err: any) => !!err && err.isAxiosError === true,
    },
  };
});

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('expo-constants', () => ({ executionEnvironment: 'bare' }));

import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import { onSessionExpired, tokenStore } from './api';

const mockInstance = (axios.create as jest.Mock).mock.results[0].value;
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

beforeEach(() => {
  jest.clearAllMocks();
});

describe('request interceptor', () => {
  it('agrega Authorization si hay token y el header no está seteado', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('token-123');
    const config = { headers: {} };

    const result = await requestInterceptor(config);

    expect(result.headers.Authorization).toBe('Bearer token-123');
  });

  it('no toca el header si ya viene seteado', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('token-123');
    const config = { headers: { Authorization: 'Bearer existente' } };

    const result = await requestInterceptor(config);

    expect(result.headers.Authorization).toBe('Bearer existente');
  });

  it('no agrega header si no hay token', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
    const config = { headers: {} };

    const result = await requestInterceptor(config);

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

  it('rechaza sin llamar refresh si no hay refresh token guardado', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(null);
    const err = { response: { status: 401 }, config: { headers: {} } };

    await expect(responseErrorHandler(err)).rejects.toBe(err);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('renueva el token y reintenta la request original si el refresh funciona', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('refresh-token');
    (axios.post as jest.Mock).mockResolvedValueOnce({
      data: { accessToken: 'nuevo-access', refreshToken: 'nuevo-refresh' },
    });
    const original: any = { headers: {} };
    const err = { response: { status: 401 }, config: original };

    const result = await responseErrorHandler(err);

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('cne.access', 'nuevo-access');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('cne.refresh', 'nuevo-refresh');
    expect(original.headers.Authorization).toBe('Bearer nuevo-access');
    expect(original._retry).toBe(true);
    expect(mockInstance).toHaveBeenCalledWith(original);
    expect(result).toEqual({ config: original, retried: true });
  });

  it('limpia los tokens, notifica sesión expirada y rechaza si /auth/refresh responde 401', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('refresh-token');
    (axios.post as jest.Mock).mockRejectedValueOnce(httpError(401));
    const listener = jest.fn();
    const unsubscribe = onSessionExpired(listener);
    const err = { response: { status: 401 }, config: { headers: {} } };

    await expect(responseErrorHandler(err)).rejects.toBe(err);

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('cne.access');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('cne.refresh');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('limpia los tokens y notifica sesión expirada si /auth/refresh responde 403', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('refresh-token');
    (axios.post as jest.Mock).mockRejectedValueOnce(httpError(403));
    const listener = jest.fn();
    const unsubscribe = onSessionExpired(listener);
    const err = { response: { status: 401 }, config: { headers: {} } };

    await expect(responseErrorHandler(err)).rejects.toBe(err);

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('cne.access');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('NO limpia tokens ni notifica si /auth/refresh falla por timeout', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('refresh-token');
    (axios.post as jest.Mock).mockRejectedValueOnce(networkError('timeout of 45000ms exceeded'));
    const listener = jest.fn();
    const unsubscribe = onSessionExpired(listener);
    const err = { response: { status: 401 }, config: { headers: {} } };

    await expect(responseErrorHandler(err)).rejects.toBe(err);

    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('NO limpia tokens ni notifica si /auth/refresh falla por error de red', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('refresh-token');
    (axios.post as jest.Mock).mockRejectedValueOnce(networkError('Network Error'));
    const err = { response: { status: 401 }, config: { headers: {} } };

    await expect(responseErrorHandler(err)).rejects.toBe(err);

    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('NO limpia tokens ni notifica si /auth/refresh responde 502 (cold-start de Render)', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('refresh-token');
    (axios.post as jest.Mock).mockRejectedValueOnce(httpError(502));
    const err = { response: { status: 401 }, config: { headers: {} } };

    await expect(responseErrorHandler(err)).rejects.toBe(err);

    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('dedupe: dos 401 concurrentes solo disparan un POST /auth/refresh', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue('refresh-token');
    (axios.post as jest.Mock).mockResolvedValueOnce({
      data: { accessToken: 'nuevo-access', refreshToken: 'nuevo-refresh' },
    });
    const err1 = { response: { status: 401 }, config: { headers: {} } };
    const err2 = { response: { status: 401 }, config: { headers: {} } };

    await Promise.all([responseErrorHandler(err1), responseErrorHandler(err2)]);

    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});

describe('onSessionExpired', () => {
  it('permite desuscribirse', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce('refresh-token');
    (axios.post as jest.Mock).mockRejectedValueOnce(httpError(401));
    const listener = jest.fn();
    const unsubscribe = onSessionExpired(listener);
    unsubscribe();

    const err = { response: { status: 401 }, config: { headers: {} } };
    await expect(responseErrorHandler(err)).rejects.toBe(err);

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('tokenStore', () => {
  it('set guarda access y refresh', async () => {
    await tokenStore.set('a', 'r');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('cne.access', 'a');
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('cne.refresh', 'r');
  });

  it('clear borra access y refresh', async () => {
    await tokenStore.clear();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('cne.access');
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith('cne.refresh');
  });
});
