type TaskBody = { data?: unknown; error?: unknown };
type TaskCallback = (body: TaskBody) => Promise<void>;

let registeredTask: TaskCallback | undefined;

jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  hasServicesEnabledAsync: jest.fn(),
  getForegroundPermissionsAsync: jest.fn(),
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  getBackgroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
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
jest.mock('./aviso-proximidad', () => ({ revisarProximidad: jest.fn().mockResolvedValue(false) }));

import * as Location from 'expo-location';
import { postPosiciones } from './queries/retorno';
import { revisarProximidad } from './aviso-proximidad';
import {
  activarRastreoSegundoPlano,
  asegurarRastreoSiHayPermiso,
  iniciarRastreo,
  permisoSegundoPlanoConcedido,
  iniciarRastreoPrimerPlano,
  obtenerUbicacionPuntual,
  UbicacionNoDisponibleError,
  MAX_ANTIGUEDAD_ULTIMA_POSICION_MS,
  PRECISION_ULTIMA_POSICION_METROS,
} from './location';

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

  it('revisa el aviso de 200 m después de enviar, con cada posición del lote, aunque no haya señal', async () => {
    (postPosiciones as jest.Mock).mockRejectedValue(networkError);
    const segunda = { coords: { latitude: 0.358, longitude: -78.118, accuracy: 12 }, timestamp: 2 };

    await registeredTask!({ data: { locations: [fakeLocation(0.3, -78.1, 1), segunda] } });

    expect(revisarProximidad).toHaveBeenCalledTimes(2);
    expect(revisarProximidad).toHaveBeenLastCalledWith({ latitud: 0.358, longitud: -78.118, precisionMetros: 12 });
    // El envío de posiciones va primero: un aviso lento no frena el rastreo.
    expect((postPosiciones as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      (revisarProximidad as jest.Mock).mock.invocationCallOrder[0],
    );
  });

  it('deja de revisar el lote en cuanto avisa', async () => {
    (postPosiciones as jest.Mock).mockResolvedValue(undefined);
    (revisarProximidad as jest.Mock).mockResolvedValueOnce(true);

    await registeredTask!({ data: { locations: [fakeLocation(0.3, -78.1, 1), fakeLocation(0.31, -78.1, 2)] } });

    expect(revisarProximidad).toHaveBeenCalledTimes(1);
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
    // Sin precisión reportada se pasa null: el aviso no la descarta por eso.
    expect(revisarProximidad).toHaveBeenCalledWith({ latitud: -0.35, longitud: -78.12, precisionMetros: null });
  });
});

describe('asegurarRastreoSiHayPermiso', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (Location.hasServicesEnabledAsync as jest.Mock).mockResolvedValue(true);
    (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValue(false);
    (Location.getBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
    (Location.startLocationUpdatesAsync as jest.Mock).mockResolvedValue(undefined);
  });

  it('true si el rastreo ya está corriendo (sin reiniciarlo)', async () => {
    (Location.hasStartedLocationUpdatesAsync as jest.Mock).mockResolvedValue(true);

    await expect(asegurarRastreoSiHayPermiso()).resolves.toBe(true);
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('false si el GPS del teléfono está apagado', async () => {
    (Location.hasServicesEnabledAsync as jest.Mock).mockResolvedValue(false);

    await expect(asegurarRastreoSiHayPermiso()).resolves.toBe(false);
  });

  it('sin permiso en segundo plano devuelve false y NO abre el diálogo de permiso', async () => {
    (Location.getBackgroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied' });

    await expect(asegurarRastreoSiHayPermiso()).resolves.toBe(false);
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
    expect(Location.startLocationUpdatesAsync).not.toHaveBeenCalled();
  });

  it('con permiso concedido pero rastreo detenido, lo arranca solo', async () => {
    (Location.hasStartedLocationUpdatesAsync as jest.Mock)
      .mockResolvedValueOnce(false) // chequeo inicial
      .mockResolvedValueOnce(false) // dentro de iniciarRastreo
      .mockResolvedValueOnce(true); // verificación final

    await expect(asegurarRastreoSiHayPermiso()).resolves.toBe(true);
    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledTimes(1);
  });

  it('false si arrancar el rastreo falla', async () => {
    (Location.startLocationUpdatesAsync as jest.Mock).mockRejectedValue(new Error('servicio no disponible'));

    await expect(asegurarRastreoSiHayPermiso()).resolves.toBe(false);
  });
});

describe('permisoSegundoPlanoConcedido', () => {
  beforeEach(() => jest.clearAllMocks());

  it('true solo con el permiso concedido, sin abrir el diálogo', async () => {
    (Location.getBackgroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'granted' });
    await expect(permisoSegundoPlanoConcedido()).resolves.toBe(true);
    (Location.getBackgroundPermissionsAsync as jest.Mock).mockResolvedValueOnce({ status: 'denied' });
    await expect(permisoSegundoPlanoConcedido()).resolves.toBe(false);
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('false si la consulta falla', async () => {
    (Location.getBackgroundPermissionsAsync as jest.Mock).mockRejectedValueOnce(new Error('x'));
    await expect(permisoSegundoPlanoConcedido()).resolves.toBe(false);
  });
});

describe('obtenerUbicacionPuntual', () => {
  const conPrecision = (lat: number, lon: number) => ({ coords: { latitude: lat, longitude: lon, accuracy: 8 }, timestamp: 1 });
  const conRespaldo = { permitirUltimaConocida: true, limiteMs: 10 };
  const ultima = conPrecision(0.3576, -78.5108);

  beforeEach(() => {
    jest.clearAllMocks();
    (Location.hasServicesEnabledAsync as jest.Mock).mockResolvedValue(true);
    (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted' });
  });

  it('sin respaldo (registros) exige un fix nuevo y no usa la última posición conocida', async () => {
    (Location.getCurrentPositionAsync as jest.Mock).mockRejectedValue(new Error('provider unavailable'));

    await expect(obtenerUbicacionPuntual()).rejects.toThrow('provider unavailable');
    expect(Location.getLastKnownPositionAsync).not.toHaveBeenCalled();
  });

  it('con respaldo devuelve el fix nuevo cuando llega a tiempo', async () => {
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue(conPrecision(0.3575, -78.51));

    await expect(obtenerUbicacionPuntual(conRespaldo)).resolves.toEqual({ latitud: 0.3575, longitud: -78.51, precisionMetros: 8 });
    expect(Location.getLastKnownPositionAsync).not.toHaveBeenCalled();
  });

  it('con respaldo, si el GPS no responde a tiempo usa la última posición reciente y precisa', async () => {
    (Location.getCurrentPositionAsync as jest.Mock).mockReturnValue(new Promise(() => {}));
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(ultima);

    await expect(obtenerUbicacionPuntual(conRespaldo)).resolves.toEqual({ latitud: 0.3576, longitud: -78.5108, precisionMetros: 8 });
    expect(Location.getLastKnownPositionAsync).toHaveBeenCalledWith({
      maxAge: MAX_ANTIGUEDAD_ULTIMA_POSICION_MS,
      requiredAccuracy: PRECISION_ULTIMA_POSICION_METROS,
    });
  });

  it('con respaldo, si el GPS falla de inmediato (sin señal) también usa la última posición', async () => {
    (Location.getCurrentPositionAsync as jest.Mock).mockRejectedValue(new Error('provider unavailable'));
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(ultima);

    await expect(obtenerUbicacionPuntual({ permitirUltimaConocida: true, limiteMs: 60_000 })).resolves.toMatchObject({
      latitud: 0.3576,
    });
  });

  it('lanza UbicacionNoDisponibleError si no hay fix ni posición reciente (no queda colgado)', async () => {
    (Location.getCurrentPositionAsync as jest.Mock).mockReturnValue(new Promise(() => {}));
    (Location.getLastKnownPositionAsync as jest.Mock).mockRejectedValue(new Error('x'));

    await expect(obtenerUbicacionPuntual(conRespaldo)).rejects.toBeInstanceOf(UbicacionNoDisponibleError);
  });

  it('no deja un rechazo sin manejar si el GPS falla después del límite', async () => {
    let rechazar!: (e: Error) => void;
    (Location.getCurrentPositionAsync as jest.Mock).mockReturnValue(new Promise((_r, rej) => { rechazar = rej; }));
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(ultima);

    await obtenerUbicacionPuntual(conRespaldo);
    rechazar(new Error('timeout nativo'));
    await new Promise((r) => setImmediate(r));
  });
});
