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
import { iniciarRastreo, iniciarRastreoPrimerPlano } from './location';

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
