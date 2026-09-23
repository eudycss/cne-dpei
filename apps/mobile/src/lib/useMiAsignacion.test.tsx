import { act, create } from 'react-test-renderer';
import { AppState, Text } from 'react-native';
import type { MiAsignacionResponse } from '@cne/shared-types';

jest.mock('./queries/tracking', () => ({ getMiAsignacion: jest.fn() }));

import { useMiAsignacion } from './useMiAsignacion';
import { getMiAsignacion } from './queries/tracking';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));
const networkError = { isAxiosError: true, response: undefined };

const asignacionFixture: MiAsignacionResponse = {
  eventoId: 'ev1',
  eventoNombre: 'Elecciones 2026',
  recinto: {
    id: 'r1',
    codigoRecinto: 'R001',
    nombre: 'Escuela Central',
    direccion: null,
    cantonNombre: null,
    parroquia: null,
    juntasFemeninas: null,
    juntasMasculinas: null,
    llegadaRegistradaEn: null,
    latitud: -0.35,
    longitud: -78.12,
  },
  noCdas: [],
  militar: null,
  kits: [],
  yaRegistroSalida: true,
  yaRegistroLlegada: false,
  yaRegistroSalidaRecinto: false,
  yaRegistroLlegadaDpi: false,
  fotoMilitarUrl: null,
  margenLlegadaMetros: 100,
  delegacion: null,
  margenLlegadaDpiMetros: 150,
};

// No hay librería de testing de hooks instalada en el proyecto (ver
// convención de useProximidad.test.tsx); se monta un componente mínimo que
// expone el resultado del hook en una variable de módulo.
let ultimoResultado: ReturnType<typeof useMiAsignacion> | null = null;
function Harness() {
  ultimoResultado = useMiAsignacion();
  return <Text>harness</Text>;
}

describe('useMiAsignacion', () => {
  let capturedListener: ((state: string) => void) | undefined;
  let removeMocks: jest.Mock[];

  beforeEach(() => {
    jest.clearAllMocks();
    ultimoResultado = null;
    capturedListener = undefined;
    removeMocks = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, cb) => {
      capturedListener = cb as (state: string) => void;
      const remove = jest.fn();
      removeMocks.push(remove);
      return { remove } as ReturnType<typeof AppState.addEventListener>;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reintenta getMiAsignacion cuando AppState pasa a "active" estando sin conexión', async () => {
    (getMiAsignacion as jest.Mock).mockRejectedValueOnce(networkError);
    (getMiAsignacion as jest.Mock).mockResolvedValueOnce(asignacionFixture);

    await act(async () => {
      create(<Harness />);
      await flushPromises();
    });

    expect(ultimoResultado!.sinConexion).toBe(true);
    expect(getMiAsignacion).toHaveBeenCalledTimes(1);

    await act(async () => {
      capturedListener!('active');
      await flushPromises();
    });

    expect(getMiAsignacion).toHaveBeenCalledTimes(2);
    expect(ultimoResultado!.sinConexion).toBe(false);
    expect(ultimoResultado!.asignacion).toEqual(asignacionFixture);
  });

  it('no reintenta si AppState pasa a "active" pero ya había conexión', async () => {
    (getMiAsignacion as jest.Mock).mockResolvedValue(asignacionFixture);

    await act(async () => {
      create(<Harness />);
      await flushPromises();
    });

    expect(getMiAsignacion).toHaveBeenCalledTimes(1);

    await act(async () => {
      capturedListener!('active');
      await flushPromises();
    });

    expect(getMiAsignacion).toHaveBeenCalledTimes(1);
  });

  it('limpia el listener de AppState al desmontar', async () => {
    (getMiAsignacion as jest.Mock).mockResolvedValue(asignacionFixture);

    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<Harness />);
      await flushPromises();
    });

    expect(removeMocks).toHaveLength(1);

    await act(async () => {
      renderer.unmount();
    });

    expect(removeMocks[0]).toHaveBeenCalledTimes(1);
  });
});
