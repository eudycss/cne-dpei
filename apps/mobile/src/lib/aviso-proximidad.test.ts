import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { MiAsignacionResponse } from '@cne/shared-types';
import { guardarAsignacion, guardarEtapa, limpiarCacheJornada, reiniciarAvisos } from './cache-jornada';
import {
  objetivoDelTramo,
  pedirPermisoAvisos,
  RADIO_AVISO_METROS,
  revisarProximidad,
} from './aviso-proximidad';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('id'),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  AndroidImportance: { MAX: 5 },
  AndroidNotificationPriority: { MAX: 'max' },
  AndroidNotificationVisibility: { PUBLIC: 1 },
}));
jest.mock('./offline-queue', () => ({ vaciarCola: jest.fn().mockResolvedValue(undefined) }));
jest.mock('./offline-foto-militar', () => ({ limpiarFotosMilitar: jest.fn().mockResolvedValue(undefined) }));

const programar = Notifications.scheduleNotificationAsync as jest.Mock;

// Recinto de prueba y la Delegación real (Ibarra).
const RECINTO = { latitud: 0.3394, longitud: -78.1222 };
const DELEGACION = { latitud: 0.35849, longitud: -78.11886 };
// ~0.0009° de latitud ≈ 100 m; ~0.0045° ≈ 500 m.
const cerca = (c: { latitud: number; longitud: number }) => ({ ...c, latitud: c.latitud + 0.0009, precisionMetros: 10 });
const lejos = (c: { latitud: number; longitud: number }) => ({ ...c, latitud: c.latitud + 0.0045, precisionMetros: 10 });

function asignacion(over: Partial<MiAsignacionResponse> = {}): MiAsignacionResponse {
  return {
    eventoId: 'ev1',
    recinto: { id: 'r1', nombre: 'Unidad Educativa Apuela', ...RECINTO },
    delegacion: DELEGACION,
    yaRegistroSalida: true,
    yaRegistroLlegada: false,
    yaRegistroSalidaRecinto: false,
    yaRegistroLlegadaDpi: false,
    ...over,
  } as MiAsignacionResponse;
}

describe('aviso-proximidad', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  });

  describe('objetivoDelTramo', () => {
    it('en la ida apunta al recinto y en el retorno a la Delegación', () => {
      expect(objetivoDelTramo(asignacion(), 'EN_TRANSITO')).toMatchObject({ tramo: 'IDA', coordenada: RECINTO });
      expect(objetivoDelTramo(asignacion(), 'EN_RETORNO')).toMatchObject({ tramo: 'RETORNO', coordenada: DELEGACION });
    });

    it('fuera de camino o sin coordenadas no hay objetivo', () => {
      expect(objetivoDelTramo(asignacion(), 'SALIDA')).toBeNull();
      expect(objetivoDelTramo(asignacion(), 'EN_RECINTO')).toBeNull();
      expect(objetivoDelTramo(asignacion(), 'RETORNADO')).toBeNull();
      const sinCoords = asignacion({ recinto: { id: 'r1', nombre: 'X', latitud: null, longitud: null } as any });
      expect(objetivoDelTramo(sinCoords, 'EN_TRANSITO')).toBeNull();
      expect(objetivoDelTramo(asignacion({ delegacion: null }), 'EN_RETORNO')).toBeNull();
    });
  });

  describe('revisarProximidad', () => {
    it(`avisa al entrar a ${RADIO_AVISO_METROS} m del recinto, una sola vez por tramo`, async () => {
      await guardarAsignacion(asignacion());

      await expect(revisarProximidad(lejos(RECINTO))).resolves.toBe(false);
      await expect(revisarProximidad(cerca(RECINTO))).resolves.toBe(true);
      await expect(revisarProximidad(cerca(RECINTO))).resolves.toBe(false);

      expect(programar).toHaveBeenCalledTimes(1);
      expect(programar.mock.calls[0][0].content.title).toContain('Unidad Educativa Apuela');
    });

    it('en el retorno avisa cerca de la Delegación aunque ya haya avisado en la ida', async () => {
      await guardarAsignacion(asignacion());
      await revisarProximidad(cerca(RECINTO));
      await guardarAsignacion(asignacion({ yaRegistroLlegada: true, yaRegistroSalidaRecinto: true }));

      await expect(revisarProximidad(cerca(RECINTO))).resolves.toBe(false);
      await expect(revisarProximidad(cerca(DELEGACION))).resolves.toBe(true);
      expect(programar).toHaveBeenCalledTimes(2);
      expect(programar.mock.calls[1][0].content.title).toContain('la Delegación');
    });

    it('usa la etapa guardada en el celular si va adelante de la copia (registro aún en la cola)', async () => {
      await guardarAsignacion(asignacion({ yaRegistroSalida: false }));
      await guardarEtapa('ev1', 'EN_TRANSITO');

      await expect(revisarProximidad(cerca(RECINTO))).resolves.toBe(true);
    });

    it('ignora la etapa guardada de otro evento', async () => {
      await guardarAsignacion(asignacion({ yaRegistroSalida: false }));
      await guardarEtapa('ev-viejo', 'EN_TRANSITO');

      await expect(revisarProximidad(cerca(RECINTO))).resolves.toBe(false);
    });

    it('sin permiso de notificaciones no marca: avisa cuando el operador lo concede', async () => {
      await guardarAsignacion(asignacion());
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });

      await expect(revisarProximidad(cerca(RECINTO))).resolves.toBe(false);
      expect(programar).not.toHaveBeenCalled();

      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
      await expect(revisarProximidad(cerca(RECINTO))).resolves.toBe(true);
    });

    it('en Android usa el canal con sonido y vibración y dispara de inmediato', async () => {
      const original = Platform.OS;
      Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
      try {
        await guardarAsignacion(asignacion());
        await revisarProximidad(cerca(RECINTO));

        expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
          'aviso-proximidad',
          expect.objectContaining({ sound: 'default', enableVibrate: true }),
        );
        expect(programar.mock.calls[0][0].trigger).toEqual({ channelId: 'aviso-proximidad' });
      } finally {
        Object.defineProperty(Platform, 'OS', { configurable: true, get: () => original });
      }
    });

    it('descarta posiciones imprecisas', async () => {
      await guardarAsignacion(asignacion());

      await expect(revisarProximidad({ ...cerca(RECINTO), precisionMetros: 400 })).resolves.toBe(false);
      expect(programar).not.toHaveBeenCalled();
    });

    it('sin copia de la asignación no hace nada', async () => {
      await expect(revisarProximidad(cerca(RECINTO))).resolves.toBe(false);
    });

    it('al reiniciar la jornada (etapa SALIDA) vuelve a avisar en el siguiente recorrido', async () => {
      await guardarAsignacion(asignacion());
      await revisarProximidad(cerca(RECINTO));

      await guardarAsignacion(asignacion({ yaRegistroSalida: false }));
      await revisarProximidad(cerca(RECINTO));
      await guardarAsignacion(asignacion());

      await expect(revisarProximidad(cerca(RECINTO))).resolves.toBe(true);
      expect(programar).toHaveBeenCalledTimes(2);
    });

    it('reiniciarAvisos (jornada reseteada) vuelve a avisar solo en ese evento', async () => {
      await guardarAsignacion(asignacion());
      await revisarProximidad(cerca(RECINTO));
      await AsyncStorage.setItem('cne:jornada:aviso:otro-evento:IDA', 'x');

      await reiniciarAvisos('ev1');

      await expect(AsyncStorage.getItem('cne:jornada:aviso:otro-evento:IDA')).resolves.toBe('x');
      await expect(revisarProximidad(cerca(RECINTO))).resolves.toBe(true);
    });

    it('cerrar sesión borra las marcas de aviso', async () => {
      await guardarAsignacion(asignacion());
      await revisarProximidad(cerca(RECINTO));

      await limpiarCacheJornada();
      const claves = await AsyncStorage.getAllKeys();
      expect(claves.filter((k) => k.startsWith('cne:jornada:aviso:'))).toEqual([]);
    });

    it('dos posiciones a la vez no avisan dos veces', async () => {
      await guardarAsignacion(asignacion());

      const resultados = await Promise.all([revisarProximidad(cerca(RECINTO)), revisarProximidad(cerca(RECINTO))]);
      expect(resultados.filter(Boolean)).toHaveLength(1);
      expect(programar).toHaveBeenCalledTimes(1);
    });

    it('si la notificación falla no lanza ni reintenta en cada posición', async () => {
      await guardarAsignacion(asignacion());
      programar.mockRejectedValueOnce(new Error('sin permiso'));

      await expect(revisarProximidad(cerca(RECINTO))).resolves.toBe(false);
      await expect(revisarProximidad(cerca(RECINTO))).resolves.toBe(false);
      expect(programar).toHaveBeenCalledTimes(1);
    });
  });

  describe('pedirPermisoAvisos', () => {
    it('no vuelve a preguntar si ya está concedido', async () => {
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
      await expect(pedirPermisoAvisos()).resolves.toBe(true);
      expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
    });

    it('pide el permiso si se puede y devuelve la respuesta', async () => {
      (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false, canAskAgain: true });
      (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
      await expect(pedirPermisoAvisos()).resolves.toBe(false);
    });

    it('un error del módulo no rompe la pantalla', async () => {
      (Notifications.getPermissionsAsync as jest.Mock).mockRejectedValue(new Error('nativo'));
      await expect(pedirPermisoAvisos()).resolves.toBe(false);
    });
  });
});
