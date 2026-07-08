import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { enqueue, flushQueue, isNetworkError, withOffline } from './offline-queue';

jest.mock('./api', () => ({
  api: { post: jest.fn(), patch: jest.fn() },
}));

const networkError = { isAxiosError: true, response: undefined };
const badRequestError = { isAxiosError: true, response: { status: 400 } };

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

describe('isNetworkError', () => {
  it('es true para un error de axios sin response (sin señal)', () => {
    expect(isNetworkError(networkError)).toBe(true);
  });

  it('es false para un error de axios con response (4xx/5xx)', () => {
    expect(isNetworkError(badRequestError)).toBe(false);
  });

  it('es false para un error que no es de axios', () => {
    expect(isNetworkError(new Error('boom'))).toBe(false);
  });
});

describe('enqueue + flushQueue', () => {
  it('reenvía una acción encolada y la retira de la cola si el POST responde bien', async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({ data: { id: '1' } });

    await enqueue({ endpoint: '/tracking/salida-dpi', method: 'post', payload: { foo: 'bar' } });
    await flushQueue();

    expect(api.post).toHaveBeenCalledWith('/tracking/salida-dpi', { foo: 'bar' });

    (api.post as jest.Mock).mockClear();
    await flushQueue();
    expect(api.post).not.toHaveBeenCalled(); // la cola ya quedó vacía
  });

  it('mantiene la acción en cola si sigue sin haber red (no la descarta)', async () => {
    (api.post as jest.Mock).mockRejectedValueOnce(networkError);

    await enqueue({ endpoint: '/tracking/salida-dpi', method: 'post', payload: {} });
    await flushQueue();

    (api.post as jest.Mock).mockClear().mockResolvedValueOnce({ data: {} });
    await flushQueue();
    expect(api.post).toHaveBeenCalledTimes(1); // seguía en cola, se reintentó
  });

  it('descarta la acción si el servidor responde 4xx/5xx (no reintentable)', async () => {
    (api.post as jest.Mock).mockRejectedValueOnce(badRequestError);

    await enqueue({ endpoint: '/tracking/salida-dpi', method: 'post', payload: {} });
    await flushQueue();

    (api.post as jest.Mock).mockClear();
    await flushQueue();
    expect(api.post).not.toHaveBeenCalled(); // se descartó, no quedó en cola
  });

  it('detiene el flush en la primera acción sin red, sin intentar las siguientes', async () => {
    (api.post as jest.Mock)
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({ data: {} });

    await enqueue({ endpoint: '/tracking/a', method: 'post', payload: {} });
    await enqueue({ endpoint: '/tracking/b', method: 'post', payload: {} });
    await flushQueue();

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/tracking/a', {});
  });
});

describe('withOffline', () => {
  it('devuelve el resultado de fn() sin encolar cuando hay red', async () => {
    const fn = jest.fn().mockResolvedValue({ id: '1' });

    const result = await withOffline('/tracking/salida-dpi', 'post', { foo: 'bar' }, fn);

    expect(result).toEqual({ id: '1' });
    expect(api.post).not.toHaveBeenCalled();
  });

  it('encola con desdeOffline:true y devuelve null cuando no hay red', async () => {
    const fn = jest.fn().mockRejectedValue(networkError);
    (api.post as jest.Mock).mockResolvedValueOnce({ data: {} });

    const result = await withOffline('/tracking/salida-dpi', 'post', { foo: 'bar' }, fn);
    expect(result).toBeNull();

    await flushQueue();
    expect(api.post).toHaveBeenCalledWith('/tracking/salida-dpi', { foo: 'bar', desdeOffline: true });
  });

  it('relanza el error si no es de red (ej. 400 de validación)', async () => {
    const fn = jest.fn().mockRejectedValue(badRequestError);

    await expect(withOffline('/tracking/salida-dpi', 'post', {}, fn)).rejects.toBe(badRequestError);
    expect(api.post).not.toHaveBeenCalled(); // no se encoló
  });
});
