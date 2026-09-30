import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import {
  enqueue,
  flushQueue,
  isNetworkError,
  sincronizarPendientes,
  withOffline,
} from './offline-queue';

jest.mock('./api', () => ({
  api: { post: jest.fn(), patch: jest.fn() },
}));

const networkError = { isAxiosError: true, response: undefined };
const badRequestError = { isAxiosError: true, response: { status: 400 } };
const serverError = { isAxiosError: true, response: { status: 502 } };

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

  it('descarta la acción si el servidor responde 4xx (error de validación, no reintentable)', async () => {
    (api.post as jest.Mock).mockRejectedValueOnce(badRequestError);

    await enqueue({ endpoint: '/tracking/salida-dpi', method: 'post', payload: {} });
    await flushQueue();

    (api.post as jest.Mock).mockClear();
    await flushQueue();
    expect(api.post).not.toHaveBeenCalled(); // se descartó, no quedó en cola
  });

  it('mantiene la acción en cola si el servidor responde 5xx (falla transitoria, ej. cold start)', async () => {
    (api.post as jest.Mock).mockRejectedValueOnce(serverError);

    await enqueue({ endpoint: '/tracking/salida-dpi', method: 'post', payload: {} });
    await flushQueue();

    (api.post as jest.Mock).mockClear().mockResolvedValueOnce({ data: {} });
    await flushQueue();
    expect(api.post).toHaveBeenCalledTimes(1); // seguía en cola, se reintentó
  });

  it('detiene el flush en la primera acción con 5xx, sin intentar las siguientes, pero sin perderlas', async () => {
    (api.post as jest.Mock).mockRejectedValueOnce(serverError);

    await enqueue({ endpoint: '/tracking/a', method: 'post', payload: {} });
    await enqueue({ endpoint: '/tracking/b', method: 'post', payload: {} });
    await flushQueue();

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/tracking/a', {});

    (api.post as jest.Mock).mockClear().mockResolvedValue({ data: {} });
    await flushQueue();
    expect(api.post).toHaveBeenCalledTimes(2); // ninguna de las dos se perdió
    expect(api.post).toHaveBeenNthCalledWith(1, '/tracking/a', {});
    expect(api.post).toHaveBeenNthCalledWith(2, '/tracking/b', {});
  });

  it('detiene el flush en la primera acción sin red, sin intentar las siguientes, pero sin perderlas', async () => {
    (api.post as jest.Mock).mockRejectedValueOnce(networkError);

    await enqueue({ endpoint: '/tracking/a', method: 'post', payload: {} });
    await enqueue({ endpoint: '/tracking/b', method: 'post', payload: {} });
    await flushQueue();

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/tracking/a', {});

    (api.post as jest.Mock).mockClear().mockResolvedValue({ data: {} });
    await flushQueue();
    expect(api.post).toHaveBeenCalledTimes(2); // ninguna de las dos se perdió
    expect(api.post).toHaveBeenNthCalledWith(1, '/tracking/a', {});
    expect(api.post).toHaveBeenNthCalledWith(2, '/tracking/b', {});
  });
});

describe('flushQueue con acciones encoladas durante el envío', () => {
  it('no pierde una acción que se encola mientras el flush espera la respuesta del servidor', async () => {
    let responder!: () => void;
    (api.post as jest.Mock).mockImplementationOnce(
      () => new Promise((resolve) => { responder = () => resolve({ data: {} }); }),
    );

    await enqueue({ endpoint: '/tracking/a', method: 'post', payload: {} });
    const flush = flushQueue();
    await new Promise((r) => setImmediate(r)); // el flush ya está esperando el POST de /a
    await enqueue({ endpoint: '/tracking/b', method: 'post', payload: {} });
    responder();
    await flush;

    (api.post as jest.Mock).mockClear().mockResolvedValue({ data: {} });
    await flushQueue();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/tracking/b', {}); // /b sigue en cola, /a no se repite
  });
});

describe('enqueue concurrente', () => {
  it('no pierde ninguna de dos acciones encoladas al mismo tiempo', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: {} });

    await Promise.all([
      enqueue({ endpoint: '/tracking/a', method: 'post', payload: {} }),
      enqueue({ endpoint: '/tracking/b', method: 'post', payload: {} }),
    ]);
    await flushQueue();

    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it('no descarta una acción encolada durante el flush aunque caiga en el mismo milisegundo', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_790_000_000_000);
    let responder!: () => void;
    (api.post as jest.Mock).mockImplementationOnce(
      () => new Promise((resolve) => { responder = () => resolve({ data: {} }); }),
    );

    await enqueue({ endpoint: '/tracking/a', method: 'post', payload: {} });
    const flush = flushQueue();
    await new Promise((r) => setImmediate(r));
    await enqueue({ endpoint: '/tracking/b', method: 'post', payload: {} });
    responder();
    await flush;
    nowSpy.mockRestore();

    (api.post as jest.Mock).mockClear().mockResolvedValue({ data: {} });
    await flushQueue();
    expect(api.post).toHaveBeenCalledWith('/tracking/b', {});
  });
});

describe('sincronizarPendientes', () => {
  it('no llama al servidor y devuelve 0 si la cola está vacía', async () => {
    await expect(sincronizarPendientes()).resolves.toBe(0);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('reenvía lo pendiente sin esperar otra acción del operador y devuelve 0 si se envió', async () => {
    (api.post as jest.Mock).mockResolvedValueOnce({ data: {} });
    await enqueue({ endpoint: '/tracking/llegada-dpi', method: 'post', payload: { desdeOffline: true } });

    await expect(sincronizarPendientes()).resolves.toBe(0);
    expect(api.post).toHaveBeenCalledWith('/tracking/llegada-dpi', { desdeOffline: true });
  });

  it('devuelve cuántas acciones siguen pendientes si todavía no hay red', async () => {
    (api.post as jest.Mock).mockRejectedValueOnce(networkError);
    await enqueue({ endpoint: '/tracking/llegada-dpi', method: 'post', payload: {} });

    await expect(sincronizarPendientes()).resolves.toBe(1);
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

  it('encola con desdeOffline:true y devuelve null cuando el servidor responde 5xx (falla transitoria)', async () => {
    const fn = jest.fn().mockRejectedValue(serverError);
    (api.post as jest.Mock).mockResolvedValueOnce({ data: {} });

    const result = await withOffline('/tracking/salida-dpi', 'post', { foo: 'bar' }, fn);
    expect(result).toBeNull();

    await flushQueue();
    expect(api.post).toHaveBeenCalledWith('/tracking/salida-dpi', { foo: 'bar', desdeOffline: true });
  });
});
