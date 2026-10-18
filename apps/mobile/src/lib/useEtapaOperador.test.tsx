import { act, create } from 'react-test-renderer';
import { Alert, AppState, Text } from 'react-native';

jest.mock('./queries/tracking', () => {
  const getMiAsignacion = jest.fn();
  return {
    getMiAsignacion,
    // Mismo comportamiento con señal: delega en el mock de getMiAsignacion.
    getMiAsignacionConOrigen: jest.fn(async () => ({ data: await getMiAsignacion(), desdeCache: false })),
  };
});

jest.mock('./offline-queue', () => ({ contarPendientes: jest.fn().mockResolvedValue(0) }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEtapaOperador } from './useEtapaOperador';
import { getMiAsignacion, getMiAsignacionConOrigen } from './queries/tracking';
import { contarPendientes } from './offline-queue';
import { guardarEtapa, leerEtapa } from './cache-jornada';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const registros = (n: number) => ({
  yaRegistroSalida: n >= 1,
  yaRegistroLlegada: n >= 2,
  yaRegistroSalidaRecinto: n >= 3,
  yaRegistroLlegadaDpi: n >= 4,
});
const EN_TRANSITO = registros(1);
const EN_RETORNO = registros(3);
const RETORNADO = registros(4);

// Mismo harness que useMiAsignacion.test.tsx: no hay librería de testing de hooks.
let ultimo: ReturnType<typeof useEtapaOperador> | null = null;
function Harness() {
  ultimo = useEtapaOperador();
  return <Text>harness</Text>;
}

describe('useEtapaOperador', () => {
  let listener: ((state: string) => void) | undefined;
  let remove: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    ultimo = null;
    listener = undefined;
    remove = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
      listener = cb as (state: string) => void;
      return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function montar() {
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Harness />);
      await flushPromises();
    });
    return renderer;
  }

  async function volverAlForeground(state = 'active') {
    await act(async () => {
      listener?.(state);
      await flushPromises();
    });
  }

  it('arranca en la etapa que indica el servidor', async () => {
    (getMiAsignacion as jest.Mock).mockResolvedValue(EN_TRANSITO);
    await montar();
    expect(ultimo?.etapa).toBe('EN_TRANSITO');
  });

  it('al volver al foreground avanza si el servidor va adelante (hallazgo 3)', async () => {
    (getMiAsignacion as jest.Mock).mockResolvedValueOnce(EN_TRANSITO).mockResolvedValueOnce(EN_RETORNO);
    await montar();
    await volverAlForeground();
    expect(ultimo?.etapa).toBe('EN_RETORNO');
  });

  it('no consulta al servidor en eventos que no son "active"', async () => {
    (getMiAsignacion as jest.Mock).mockResolvedValue(EN_TRANSITO);
    await montar();
    await volverAlForeground('background');
    expect(getMiAsignacion).toHaveBeenCalledTimes(1);
  });

  it('si el primer sync falla arranca en SALIDA y un "active" posterior corrige', async () => {
    (getMiAsignacion as jest.Mock).mockRejectedValueOnce(new Error('red')).mockResolvedValueOnce(EN_TRANSITO);
    await montar();
    expect(ultimo?.etapa).toBe('SALIDA');
    await volverAlForeground();
    expect(ultimo?.etapa).toBe('EN_TRANSITO');
  });

  it('si un sync posterior falla conserva la etapa actual', async () => {
    (getMiAsignacion as jest.Mock).mockResolvedValueOnce(EN_RETORNO).mockRejectedValueOnce(new Error('red'));
    await montar();
    await volverAlForeground();
    expect(ultimo?.etapa).toBe('EN_RETORNO');
  });

  it('un sync lento que responde tras un avance local no retrocede', async () => {
    let resolverLento!: (v: unknown) => void;
    (getMiAsignacion as jest.Mock)
      .mockResolvedValueOnce(EN_TRANSITO)
      .mockImplementationOnce(() => new Promise((r) => (resolverLento = r)));
    await montar();
    await volverAlForeground();
    await act(async () => ultimo?.avanzarA('EN_RETORNO'));
    await act(async () => {
      resolverLento(EN_TRANSITO);
      await flushPromises();
    });
    expect(ultimo?.etapa).toBe('EN_RETORNO');
  });

  it('avanzarA no retrocede si el servidor ya movió la etapa más adelante', async () => {
    (getMiAsignacion as jest.Mock).mockResolvedValue(RETORNADO);
    await montar();
    await act(async () => ultimo?.avanzarA('EN_RETORNO'));
    expect(ultimo?.etapa).toBe('RETORNADO');
  });

  describe('aviso cuando el servidor mueve de pantalla', () => {
    let alerta: jest.SpyInstance;
    beforeEach(() => {
      alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    });

    it('avisa si un sync en foreground avanza la etapa', async () => {
      (getMiAsignacion as jest.Mock).mockResolvedValueOnce(EN_TRANSITO).mockResolvedValueOnce(EN_RETORNO);
      await montar();
      await volverAlForeground();
      expect(alerta).toHaveBeenCalledTimes(1);
      expect(alerta.mock.calls[0][1]).toMatch(/salida del recinto/i);
    });

    it('no avisa en la carga inicial', async () => {
      (getMiAsignacion as jest.Mock).mockResolvedValue(EN_RETORNO);
      await montar();
      expect(alerta).not.toHaveBeenCalled();
    });

    it('no avisa si el servidor no cambia la etapa', async () => {
      (getMiAsignacion as jest.Mock).mockResolvedValue(EN_TRANSITO);
      await montar();
      await volverAlForeground();
      expect(alerta).not.toHaveBeenCalled();
    });

    it('no avisa si el servidor va atrás (acción en la cola offline)', async () => {
      (getMiAsignacion as jest.Mock).mockResolvedValue(EN_TRANSITO);
      await montar();
      await act(async () => ultimo?.avanzarA('EN_RETORNO'));
      await volverAlForeground();
      expect(alerta).not.toHaveBeenCalled();
    });

    it('no avisa por avances locales del propio operador', async () => {
      (getMiAsignacion as jest.Mock).mockResolvedValue(EN_TRANSITO);
      await montar();
      await act(async () => ultimo?.avanzarA('LLEGADA'));
      expect(alerta).not.toHaveBeenCalled();
    });
  });

  it('limpia el listener de AppState al desmontar', async () => {
    (getMiAsignacion as jest.Mock).mockResolvedValue(EN_TRANSITO);
    const renderer = await montar();
    act(() => renderer.unmount());
    expect(remove).toHaveBeenCalledTimes(1);
  });

  describe('etapa guardada en el celular (abrir sin señal)', () => {
    const conEvento = (n: number, eventoId = 'ev1') => ({ ...registros(n), eventoId });

    beforeEach(async () => {
      await AsyncStorage.clear();
      (contarPendientes as jest.Mock).mockResolvedValue(0);
    });

    it('sin señal retoma la etapa guardada del mismo evento en vez de volver a SALIDA', async () => {
      await guardarEtapa('ev1', 'EN_RECINTO');
      // Copia local desactualizada: se guardó antes de registrar la salida del DPI.
      (getMiAsignacionConOrigen as jest.Mock).mockResolvedValueOnce({ data: conEvento(0), desdeCache: true });

      await montar();

      expect(ultimo?.etapa).toBe('EN_RECINTO');
    });

    it('ignora la etapa guardada de otro evento', async () => {
      await guardarEtapa('ev-viejo', 'RETORNADO');
      (getMiAsignacionConOrigen as jest.Mock).mockResolvedValueOnce({ data: conEvento(1), desdeCache: true });

      await montar();

      expect(ultimo?.etapa).toBe('EN_TRANSITO');
    });

    it('con señal y nada pendiente manda el servidor (p. ej. tras "Resetear estado")', async () => {
      await guardarEtapa('ev1', 'EN_RETORNO');
      (getMiAsignacion as jest.Mock).mockResolvedValue(conEvento(0));

      await montar();

      expect(ultimo?.etapa).toBe('SALIDA');
    });

    it('al quedar en SALIDA (p. ej. tras "Resetear estado") olvida el pitido a 200 m ya dado en ese evento', async () => {
      await AsyncStorage.setItem('cne:jornada:aviso:ev1:IDA', 'x');
      await AsyncStorage.setItem('cne:jornada:aviso:ev1:RETORNO', 'x');
      (getMiAsignacion as jest.Mock).mockResolvedValue(conEvento(0));

      await montar();
      await act(async () => {
        await flushPromises();
      });

      await expect(AsyncStorage.getItem('cne:jornada:aviso:ev1:IDA')).resolves.toBeNull();
      await expect(AsyncStorage.getItem('cne:jornada:aviso:ev1:RETORNO')).resolves.toBeNull();
    });

    it('en camino conserva el pitido ya dado (no vuelve a sonar al reabrir la app)', async () => {
      await AsyncStorage.setItem('cne:jornada:aviso:ev1:IDA', 'x');
      (getMiAsignacion as jest.Mock).mockResolvedValue(conEvento(1));

      await montar();
      await act(async () => {
        await flushPromises();
      });

      await expect(AsyncStorage.getItem('cne:jornada:aviso:ev1:IDA')).resolves.toBe('x');
    });

    it('con señal pero acciones pendientes de enviar conserva la etapa guardada', async () => {
      await guardarEtapa('ev1', 'EN_RECINTO');
      (contarPendientes as jest.Mock).mockResolvedValue(1);
      (getMiAsignacion as jest.Mock).mockResolvedValue(conEvento(1));

      await montar();

      expect(ultimo?.etapa).toBe('EN_RECINTO');
    });

    it('guarda cada avance con el evento de la asignación', async () => {
      (getMiAsignacion as jest.Mock).mockResolvedValue(conEvento(1));
      await montar();

      await act(async () => {
        ultimo!.avanzarA('LLEGADA');
        await flushPromises();
      });

      await expect(leerEtapa()).resolves.toEqual({ eventoId: 'ev1', etapa: 'LLEGADA' });
    });

    it('cuenta lo pendiente antes de pedir la asignación (evita retroceder por un flush concurrente)', async () => {
      await guardarEtapa('ev1', 'EN_RECINTO');
      // La cola tenía 1 acción al abrir; mientras se esperaba al servidor, un flush la vació.
      (contarPendientes as jest.Mock).mockResolvedValueOnce(1).mockResolvedValue(0);
      (getMiAsignacion as jest.Mock).mockResolvedValue(conEvento(1));

      await montar();

      expect(ultimo?.etapa).toBe('EN_RECINTO');
    });

    it('si cambia el evento, la etapa del anterior no se arrastra ni se guarda con el nuevo', async () => {
      (getMiAsignacion as jest.Mock)
        .mockResolvedValueOnce(conEvento(4, 'ev1'))
        .mockResolvedValueOnce(conEvento(0, 'ev2'));
      await montar();
      expect(ultimo?.etapa).toBe('RETORNADO');

      await volverAlForeground();

      expect(ultimo?.etapa).toBe('SALIDA');
      await expect(leerEtapa()).resolves.toEqual({ eventoId: 'ev2', etapa: 'SALIDA' });
    });
  });
});

