import * as Notifications from 'expo-notifications';
import type { MiAsignacionRecinto, MiAsignacionResponse } from '@cne/shared-types';
import {
  cancelarAvisoNoCda,
  ID_AVISO_NO_CDA,
  INTERVALO_AVISO_NO_CDA_S,
  noCdasPendientes,
  sincronizarAvisoNoCda,
  textoFaltan,
} from './aviso-no-cda';

jest.mock('expo-notifications', () => ({
  setNotificationChannelAsync: jest.fn().mockResolvedValue(null),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('id'),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  getPermissionsAsync: jest.fn(),
  AndroidImportance: { MAX: 5 },
  AndroidNotificationPriority: { MAX: 'max' },
  AndroidNotificationVisibility: { PUBLIC: 1 },
}));

const programar = Notifications.scheduleNotificationAsync as jest.Mock;
const cancelar = Notifications.cancelScheduledNotificationAsync as jest.Mock;
const permisos = Notifications.getPermissionsAsync as jest.Mock;

function nc(id: string, llegadaRegistradaEn: string | null = null): MiAsignacionRecinto {
  return { id, codigoRecinto: id, nombre: `NO CDA ${id}`, llegadaRegistradaEn } as MiAsignacionRecinto;
}

describe('noCdasPendientes', () => {
  it('devuelve solo los NO CDA sin llegada marcada', () => {
    const a = { noCdas: [nc('1'), nc('2', '2026-11-23T10:00:00Z'), nc('3')] } as MiAsignacionResponse;
    expect(noCdasPendientes(a).map((x) => x.id)).toEqual(['1', '3']);
  });

  it('sin asignación devuelve lista vacía', () => {
    expect(noCdasPendientes(null)).toEqual([]);
    expect(noCdasPendientes(undefined)).toEqual([]);
  });
});

describe('textoFaltan', () => {
  it('usa singular y plural', () => {
    expect(textoFaltan(1)).toBe('Falta 1 recinto NO CDA');
    expect(textoFaltan(3)).toBe('Faltan 3 recintos NO CDA');
  });
});

describe('sincronizarAvisoNoCda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('con pendientes y permiso programa un aviso repetido con identificador fijo y el número', async () => {
    permisos.mockResolvedValue({ granted: true });
    await sincronizarAvisoNoCda(3);
    expect(programar).toHaveBeenCalledTimes(1);
    const arg = programar.mock.calls[0][0];
    expect(arg.identifier).toBe(ID_AVISO_NO_CDA);
    expect(arg.content.title).toBe('Faltan 3 recintos NO CDA por marcar');
    expect(arg.content.sound).toBe('default');
    expect(arg.trigger).toMatchObject({ seconds: INTERVALO_AVISO_NO_CDA_S, repeats: true });
  });

  it('sin permiso de notificaciones no programa (ni falla)', async () => {
    permisos.mockResolvedValue({ granted: false });
    await sincronizarAvisoNoCda(2);
    expect(programar).not.toHaveBeenCalled();
  });

  it('con 0 pendientes cancela el aviso y no programa', async () => {
    await sincronizarAvisoNoCda(0);
    expect(cancelar).toHaveBeenCalledWith(ID_AVISO_NO_CDA);
    expect(programar).not.toHaveBeenCalled();
  });

  it('nunca lanza aunque falle la notificación', async () => {
    permisos.mockResolvedValue({ granted: true });
    programar.mockRejectedValueOnce(new Error('sin canal'));
    await expect(sincronizarAvisoNoCda(1)).resolves.toBeUndefined();
  });
});

describe('cancelarAvisoNoCda', () => {
  it('nunca lanza aunque falle la cancelación', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    cancelar.mockRejectedValueOnce(new Error('x'));
    await expect(cancelarAvisoNoCda()).resolves.toBeUndefined();
  });
});

describe('orden de programar y cancelar (carrera)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('un programar lento no termina después de un cancelar posterior', async () => {
    const orden: string[] = [];
    let liberarPermiso!: () => void;
    permisos.mockImplementationOnce(
      () => new Promise((resolve) => (liberarPermiso = () => resolve({ granted: true }))),
    );
    programar.mockImplementationOnce(async () => {
      orden.push('programar');
      return 'id';
    });
    cancelar.mockImplementationOnce(async () => {
      orden.push('cancelar');
    });

    const primero = sincronizarAvisoNoCda(1); // queda esperando el permiso
    const segundo = sincronizarAvisoNoCda(0); // se marcó el último NO CDA
    await new Promise((r) => setImmediate(r)); // el primero ya pidió el permiso
    liberarPermiso();
    await Promise.all([primero, segundo]);

    // El cancelar corre después: no queda ningún recordatorio sonando.
    expect(orden).toEqual(['programar', 'cancelar']);
  });

  it('un fallo no traba las llamadas siguientes', async () => {
    permisos.mockResolvedValue({ granted: true });
    programar.mockRejectedValueOnce(new Error('x'));
    await sincronizarAvisoNoCda(2);
    await sincronizarAvisoNoCda(0);
    expect(cancelar).toHaveBeenCalledWith(ID_AVISO_NO_CDA);
  });
});
