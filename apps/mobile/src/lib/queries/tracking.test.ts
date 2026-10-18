jest.mock('../api', () => ({ api: { get: jest.fn(), post: jest.fn() } }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MiAsignacionResponse } from '@cne/shared-types';
import { api } from '../api';
import { guardarAsignacion, leerAsignacion } from '../cache-jornada';
import { getMiAsignacion, getMiAsignacionConOrigen, postLlegadaNoCda, postSalidaDpi } from './tracking';

const asignacion = { eventoId: 'ev1', margenLlegadaMetros: 150 } as MiAsignacionResponse;
const sinRed = { isAxiosError: true, response: undefined };
const error = (status: number) => ({ isAxiosError: true, response: { status } });

describe('getMiAsignacionConOrigen', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('con señal devuelve la asignación del servidor y guarda una copia', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: asignacion });

    await expect(getMiAsignacionConOrigen()).resolves.toEqual({ data: asignacion, desdeCache: false });
    await expect(leerAsignacion()).resolves.toEqual(asignacion);
  });

  it('sin señal devuelve la última copia marcada como desdeCache', async () => {
    await guardarAsignacion(asignacion);
    (api.get as jest.Mock).mockRejectedValue(sinRed);

    await expect(getMiAsignacionConOrigen()).resolves.toEqual({ data: asignacion, desdeCache: true });
  });

  it('con el servidor caído (5xx) también usa la copia', async () => {
    await guardarAsignacion(asignacion);
    (api.get as jest.Mock).mockRejectedValue(error(503));

    await expect(getMiAsignacion()).resolves.toEqual(asignacion);
  });

  it('sin señal y sin copia propaga el error', async () => {
    (api.get as jest.Mock).mockRejectedValue(sinRed);

    await expect(getMiAsignacionConOrigen()).rejects.toBe(sinRed);
  });

  it('un error 4xx no usa la copia (p. ej. ya no tiene asignación)', async () => {
    await guardarAsignacion(asignacion);
    const noEncontrado = error(404);
    (api.get as jest.Mock).mockRejectedValue(noEncontrado);

    await expect(getMiAsignacionConOrigen()).rejects.toBe(noEncontrado);
  });
});

describe('registros que actualizan la copia local', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    await guardarAsignacion({
      ...asignacion,
      yaRegistroSalida: false,
      noCdas: [{ id: 'nc1', llegadaRegistradaEn: null }],
    } as unknown as MiAsignacionResponse);
  });

  it('la salida del DPI encolada sin señal queda marcada en la copia', async () => {
    (api.post as jest.Mock).mockRejectedValue(sinRed);

    await expect(postSalidaDpi({ latitud: 0.35, longitud: -78.11 } as never)).resolves.toBeNull();

    await expect(leerAsignacion()).resolves.toMatchObject({ yaRegistroSalida: true });
  });

  it('la llegada a un NO CDA queda marcada para no repetirla', async () => {
    (api.post as jest.Mock).mockRejectedValue(sinRed);

    await postLlegadaNoCda('nc1');

    const copia = await leerAsignacion();
    expect(copia?.noCdas[0].llegadaRegistradaEn).toEqual(expect.any(String));
  });

  it('un rechazo 4xx no marca nada en la copia', async () => {
    (api.post as jest.Mock).mockRejectedValue(error(400));

    await expect(postSalidaDpi({ latitud: 0, longitud: 0 } as never)).rejects.toBeTruthy();

    await expect(leerAsignacion()).resolves.toMatchObject({ yaRegistroSalida: false });
  });
});
