import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueue, sincronizarPendientes } from './offline-queue';
import { marcarPruebaConexionEnCopia, postPruebaConexion } from './queries/tracking';
import {
  adjuntarFotoPruebaConexion,
  leerPruebaConexionLocal,
  pruebaConexionHabilitada,
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

  it('envía la foto de la computadora del test junto con la hora', async () => {
    const hora = await registrarPruebaConexion(CONTEXTO, 'actas/pc.bin');

    expect(postPruebaConexion).toHaveBeenCalledWith({ ocurridoEn: hora, fotoUrl: 'actas/pc.bin' });
  });

  it('encolada sin señal también lleva la foto', async () => {
    (sincronizarPendientes as jest.Mock).mockResolvedValueOnce(1);

    const hora = await registrarPruebaConexion(CONTEXTO, 'actas/pc.bin');

    expect(enqueue).toHaveBeenCalledWith({
      endpoint: '/tracking/prueba-conexion',
      method: 'post',
      payload: { ocurridoEn: hora, desdeOffline: true, fotoUrl: 'actas/pc.bin' },
    });
  });

  it('se habilita desde las 9:00 de Ecuador (UTC-5), sin importar la zona del teléfono', () => {
    expect(pruebaConexionHabilitada(new Date('2026-11-08T13:59:00.000Z'))).toBe(false); // 08:59
    expect(pruebaConexionHabilitada(new Date('2026-11-08T14:00:00.000Z'))).toBe(true); // 09:00
    expect(pruebaConexionHabilitada(new Date('2026-11-08T22:00:00.000Z'))).toBe(true); // 17:00
    expect(pruebaConexionHabilitada(new Date('2026-11-08T05:30:00.000Z'))).toBe(false); // 00:30
  });

  it('adjunta la foto que subió después a la prueba ya registrada, con la hora original', async () => {
    await AsyncStorage.setItem(`prueba-conexion:${CONTEXTO}`, '2026-10-01T17:00:00.000Z');

    await adjuntarFotoPruebaConexion(CONTEXTO, 'actas/pc.bin');

    expect(postPruebaConexion).toHaveBeenCalledWith({ ocurridoEn: '2026-10-01T17:00:00.000Z', fotoUrl: 'actas/pc.bin' });
  });

  it('adjuntar la foto es best-effort: un rechazo no rompe la pantalla y avisa que no se envió', async () => {
    (postPruebaConexion as jest.Mock).mockRejectedValueOnce({ response: { status: 400 } });

    await expect(adjuntarFotoPruebaConexion(CONTEXTO, 'actas/pc.bin')).resolves.toBe(false);
    await expect(adjuntarFotoPruebaConexion(CONTEXTO, 'actas/pc.bin')).resolves.toBe(true);
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

  it('reconcilia: si el servidor la rechaza (4xx), borra la marca local para que se vuelva a hacer', async () => {
    await AsyncStorage.setItem(`prueba-conexion:${CONTEXTO}`, '2026-10-01T17:00:00.000Z');
    (postPruebaConexion as jest.Mock).mockRejectedValueOnce({ response: { status: 400, data: { message: 'Antes de las 9' } } });

    await expect(reconciliarPruebaConexion(CONTEXTO, false)).resolves.toEqual({ rechazada: 'Antes de las 9' });
    await expect(leerPruebaConexionLocal(CONTEXTO)).resolves.toBeNull();
  });

  it('reconcilia: un error sin respuesta (sin señal) conserva la marca y se reintenta luego', async () => {
    await AsyncStorage.setItem(`prueba-conexion:${CONTEXTO}`, '2026-10-01T17:00:00.000Z');
    (postPruebaConexion as jest.Mock).mockRejectedValueOnce(new Error('Network Error'));

    await expect(reconciliarPruebaConexion(CONTEXTO, false)).resolves.toEqual({ rechazada: null });
    await expect(leerPruebaConexionLocal(CONTEXTO)).resolves.toBe('2026-10-01T17:00:00.000Z');
  });

  it('la marca es por evento+recinto y se limpia tras la salida', async () => {
    await registrarPruebaConexion(CONTEXTO);

    await expect(leerPruebaConexionLocal('evt1_otro')).resolves.toBeNull();
    await limpiarPruebaConexion(CONTEXTO);
    await expect(leerPruebaConexionLocal(CONTEXTO)).resolves.toBeNull();
  });
});
