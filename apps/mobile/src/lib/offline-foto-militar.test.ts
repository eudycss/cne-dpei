import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';
import { comprimirFoto } from './comprimir-foto';
import {
  asegurarFotoMilitarSubida,
  contextoDeMarcador,
  esMarcadorFotoPendiente,
  FotoMilitarPerdidaError,
  guardarYSubirFotoMilitar,
  hayFotoMilitarPendiente,
  limpiarFotosMilitar,
  marcadorFotoPendiente,
  resolverFotoMilitarEnPayload,
  restaurarFotoMilitar,
} from './offline-foto-militar';

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock-doc/',
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  copyAsync: jest.fn(),
  writeAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
  EncodingType: { Base64: 'base64' },
}));

jest.mock('./comprimir-foto', () => ({ comprimirFoto: jest.fn() }));

jest.mock('./api', () => ({ api: { post: jest.fn() } }));

const CONTEXTO = 'ev1_r1';
const CLAVE = `cne:foto_militar:${CONTEXTO}`;
const ARCHIVO = expect.stringMatching(/^file:\/\/\/mock-doc\/foto-militar\/ev1_r1_\d+\.jpg$/);
const networkError = { isAxiosError: true, response: undefined };
const badRequestError = { isAxiosError: true, response: { status: 400, data: { message: 'malo' } } };

async function registro() {
  const raw = await AsyncStorage.getItem(CLAVE);
  return raw ? JSON.parse(raw) : null;
}

/** Promesa que el test resuelve a mano, para simular una subida lenta. */
function diferida<T>() {
  let resolver!: (v: T) => void;
  const promesa = new Promise<T>((r) => (resolver = r));
  return { promesa, resolver };
}

describe('offline-foto-militar', () => {
  let ahora = 1_000;

  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    jest.spyOn(Date, 'now').mockImplementation(() => ++ahora);
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true });
    (FileSystem.copyAsync as jest.Mock).mockResolvedValue(undefined);
    (FileSystem.deleteAsync as jest.Mock).mockResolvedValue(undefined);
    (FileSystem.writeAsStringAsync as jest.Mock).mockResolvedValue(undefined);
    (comprimirFoto as jest.Mock).mockResolvedValue(null);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('marcador', () => {
    it('identifica el marcador y recupera su contexto', () => {
      const marcador = marcadorFotoPendiente(CONTEXTO);
      expect(esMarcadorFotoPendiente(marcador)).toBe(true);
      expect(contextoDeMarcador(marcador)).toBe(CONTEXTO);
      expect(esMarcadorFotoPendiente('militares/abc.bin')).toBe(false);
      expect(esMarcadorFotoPendiente(null)).toBe(false);
    });
  });

  describe('guardarYSubirFotoMilitar', () => {
    it('con señal guarda la foto, la sube, borra el archivo local y devuelve la URL', async () => {
      (api.post as jest.Mock).mockResolvedValue({ data: { fotoUrl: 'militares/abc.bin' } });

      const r = await guardarYSubirFotoMilitar(CONTEXTO, 'file:///cache/camara.jpg');

      expect(FileSystem.copyAsync).toHaveBeenCalledWith({ from: 'file:///cache/camara.jpg', to: ARCHIVO });
      expect(api.post).toHaveBeenCalledWith('/tracking/foto-militar', expect.any(FormData), expect.any(Object));
      expect(r).toEqual({ fotoUrl: 'militares/abc.bin', pendiente: false });
      expect(FileSystem.deleteAsync).toHaveBeenCalledWith(ARCHIVO, { idempotent: true });
      await expect(registro()).resolves.toEqual({ uri: null, url: 'militares/abc.bin' });
    });

    it('guarda la versión comprimida cuando se pudo comprimir', async () => {
      (comprimirFoto as jest.Mock).mockResolvedValue('BASE64');
      (api.post as jest.Mock).mockResolvedValue({ data: { fotoUrl: 'militares/abc.bin' } });

      await guardarYSubirFotoMilitar(CONTEXTO, 'file:///cache/camara.jpg');

      expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(ARCHIVO, 'BASE64', { encoding: 'base64' });
      expect(FileSystem.copyAsync).not.toHaveBeenCalled();
    });

    it('sin señal devuelve el marcador y deja la foto guardada en el celular', async () => {
      (api.post as jest.Mock).mockRejectedValue(networkError);

      const r = await guardarYSubirFotoMilitar(CONTEXTO, 'file:///cache/camara.jpg');

      expect(r).toEqual({ fotoUrl: marcadorFotoPendiente(CONTEXTO), pendiente: true });
      expect(FileSystem.deleteAsync).not.toHaveBeenCalled();
      await expect(registro()).resolves.toEqual({ uri: ARCHIVO, url: null });
    });

    it('propaga un rechazo del servidor que no es de red', async () => {
      (api.post as jest.Mock).mockRejectedValue(badRequestError);

      await expect(guardarYSubirFotoMilitar(CONTEXTO, 'file:///cache/camara.jpg')).rejects.toBe(badRequestError);
    });

    it('al repetir la foto sin señal borra el archivo de la foto anterior', async () => {
      (api.post as jest.Mock).mockRejectedValue(networkError);
      await guardarYSubirFotoMilitar(CONTEXTO, 'file:///cache/primera.jpg');
      const primera = (await registro()).uri;

      await guardarYSubirFotoMilitar(CONTEXTO, 'file:///cache/segunda.jpg');

      const segunda = (await registro()).uri;
      expect(segunda).not.toBe(primera);
      expect(FileSystem.deleteAsync).toHaveBeenCalledWith(primera, { idempotent: true });
    });

    it('rechaza un contexto con caracteres de ruta', async () => {
      await expect(guardarYSubirFotoMilitar('../otro', 'file:///cache/camara.jpg')).rejects.toThrow();
      expect(FileSystem.copyAsync).not.toHaveBeenCalled();
    });
  });

  describe('asegurarFotoMilitarSubida', () => {
    it('no vuelve a subir una foto que ya tiene URL', async () => {
      (api.post as jest.Mock).mockResolvedValue({ data: { fotoUrl: 'militares/abc.bin' } });
      await guardarYSubirFotoMilitar(CONTEXTO, 'file:///cache/camara.jpg');
      (api.post as jest.Mock).mockClear();

      await expect(asegurarFotoMilitarSubida(CONTEXTO)).resolves.toBe('militares/abc.bin');
      expect(api.post).not.toHaveBeenCalled();
    });

    it('sube la foto pendiente cuando vuelve la señal', async () => {
      (api.post as jest.Mock).mockRejectedValueOnce(networkError);
      await guardarYSubirFotoMilitar(CONTEXTO, 'file:///cache/camara.jpg');
      (api.post as jest.Mock).mockResolvedValueOnce({ data: { fotoUrl: 'militares/xyz.bin' } });

      await expect(asegurarFotoMilitarSubida(CONTEXTO)).resolves.toBe('militares/xyz.bin');
      await expect(registro()).resolves.toEqual({ uri: null, url: 'militares/xyz.bin' });
    });

    it('dos pedidos a la vez suben la foto una sola vez', async () => {
      (api.post as jest.Mock).mockRejectedValueOnce(networkError);
      await guardarYSubirFotoMilitar(CONTEXTO, 'file:///cache/camara.jpg');
      const subida = diferida<{ data: { fotoUrl: string } }>();
      (api.post as jest.Mock).mockReturnValueOnce(subida.promesa);

      const a = asegurarFotoMilitarSubida(CONTEXTO);
      const b = asegurarFotoMilitarSubida(CONTEXTO);
      subida.resolver({ data: { fotoUrl: 'militares/unica.bin' } });

      await expect(Promise.all([a, b])).resolves.toEqual(['militares/unica.bin', 'militares/unica.bin']);
      expect(api.post).toHaveBeenCalledTimes(2); // el intento sin señal + una sola subida
    });

    it('si se repite la foto durante una subida lenta, conserva la foto nueva', async () => {
      (api.post as jest.Mock).mockRejectedValueOnce(networkError);
      await guardarYSubirFotoMilitar(CONTEXTO, 'file:///cache/vieja.jpg');
      const vieja = (await registro()).uri;
      const subidaVieja = diferida<{ data: { fotoUrl: string } }>();
      (api.post as jest.Mock).mockReturnValueOnce(subidaVieja.promesa);
      const enCurso = asegurarFotoMilitarSubida(CONTEXTO);
      await new Promise((r) => setImmediate(r));

      // El operador repite la foto (sin señal) mientras la vieja se sube.
      (api.post as jest.Mock).mockRejectedValueOnce(networkError);
      await guardarYSubirFotoMilitar(CONTEXTO, 'file:///cache/nueva.jpg');
      const nueva = (await registro()).uri;
      expect(FileSystem.deleteAsync).not.toHaveBeenCalledWith(vieja, expect.anything());

      // Termina la subida vieja: no pisa la nueva, que se sube a continuación.
      (api.post as jest.Mock).mockResolvedValueOnce({ data: { fotoUrl: 'militares/nueva.bin' } });
      subidaVieja.resolver({ data: { fotoUrl: 'militares/vieja.bin' } });

      await expect(enCurso).resolves.toBe('militares/nueva.bin');
      await expect(registro()).resolves.toEqual({ uri: null, url: 'militares/nueva.bin' });
      expect(FileSystem.deleteAsync).toHaveBeenCalledWith(vieja, { idempotent: true });
      expect(FileSystem.deleteAsync).toHaveBeenCalledWith(nueva, { idempotent: true });
    });

    it('lanza FotoMilitarPerdidaError si no hay registro', async () => {
      await expect(asegurarFotoMilitarSubida(CONTEXTO)).rejects.toBeInstanceOf(FotoMilitarPerdidaError);
    });

    it('lanza FotoMilitarPerdidaError si el archivo local ya no existe', async () => {
      (api.post as jest.Mock).mockRejectedValueOnce(networkError);
      await guardarYSubirFotoMilitar(CONTEXTO, 'file:///cache/camara.jpg');
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: false });

      await expect(asegurarFotoMilitarSubida(CONTEXTO)).rejects.toBeInstanceOf(FotoMilitarPerdidaError);
    });

    it('trata un registro corrupto como foto perdida', async () => {
      await AsyncStorage.setItem(CLAVE, '{no es json');

      await expect(asegurarFotoMilitarSubida(CONTEXTO)).rejects.toBeInstanceOf(FotoMilitarPerdidaError);
    });
  });

  describe('restaurarFotoMilitar', () => {
    it('devuelve la URL si la foto ya se subió', async () => {
      (api.post as jest.Mock).mockResolvedValue({ data: { fotoUrl: 'militares/abc.bin' } });
      await guardarYSubirFotoMilitar(CONTEXTO, 'file:///cache/camara.jpg');

      await expect(restaurarFotoMilitar(CONTEXTO)).resolves.toBe('militares/abc.bin');
    });

    it('devuelve el marcador si la foto sigue en el celular', async () => {
      (api.post as jest.Mock).mockRejectedValue(networkError);
      await guardarYSubirFotoMilitar(CONTEXTO, 'file:///cache/camara.jpg');

      await expect(restaurarFotoMilitar(CONTEXTO)).resolves.toBe(marcadorFotoPendiente(CONTEXTO));
    });

    it('devuelve null si el archivo se perdió (hay que tomarla de nuevo)', async () => {
      (api.post as jest.Mock).mockRejectedValue(networkError);
      await guardarYSubirFotoMilitar(CONTEXTO, 'file:///cache/camara.jpg');
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: false });

      await expect(restaurarFotoMilitar(CONTEXTO)).resolves.toBeNull();
    });

    it('cada recinto y evento tiene su propio registro', async () => {
      (api.post as jest.Mock).mockRejectedValue(networkError);
      await guardarYSubirFotoMilitar(CONTEXTO, 'file:///cache/camara.jpg');

      await expect(restaurarFotoMilitar('ev1_otro')).resolves.toBeNull();
    });
  });

  describe('resolverFotoMilitarEnPayload', () => {
    it('reemplaza el marcador por la URL real', async () => {
      (api.post as jest.Mock).mockRejectedValueOnce(networkError);
      await guardarYSubirFotoMilitar(CONTEXTO, 'file:///cache/camara.jpg');
      (api.post as jest.Mock).mockResolvedValueOnce({ data: { fotoUrl: 'militares/xyz.bin' } });

      const payload = { kitId: 'k1', fotoMilitarUrl: marcadorFotoPendiente(CONTEXTO) };

      await expect(resolverFotoMilitarEnPayload(payload)).resolves.toEqual({
        kitId: 'k1',
        fotoMilitarUrl: 'militares/xyz.bin',
      });
    });

    it('deja igual un payload sin marcador', async () => {
      const payload = { kitId: 'k1', fotoMilitarUrl: 'militares/abc.bin' };
      await expect(resolverFotoMilitarEnPayload(payload)).resolves.toBe(payload);
      expect(api.post).not.toHaveBeenCalled();
    });

    it('rechaza un marcador con un contexto inválido', async () => {
      const payload = { fotoMilitarUrl: marcadorFotoPendiente('../../x') };
      await expect(resolverFotoMilitarEnPayload(payload)).rejects.toBeInstanceOf(FotoMilitarPerdidaError);
    });
  });

  describe('hayFotoMilitarPendiente', () => {
    it('es true solo mientras alguna foto sigue sin subir', async () => {
      await expect(hayFotoMilitarPendiente()).resolves.toBe(false);
      (api.post as jest.Mock).mockRejectedValueOnce(networkError);
      await guardarYSubirFotoMilitar(CONTEXTO, 'file:///cache/camara.jpg');
      await expect(hayFotoMilitarPendiente()).resolves.toBe(true);

      (api.post as jest.Mock).mockResolvedValueOnce({ data: { fotoUrl: 'militares/abc.bin' } });
      await asegurarFotoMilitarSubida(CONTEXTO);
      await expect(hayFotoMilitarPendiente()).resolves.toBe(false);
    });
  });

  describe('limpiarFotosMilitar', () => {
    it('una subida que termina después de cerrar sesión no vuelve a escribir el registro', async () => {
      (api.post as jest.Mock).mockRejectedValueOnce(networkError);
      await guardarYSubirFotoMilitar(CONTEXTO, 'file:///cache/camara.jpg');
      const subida = diferida<{ data: { fotoUrl: string } }>();
      (api.post as jest.Mock).mockReturnValueOnce(subida.promesa);
      const enCurso = asegurarFotoMilitarSubida(CONTEXTO);
      await new Promise((r) => setImmediate(r));

      await limpiarFotosMilitar();
      subida.resolver({ data: { fotoUrl: 'militares/abc.bin' } });

      await expect(enCurso).rejects.toBeInstanceOf(FotoMilitarPerdidaError);
      await expect(registro()).resolves.toBeNull();
    });

    it('borra los registros y la carpeta de fotos, sin tocar otras claves', async () => {
      (api.post as jest.Mock).mockRejectedValue(networkError);
      await guardarYSubirFotoMilitar(CONTEXTO, 'file:///cache/camara.jpg');
      await AsyncStorage.setItem('cne:otra', 'x');

      await limpiarFotosMilitar();

      await expect(registro()).resolves.toBeNull();
      await expect(AsyncStorage.getItem('cne:otra')).resolves.toBe('x');
      expect(FileSystem.deleteAsync).toHaveBeenCalledWith('file:///mock-doc/foto-militar/', { idempotent: true });
    });
  });
});
