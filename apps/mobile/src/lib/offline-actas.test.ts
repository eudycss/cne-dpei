import * as FileSystem from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { subirFotoActa } from './queries/retorno';
import {
  capturarYSubirActa,
  limpiarActas,
  reintentarSubidaActa,
  restaurarActas,
} from './offline-actas';

jest.mock('expo-file-system', () => ({
  documentDirectory: 'file:///mock-doc/',
  getInfoAsync: jest.fn(),
  makeDirectoryAsync: jest.fn(),
  copyAsync: jest.fn(),
  deleteAsync: jest.fn(),
}));

jest.mock('./queries/retorno', () => ({
  subirFotoActa: jest.fn(),
}));

const CONTEXTO = 'evt1_r1';
const DIRECTORIO = `file:///mock-doc/actas-salida-recinto/${CONTEXTO}/`;

describe('offline-actas', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true });
    (FileSystem.copyAsync as jest.Mock).mockResolvedValue(undefined);
    (FileSystem.deleteAsync as jest.Mock).mockResolvedValue(undefined);
  });

  describe('capturarYSubirActa', () => {
    it('copia la foto a un archivo persistente y la sube', async () => {
      (subirFotoActa as jest.Mock).mockResolvedValue({ url: 'actas/instalacion-abc.bin' });

      const resultado = await capturarYSubirActa(CONTEXTO, 'instalacion', 'file:///cache/camara-tmp.jpg');

      expect(FileSystem.copyAsync).toHaveBeenCalledWith({
        from: 'file:///cache/camara-tmp.jpg',
        to: `${DIRECTORIO}instalacion.jpg`,
      });
      expect(subirFotoActa).toHaveBeenCalledWith(`${DIRECTORIO}instalacion.jpg`);
      expect(resultado).toEqual({
        uri: `${DIRECTORIO}instalacion.jpg`,
        url: 'actas/instalacion-abc.bin',
        error: null,
      });
    });

    it('crea el directorio si todavía no existe', async () => {
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValueOnce({ exists: false });
      (subirFotoActa as jest.Mock).mockResolvedValue({ url: 'actas/x.bin' });

      await capturarYSubirActa(CONTEXTO, 'escrutinio', 'file:///cache/foto.jpg');

      expect(FileSystem.makeDirectoryAsync).toHaveBeenCalledWith(DIRECTORIO, { intermediates: true });
    });

    it('si falla la subida, deja el archivo persistido para poder reintentar sin retomar la foto', async () => {
      (subirFotoActa as jest.Mock).mockRejectedValue({
        response: { data: { message: 'Sin conexión' } },
      });

      const resultado = await capturarYSubirActa(CONTEXTO, 'instalacion', 'file:///cache/foto.jpg');

      expect(resultado).toEqual({
        uri: `${DIRECTORIO}instalacion.jpg`,
        url: null,
        error: 'Sin conexión',
      });
      // Aunque falló la subida, queda registrada localmente (uri persistido, sin url).
      const estado = await restaurarActas(CONTEXTO);
      expect(estado.instalacion).toEqual({ uri: `${DIRECTORIO}instalacion.jpg`, url: null });
    });

    it('si falla copiar el archivo a almacenamiento persistente, resuelve con error en vez de rechazar', async () => {
      (FileSystem.copyAsync as jest.Mock).mockRejectedValueOnce(new Error('disco lleno'));
      (subirFotoActa as jest.Mock).mockRejectedValueOnce({
        response: { data: { message: 'Sin conexión' } },
      });

      // No debe rechazar: si lo hiciera, la pantalla dejaría el acta
      // "subiendo" para siempre sin ningún mensaje de error.
      const resultado = await capturarYSubirActa(CONTEXTO, 'instalacion', 'file:///cache/foto.jpg');

      expect(resultado.url).toBeNull();
      expect(resultado.error).toBeTruthy();
      // Ante la falla de copia, sigue usando el uri original de la cámara
      // (mismo criterio de riesgo que subirFotoMilitar) en vez de una ruta
      // persistente que nunca llegó a existir.
      expect(resultado.uri).toBe('file:///cache/foto.jpg');
    });

    it('si falla guardar el registro en AsyncStorage, igual completa la subida en esta sesión', async () => {
      jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('storage lleno'));
      (subirFotoActa as jest.Mock).mockResolvedValueOnce({ url: 'actas/instalacion.bin' });

      const resultado = await capturarYSubirActa(CONTEXTO, 'instalacion', 'file:///cache/foto.jpg');

      expect(resultado.error).toBeNull();
      expect(resultado.url).toBe('actas/instalacion.bin');
    });

    it('dos capturas concurrentes de distinto tipo no se pisan entre sí en el registro persistido', async () => {
      (subirFotoActa as jest.Mock).mockImplementation((uri: string) =>
        uri.includes('instalacion')
          ? new Promise((resolve) => setTimeout(() => resolve({ url: 'actas/instalacion.bin' }), 20))
          : Promise.resolve({ url: 'actas/escrutinio.bin' }),
      );

      await Promise.all([
        capturarYSubirActa(CONTEXTO, 'instalacion', 'file:///cache/instalacion.jpg'),
        capturarYSubirActa(CONTEXTO, 'escrutinio', 'file:///cache/escrutinio.jpg'),
      ]);

      const estado = await restaurarActas(CONTEXTO);
      expect(estado.instalacion?.url).toBe('actas/instalacion.bin');
      expect(estado.escrutinio?.url).toBe('actas/escrutinio.bin');
    });
  });

  describe('reintentarSubidaActa', () => {
    it('reintenta subir usando la ruta ya persistida, sin volver a copiar el archivo', async () => {
      (subirFotoActa as jest.Mock).mockRejectedValueOnce(new Error('sin señal'));
      await capturarYSubirActa(CONTEXTO, 'instalacion', 'file:///cache/foto.jpg');
      (FileSystem.copyAsync as jest.Mock).mockClear();

      (subirFotoActa as jest.Mock).mockResolvedValueOnce({ url: 'actas/instalacion-ok.bin' });
      const resultado = await reintentarSubidaActa(CONTEXTO, 'instalacion');

      expect(FileSystem.copyAsync).not.toHaveBeenCalled();
      expect(resultado).toEqual({
        uri: `${DIRECTORIO}instalacion.jpg`,
        url: 'actas/instalacion-ok.bin',
        error: null,
      });
    });

    it('devuelve null si no hay ninguna acta de ese tipo guardada localmente', async () => {
      const resultado = await reintentarSubidaActa(CONTEXTO, 'escrutinio');
      expect(resultado).toBeNull();
      expect(subirFotoActa).not.toHaveBeenCalled();
    });
  });

  describe('restaurarActas', () => {
    it('devuelve el registro persistido de ambas actas', async () => {
      (subirFotoActa as jest.Mock)
        .mockResolvedValueOnce({ url: 'actas/instalacion.bin' })
        .mockResolvedValueOnce({ url: 'actas/escrutinio.bin' });
      await capturarYSubirActa(CONTEXTO, 'instalacion', 'file:///cache/a.jpg');
      await capturarYSubirActa(CONTEXTO, 'escrutinio', 'file:///cache/b.jpg');

      const estado = await restaurarActas(CONTEXTO);

      expect(estado).toEqual({
        instalacion: { uri: `${DIRECTORIO}instalacion.jpg`, url: 'actas/instalacion.bin' },
        escrutinio: { uri: `${DIRECTORIO}escrutinio.jpg`, url: 'actas/escrutinio.bin' },
      });
    });

    it('devuelve un objeto vacío si no hay nada guardado', async () => {
      expect(await restaurarActas(CONTEXTO)).toEqual({});
    });

    it('no mezcla actas guardadas bajo un recinto/evento distinto', async () => {
      (subirFotoActa as jest.Mock).mockResolvedValueOnce({ url: 'actas/instalacion.bin' });
      await capturarYSubirActa(CONTEXTO, 'instalacion', 'file:///cache/a.jpg');

      const estadoOtroContexto = await restaurarActas('evt2_r9');

      expect(estadoOtroContexto).toEqual({});
    });
  });

  describe('limpiarActas', () => {
    it('borra los archivos locales y el registro tras confirmar la salida del recinto', async () => {
      (subirFotoActa as jest.Mock)
        .mockResolvedValueOnce({ url: 'actas/instalacion.bin' })
        .mockResolvedValueOnce({ url: 'actas/escrutinio.bin' });
      await capturarYSubirActa(CONTEXTO, 'instalacion', 'file:///cache/a.jpg');
      await capturarYSubirActa(CONTEXTO, 'escrutinio', 'file:///cache/b.jpg');

      await limpiarActas(CONTEXTO);

      expect(FileSystem.deleteAsync).toHaveBeenCalledWith(`${DIRECTORIO}instalacion.jpg`, { idempotent: true });
      expect(FileSystem.deleteAsync).toHaveBeenCalledWith(`${DIRECTORIO}escrutinio.jpg`, { idempotent: true });
      expect(await restaurarActas(CONTEXTO)).toEqual({});
    });
  });
});
