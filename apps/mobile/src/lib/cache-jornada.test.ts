import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MiAsignacionResponse } from '@cne/shared-types';
import {
  actualizarCopia,
  guardarAsignacion,
  guardarEtapa,
  leerAsignacion,
  leerEtapa,
  limpiarCacheJornada,
  prepararCacheParaUsuario,
} from './cache-jornada';

jest.mock('./offline-queue', () => ({ vaciarCola: jest.fn().mockResolvedValue(undefined) }));
jest.mock('./offline-foto-militar', () => ({ limpiarFotosMilitar: jest.fn().mockResolvedValue(undefined) }));

import { vaciarCola } from './offline-queue';
import { limpiarFotosMilitar } from './offline-foto-militar';

const asignacion = { eventoId: 'ev1', margenLlegadaMetros: 150 } as MiAsignacionResponse;

describe('cache-jornada', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('guarda y lee la asignación y la etapa', async () => {
    await guardarAsignacion(asignacion);
    await guardarEtapa('ev1', 'EN_RECINTO');

    await expect(leerAsignacion()).resolves.toEqual(asignacion);
    await expect(leerEtapa()).resolves.toEqual({ eventoId: 'ev1', etapa: 'EN_RECINTO' });
  });

  it('sin copia devuelve null', async () => {
    await expect(leerAsignacion()).resolves.toBeNull();
    await expect(leerEtapa()).resolves.toBeNull();
  });

  it('una copia corrupta se trata como si no existiera', async () => {
    await AsyncStorage.setItem('cne:jornada:asignacion', '{no es json');
    await expect(leerAsignacion()).resolves.toBeNull();
  });

  it('limpiarCacheJornada borra la asignación y la etapa', async () => {
    await guardarAsignacion(asignacion);
    await guardarEtapa('ev1', 'EN_RECINTO');

    await limpiarCacheJornada();

    await expect(leerAsignacion()).resolves.toBeNull();
    await expect(leerEtapa()).resolves.toBeNull();
  });

  it('ignora una copia guardada con otra versión de formato', async () => {
    await AsyncStorage.setItem('cne:jornada:asignacion', JSON.stringify({ v: 0, valor: asignacion }));
    await expect(leerAsignacion()).resolves.toBeNull();
  });

  it('actualizarCopia aplica el cambio y no hace nada si no hay copia', async () => {
    await actualizarCopia((a) => ({ ...a, yaRegistroLlegada: true }));
    await expect(leerAsignacion()).resolves.toBeNull();

    await guardarAsignacion(asignacion);
    await actualizarCopia((a) => ({ ...a, yaRegistroLlegada: true }));

    await expect(leerAsignacion()).resolves.toEqual({ ...asignacion, yaRegistroLlegada: true });
  });

  it('dos parches seguidos no se pisan', async () => {
    await guardarAsignacion({ ...asignacion, yaRegistroSalida: false, yaRegistroLlegada: false } as MiAsignacionResponse);

    await Promise.all([
      actualizarCopia((a) => ({ ...a, yaRegistroSalida: true })),
      actualizarCopia((a) => ({ ...a, yaRegistroLlegada: true })),
    ]);

    await expect(leerAsignacion()).resolves.toMatchObject({ yaRegistroSalida: true, yaRegistroLlegada: true });
  });

  it('prepararCacheParaUsuario conserva la copia del mismo operador y descarta la de otro', async () => {
    await prepararCacheParaUsuario('u1');
    await guardarAsignacion(asignacion);

    await prepararCacheParaUsuario('u1');
    await expect(leerAsignacion()).resolves.toEqual(asignacion);

    await prepararCacheParaUsuario('u2');
    await expect(leerAsignacion()).resolves.toBeNull();
  });

  it('limpiarCacheJornada también vacía la cola y borra las fotos del militar del operador anterior', async () => {
    await limpiarCacheJornada();

    expect(vaciarCola).toHaveBeenCalled();
    expect(limpiarFotosMilitar).toHaveBeenCalled();
  });
});
