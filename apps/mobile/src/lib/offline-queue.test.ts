import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { FotoMilitarPerdidaError, resolverFotoMilitarEnPayload } from './offline-foto-militar';
import {
  contarPendientes,
  descartarRechazadas,
  enqueue,
  flushQueue,
  isNetworkError,
  leerRechazadas,
  sincronizarPendientes,
  vaciarCola,
  withOffline,
} from './offline-queue';

jest.mock('./api', () => ({
  api: { post: jest.fn(), patch: jest.fn() },
}));

jest.mock('./offline-foto-militar', () => {
  class FotoMilitarPerdidaError extends Error {}
  return {
    FotoMilitarPerdidaError,
    resolverFotoMilitarEnPayload: jest.fn(async (p: object) => p),
  };
});

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

  it('con 4xx no reintenta la acción, pero la guarda como rechazada con el motivo del servidor', async () => {
    (api.post as jest.Mock).mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 400, data: { message: 'Estás a 900 m del recinto.' } },
    });

    await enqueue({ endpoint: '/tracking/llegada-recinto', method: 'post', payload: {} });
    await flushQueue();

    (api.post as jest.Mock).mockClear();
    await flushQueue();
    expect(api.post).not.toHaveBeenCalled(); // no quedó en cola
    const rechazadas = await leerRechazadas();
    expect(rechazadas).toHaveLength(1);
    expect(rechazadas[0]).toMatchObject({ endpoint: '/tracking/llegada-recinto', motivo: 'Estás a 900 m del recinto.' });
  });

  it('usa un motivo genérico si el 4xx no trae mensaje, y une los mensajes en lista', async () => {
    (api.post as jest.Mock)
      .mockRejectedValueOnce(badRequestError)
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 400, data: { message: ['a', 'b'] } } });
    await enqueue({ endpoint: '/tracking/salida-dpi', method: 'post', payload: {} });
    await enqueue({ endpoint: '/incidencias', method: 'post', payload: {} });

    await flushQueue();

    expect((await leerRechazadas()).map((r) => r.motivo)).toEqual(['El servidor no aceptó el registro.', 'a. b']);
  });

  it('descartarRechazadas quita solo los avisos vistos, no uno que llegó después', async () => {
    (api.post as jest.Mock).mockRejectedValueOnce(badRequestError);
    await enqueue({ endpoint: '/tracking/salida-dpi', method: 'post', payload: {} });
    await flushQueue();
    const vistos = (await leerRechazadas()).map((r) => r.id);
    (api.post as jest.Mock).mockRejectedValueOnce(badRequestError);
    await enqueue({ endpoint: '/incidencias', method: 'post', payload: {} });
    await flushQueue();

    await descartarRechazadas(vistos);

    expect((await leerRechazadas()).map((r) => r.endpoint)).toEqual(['/incidencias']);
  });

  it.each([401, 408, 429])('con %i conserva la acción en cola (no es un rechazo del registro)', async (status) => {
    (api.post as jest.Mock).mockRejectedValueOnce({ isAxiosError: true, response: { status } });
    await enqueue({ endpoint: '/tracking/llegada-recinto', method: 'post', payload: {} });

    await flushQueue();

    await expect(contarPendientes()).resolves.toBe(1);
    await expect(leerRechazadas()).resolves.toEqual([]);
  });

  it('con 409 (ya registrado) la da por enviada sin aviso de rechazo', async () => {
    (api.post as jest.Mock).mockRejectedValueOnce({ isAxiosError: true, response: { status: 409 } });
    await enqueue({ endpoint: '/tracking/llegada-recinto', method: 'post', payload: {} });

    await flushQueue();

    await expect(contarPendientes()).resolves.toBe(0);
    await expect(leerRechazadas()).resolves.toEqual([]);
  });

  it('no avisa rechazos de posiciones GPS (serían ruido)', async () => {
    (api.post as jest.Mock).mockRejectedValueOnce(badRequestError);
    await enqueue({ endpoint: '/tracking/posiciones', method: 'post', payload: {} });

    await flushQueue();

    await expect(contarPendientes()).resolves.toBe(0);
    await expect(leerRechazadas()).resolves.toEqual([]);
  });

  it('una cola corrupta en el almacenamiento no deja la app sin poder encolar', async () => {
    await AsyncStorage.setItem('cne:offline_queue', '{roto');

    await enqueue({ endpoint: '/tracking/salida-dpi', method: 'post', payload: {} });

    await expect(contarPendientes()).resolves.toBe(1);
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

describe('foto del militar pendiente en la cola', () => {
  it('sube la foto antes de enviar la recepción del kit y manda la URL real', async () => {
    (resolverFotoMilitarEnPayload as jest.Mock).mockImplementationOnce(async (p: object) => ({
      ...p,
      fotoMilitarUrl: 'militares/abc.bin',
    }));
    (api.post as jest.Mock).mockResolvedValue({ data: {} });
    await enqueue({
      endpoint: '/tracking/recepcion-kit',
      method: 'post',
      payload: { kitId: 'k1', fotoMilitarUrl: 'pendiente:foto-militar:ev1_r1' },
    });

    await flushQueue();

    expect(api.post).toHaveBeenCalledWith('/tracking/recepcion-kit', { kitId: 'k1', fotoMilitarUrl: 'militares/abc.bin' });
    await expect(sincronizarPendientes()).resolves.toBe(0);
  });

  it('si la foto aún no sube por falta de señal, conserva la recepción y lo que viene detrás', async () => {
    (resolverFotoMilitarEnPayload as jest.Mock).mockRejectedValueOnce(networkError);
    await enqueue({ endpoint: '/tracking/recepcion-kit', method: 'post', payload: { kitId: 'k1' } });
    await enqueue({ endpoint: '/tracking/llegada-recinto', method: 'post', payload: {} });

    await flushQueue();

    expect(api.post).not.toHaveBeenCalled();
    (resolverFotoMilitarEnPayload as jest.Mock).mockRejectedValueOnce(networkError);
    await expect(sincronizarPendientes()).resolves.toBe(2);
  });

  it('si la foto guardada se perdió, la recepción queda como rechazada con el motivo (no en silencio)', async () => {
    (resolverFotoMilitarEnPayload as jest.Mock).mockRejectedValueOnce(
      Object.assign(new FotoMilitarPerdidaError(), { message: 'Vuelve a tomar la foto.' }),
    );
    (api.post as jest.Mock).mockResolvedValue({ data: {} });
    await enqueue({ endpoint: '/tracking/recepcion-kit', method: 'post', payload: { kitId: 'k1' } });
    await enqueue({ endpoint: '/tracking/salida-dpi', method: 'post', payload: {} });

    await flushQueue();

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/tracking/salida-dpi', {});
    expect(await leerRechazadas()).toEqual([
      expect.objectContaining({ endpoint: '/tracking/recepcion-kit', motivo: 'Vuelve a tomar la foto.' }),
    ]);
  });
});

describe('withOffline respeta el orden de la cola', () => {
  it('con acciones pendientes que sí se envían, las manda primero y luego ejecuta fn()', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: {} });
    await enqueue({ endpoint: '/tracking/recepcion-kit', method: 'post', payload: { kitId: 'k1' } });
    const orden: string[] = [];
    (api.post as jest.Mock).mockImplementation(async (endpoint: string) => {
      orden.push(endpoint);
      return { data: {} };
    });
    const fn = jest.fn(async () => {
      orden.push('/tracking/llegada-recinto');
      return { id: 'l1' };
    });

    await expect(withOffline('/tracking/llegada-recinto', 'post', {}, fn)).resolves.toEqual({ id: 'l1' });
    expect(orden).toEqual(['/tracking/recepcion-kit', '/tracking/llegada-recinto']);
  });

  it('si lo pendiente no se puede enviar, encola la acción detrás sin llamar a fn()', async () => {
    (api.post as jest.Mock).mockRejectedValue(networkError);
    await enqueue({ endpoint: '/tracking/recepcion-kit', method: 'post', payload: { kitId: 'k1' } });
    const fn = jest.fn();

    await expect(withOffline('/tracking/llegada-recinto', 'post', { lat: 1 }, fn)).resolves.toBeNull();

    expect(fn).not.toHaveBeenCalled();
    (api.post as jest.Mock).mockReset();
    (api.post as jest.Mock).mockResolvedValue({ data: {} });
    await flushQueue();
    expect((api.post as jest.Mock).mock.calls.map((c) => c[0])).toEqual([
      '/tracking/recepcion-kit',
      '/tracking/llegada-recinto',
    ]);
    expect(api.post).toHaveBeenLastCalledWith('/tracking/llegada-recinto', { lat: 1, desdeOffline: true });
  });
});

describe('flushQueue concurrente', () => {
  it('dos envíos a la vez comparten el mismo envío y no duplican el POST', async () => {
    let responder!: (v: unknown) => void;
    (api.post as jest.Mock).mockReturnValueOnce(new Promise((r) => (responder = r)));
    await enqueue({ endpoint: '/tracking/salida-dpi', method: 'post', payload: {} });

    const a = flushQueue();
    const b = flushQueue();
    responder({ data: {} });
    await Promise.all([a, b]);

    expect(api.post).toHaveBeenCalledTimes(1);
    await expect(contarPendientes()).resolves.toBe(0);
  });
});

describe('withOffline con enOrden: false', () => {
  it('envía de inmediato aunque haya acciones en cola (posiciones GPS, incidencias)', async () => {
    (api.post as jest.Mock).mockRejectedValue(networkError);
    await enqueue({ endpoint: '/tracking/llegada-recinto', method: 'post', payload: {} });
    const fn = jest.fn().mockResolvedValue({ ok: true });

    await expect(withOffline('/tracking/posiciones', 'post', {}, fn, { enOrden: false })).resolves.toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('vaciarCola durante un envío', () => {
  it('el envío en curso no devuelve a la cola lo del operador anterior', async () => {
    let responder!: (v: unknown) => void;
    (api.post as jest.Mock).mockReturnValueOnce(new Promise((r) => (responder = r)));
    await enqueue({ endpoint: '/tracking/salida-dpi', method: 'post', payload: {} });
    await enqueue({ endpoint: '/tracking/llegada-recinto', method: 'post', payload: {} });

    const envio = flushQueue();
    await new Promise((r) => setImmediate(r));
    await vaciarCola();
    responder({ data: {} });
    await envio;

    expect(api.post).toHaveBeenCalledTimes(1); // no siguió con la segunda acción
    await expect(contarPendientes()).resolves.toBe(0);
  });
});

describe('vaciarCola', () => {
  it('borra lo pendiente y los rechazos (son del operador anterior)', async () => {
    (api.post as jest.Mock).mockRejectedValueOnce(badRequestError);
    await enqueue({ endpoint: '/tracking/salida-dpi', method: 'post', payload: {} });
    await flushQueue();
    await enqueue({ endpoint: '/tracking/llegada-dpi', method: 'post', payload: {} });

    await vaciarCola();

    await expect(contarPendientes()).resolves.toBe(0);
    await expect(leerRechazadas()).resolves.toEqual([]);
  });
});
