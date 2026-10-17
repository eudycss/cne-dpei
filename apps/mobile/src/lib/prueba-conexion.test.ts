import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueue, sincronizarPendientes } from './offline-queue';
import { marcarPruebaConexionEnCopia, postPruebaConexion } from './queries/tracking';
import {
  leerPruebaConexionLocal,
  limpiarPruebaConexion,
  reconciliarPruebaConexion,
  registrarPruebaConexion,
} from './prueba-conexion';

jest.mock('./offline-queue', () => ({
  enqueue: jest.fn(),
  sincronizarPendientes: jest.fn(),
}));

jest.mock('./queries/tracking', () => ({
  postPruebaConexion: jest.fn(),
  marcarPruebaConexionEnCopia: jest.fn().mockResolvedValue(undefined),
}));

const CONTEXTO = 'evt1_r1';

describe('prueba-conexion', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    (sincronizarPendientes as jest.Mock).mockResolvedValue(0);
    (postPruebaConexion as jest.Mock).mockResolvedValue({ id: 'p1', ocurridoEn: 'x' });
  });

  it('con la cola vacía la envía al servidor y guarda la hora en el teléfono', async () => {
    const hora = await registrarPruebaConexion(CONTEXTO);

    expect(postPruebaConexion).toHaveBeenCalledWith({ ocurridoEn: hora });
    expect(enqueue).not.toHaveBeenCalled();
    await expect(leerPruebaConexionLocal(CONTEXTO)).resolves.toBe(hora);
  });

  it('si quedan acciones en la cola (p. ej. la llegada), la encola detrás para respetar el orden', async () => {
    (sincronizarPendientes as jest.Mock).mockResolvedValueOnce(1);

    const hora = await registrarPruebaConexion(CONTEXTO);

    expect(postPruebaConexion).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith({
      endpoint: '/tracking/prueba-conexion',
      method: 'post',
      payload: { ocurridoEn: hora, desdeOffline: true },
    });
    await expect(leerPruebaConexionLocal(CONTEXTO)).resolves.toBe(hora);
    // La copia de la asignación la marca hecha: al reabrir sin señal no se reenvía duplicada.
    expect(marcarPruebaConexionEnCopia).toHaveBeenCalled();
  });

  it('un error del servidor (4xx) se propaga y no marca la prueba como hecha', async () => {
    (postPruebaConexion as jest.Mock).mockRejectedValueOnce({ response: { status: 400 } });

    await expect(registrarPruebaConexion(CONTEXTO)).rejects.toEqual({ response: { status: 400 } });
    await expect(leerPruebaConexionLocal(CONTEXTO)).resolves.toBeNull();
  });

  it('reconcilia: si el teléfono la tiene y el servidor no, la reenvía con la hora original', async () => {
    await AsyncStorage.setItem(`prueba-conexion:${CONTEXTO}`, '2026-10-01T17:00:00.000Z');

    await reconciliarPruebaConexion(CONTEXTO, false);

    expect(postPruebaConexion).toHaveBeenCalledWith({ ocurridoEn: '2026-10-01T17:00:00.000Z' });
  });

  it('reconcilia: no reenvía si el servidor ya la tiene o si el teléfono no la hizo', async () => {
    await reconciliarPruebaConexion(CONTEXTO, false); // sin marca local
    await AsyncStorage.setItem(`prueba-conexion:${CONTEXTO}`, '2026-10-01T17:00:00.000Z');
    await reconciliarPruebaConexion(CONTEXTO, true); // el servidor ya la tiene

    expect(postPruebaConexion).not.toHaveBeenCalled();
  });

  it('reconcilia: un rechazo del servidor no rompe la pantalla', async () => {
    await AsyncStorage.setItem(`prueba-conexion:${CONTEXTO}`, '2026-10-01T17:00:00.000Z');
    (postPruebaConexion as jest.Mock).mockRejectedValueOnce({ response: { status: 400 } });

    await expect(reconciliarPruebaConexion(CONTEXTO, false)).resolves.toBeUndefined();
  });

  it('la marca es por evento+recinto y se limpia tras la salida', async () => {
    await registrarPruebaConexion(CONTEXTO);

    await expect(leerPruebaConexionLocal('evt1_otro')).resolves.toBeNull();
    await limpiarPruebaConexion(CONTEXTO);
    await expect(leerPruebaConexionLocal(CONTEXTO)).resolves.toBeNull();
  });
});
