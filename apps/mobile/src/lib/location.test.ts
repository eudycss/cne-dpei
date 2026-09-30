type TaskBody = { data?: unknown; error?: unknown };
type TaskCallback = (body: TaskBody) => Promise<void>;

let registeredTask: TaskCallback | undefined;

jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  hasServicesEnabledAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  watchPositionAsync: jest.fn(),
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn((_name: string, cb: TaskCallback) => {
    registeredTask = cb;
  }),
}));

jest.mock('./queries/retorno', () => ({ postPosiciones: jest.fn() }));

import * as Location from 'expo-location';
import { postPosiciones } from './queries/retorno';
import { activarRastreoSegundoPlano, iniciarRastreo, iniciarRastreoPrimerPlano } from './location';

const fakeLocation = (lat: number, lon: number, timestamp = 1_700_000_000_000) => ({
  coords: { latitude: lat, longitude: lon },
  timestamp,
});

const networkError = { isAxiosError: true, response: undefined };

describe('location — tarea de rastreo en segundo plano (TRACKING_TASK)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('no lanza si postPosiciones falla por red (queda absorbido, no revienta la tarea)', async () => {
    (postPosiciones as jest.Mock).mockRejectedValue(networkError);

    await expect(
      registeredTask!({ data: { locations: [fakeLocation(-0.35, -78.12)] } }),
    ).resolves.not.toThrow();
  });

  it('llama a postPosiciones con el payload mapeado desde coords/timestamp', async () => {
    (postPosiciones as jest.Mock).mockResolvedValue(undefined);

    await registeredTask!({
      data: { locations: [fakeLocation(-0.35, -78.12, 1_700_000_000_000)] },
    });

    expect(postPosiciones).toHaveBeenCalledWith({
      posiciones: [
        {
          latitud: -0.35,
          longitud: -78.12,
          capturadoEn: new Date(1_700_000_000_000).toISOString(),
        },
      ],
    });
  });

  it('si el callback trae error, no llama a postPosiciones', async () => {
    await registeredTask!({ error: { message: 'boom' } });

    expect(postPosiciones).not.toHaveBeenCalled();
  });

  it('si no hay ubicaciones en el batch, no llama a postPosiciones', async () => {
    await registeredTask!({ data: { locations: [] } });

    expect(postPosiciones).not.toHaveBeenCalled();
  });
});

describe('iniciarRastreo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('no reinicia el rastreo si ya está activo', async () => {
    (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValue(true);

    await iniciarRastreo();

    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('inicia el rastreo si todavía no está activo', async () => {
    (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValue(false);

    await iniciarRastreo();

    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });
});

describe('activarRastreoSegundoPlano', () => {
  const concedido = { status: 'granted' };

  beforeEach(() => {
    jest.clearAllMocks();
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue(concedido);
    (Location.requestBackgroundPermissionsAsync as jest.Mock).mockResolvedValue(concedido);
    (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValue(false);
    (Location.startLocationUpdatesAsync as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("devuelve 'activo' cuando concede el permiso e inicia el rastreo", async () => {
    await expect(activarRastreoSegundoPlano()).resolves.toBe('activo');
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });

  it("devuelve 'fallo' si niega el permiso en segundo plano (no inicia el rastreo)", async () => {
    (Location.requestBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });

    await expect(activarRastreoSegundoPlano()).resolves.toBe('fallo');
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it("devuelve 'fallo' si iniciarRastreo rechaza dentro del límite", async () => {
    (Location.startLocationUpdatesAsync as jest.Mock).mockRejectedValue(new Error('servicio no disponible'));

    await expect(activarRastreoSegundoPlano()).resolves.toBe('fallo');
  });

  it("devuelve 'pendiente' al vencer el límite si el permiso nunca responde (bug de 'Registrando…')", async () => {
    jest.useFakeTimers();
    (Location.requestBackgroundPermissionsAsync as jest.Mock).mockReturnValue(new Promise(() => {}));

    const resultado = activarRastreoSegundoPlano(20_000);
    await jest.advanceTimersByTimeAsync(20_000);

    await expect(resultado).resolves.toBe('pendiente');
  });

  it('si el permiso llega después del límite, el rastreo igual arranca solo', async () => {
    jest.useFakeTimers();
    let conceder!: (v: unknown) => void;
    (Location.requestBackgroundPermissionsAsync as jest.Mock).mockReturnValue(
      new Promise((resolve) => {
        conceder = resolve;
      }),
    );

    const resultado = activarRastreoSegundoPlano(20_000);
    await jest.advanceTimersByTimeAsync(20_000);
    await expect(resultado).resolves.toBe('pendiente');
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();

    // El operador vuelve de Ajustes y concede "Permitir siempre".
    conceder(concedido);
    await jest.advanceTimersByTimeAsync(0);
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });

  it('un rechazo posterior al límite no queda como promesa rechazada sin manejar', async () => {
    jest.useFakeTimers();
    let rechazar!: (e: unknown) => void;
    (Location.requestBackgroundPermissionsAsync as jest.Mock).mockReturnValue(
      new Promise((_resolve, reject) => {
        rechazar = reject;
      }),
    );
    const sinManejar = jest.fn();
    // env.d.ts tipa `process` solo con `env` (código de app); aquí se usa el de Node.
    const nodeProcess = (globalThis as unknown as { process: { on: Function; off: Function } }).process;
    nodeProcess.on('unhandledRejection', sinManejar);

    const resultado = activarRastreoSegundoPlano(20_000);
    await jest.advanceTimersByTimeAsync(20_000);
    await expect(resultado).resolves.toBe('pendiente');
    rechazar(new Error('boom'));
    await jest.advanceTimersByTimeAsync(0);
    await new Promise((r) => jest.requireActual('timers').setImmediate(r));

    nodeProcess.off('unhandledRejection', sinManejar);
    expect(sinManejar).not.toHaveBeenCalled();
  });
});

describe('iniciarRastreoPrimerPlano', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Location.hasServicesEnabledAsync as jest.Mock).mockResolvedValue(true);
    (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  });

  it('el callback de watchPositionAsync no lanza si postPosiciones falla por red', async () => {
    (postPosiciones as jest.Mock).mockRejectedValue(networkError);
    let capturedCallback: ((loc: unknown) => Promise<void>) | undefined;
    (Location.watchPositionAsync as jest.Mock).mockImplementation((_opts, cb) => {
      capturedCallback = cb;
      return Promise.resolve({ remove: jest.fn() });
    });

    await iniciarRastreoPrimerPlano();

    await expect(capturedCallback!(fakeLocation(-0.35, -78.12))).resolves.not.toThrow();
  });
});
