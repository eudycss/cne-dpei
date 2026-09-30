import { act, create } from 'react-test-renderer';
import { AppState, Text } from 'react-native';

jest.mock('./location', () => ({
  asegurarRastreoSiHayPermiso: jest.fn(),
  activarRastreoSegundoPlano: jest.fn(),
}));

import { useEstadoRastreo } from './useEstadoRastreo';
import { activarRastreoSegundoPlano, asegurarRastreoSiHayPermiso } from './location';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

// Mismo harness que useEtapaOperador.test.tsx: no hay librería de testing de hooks.
let ultimo: ReturnType<typeof useEstadoRastreo> | null = null;
function Harness() {
  ultimo = useEstadoRastreo();
  return <Text>harness</Text>;
}

describe('useEstadoRastreo', () => {
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

  it("arranca en 'verificando' y pasa a 'activo' si el rastreo corre", async () => {
    (asegurarRastreoSiHayPermiso as jest.Mock).mockResolvedValue(true);
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Harness />);
    });
    expect(ultimo!.estado).toBe('verificando');

    await act(async () => {
      await flushPromises();
    });
    expect(ultimo!.estado).toBe('activo');
    renderer.unmount();
  });

  it("queda 'inactivo' si el rastreo no arrancó", async () => {
    (asegurarRastreoSiHayPermiso as jest.Mock).mockResolvedValue(false);
    await montar();
    expect(ultimo!.estado).toBe('inactivo');
  });

  it('re-verifica al volver al foreground (p. ej. tras conceder el permiso en Ajustes)', async () => {
    (asegurarRastreoSiHayPermiso as jest.Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await montar();
    expect(ultimo!.estado).toBe('inactivo');

    await act(async () => {
      listener?.('active');
      await flushPromises();
    });
    expect(ultimo!.estado).toBe('activo');
  });

  it('ignora cambios de AppState que no son foreground', async () => {
    (asegurarRastreoSiHayPermiso as jest.Mock).mockResolvedValue(false);
    await montar();
    await act(async () => {
      listener?.('background');
      await flushPromises();
    });
    expect(asegurarRastreoSiHayPermiso).toHaveBeenCalledTimes(1);
  });

  it("activar(): si el permiso se niega marca permisoDenegado y sigue 'inactivo'", async () => {
    (asegurarRastreoSiHayPermiso as jest.Mock).mockResolvedValue(false);
    (activarRastreoSegundoPlano as jest.Mock).mockResolvedValue('fallo');
    await montar();

    await act(async () => {
      await ultimo!.activar();
    });
    expect(ultimo!.permisoDenegado).toBe(true);
    expect(ultimo!.estado).toBe('inactivo');
    expect(ultimo!.activando).toBe(false);
  });

  it("activar(): si arranca pasa a 'activo'", async () => {
    (asegurarRastreoSiHayPermiso as jest.Mock).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    (activarRastreoSegundoPlano as jest.Mock).mockResolvedValue('activo');
    await montar();

    await act(async () => {
      await ultimo!.activar();
    });
    expect(ultimo!.estado).toBe('activo');
    expect(ultimo!.permisoDenegado).toBe(false);
  });

  it('quita el listener de AppState al desmontar', async () => {
    (asegurarRastreoSiHayPermiso as jest.Mock).mockResolvedValue(true);
    const renderer = await montar();
    act(() => renderer.unmount());
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
