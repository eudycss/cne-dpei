import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { AccessibilityInfo, Pressable } from 'react-native';

const mockEstado = { pendientes: 0, rechazadas: [] as unknown[], descartar: jest.fn() };
jest.mock('../lib/offline-queue', () => ({ useEstadoSincronizacion: () => mockEstado }));
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000' }) }),
}));

import { EstadoSincronizacion, nombreRegistro } from './EstadoSincronizacion';

const rechazo = {
  id: 'a1',
  endpoint: '/tracking/llegada-recinto',
  motivo: 'Estás a 900 m del recinto.',
  registradaEn: '2026-10-16T15:00:00.000Z',
  rechazadaEn: '2026-10-16T16:00:00.000Z',
};

function montar() {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(<EstadoSincronizacion />);
  });
  return r;
}

describe('EstadoSincronizacion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEstado.pendientes = 0;
    mockEstado.rechazadas = [];
    mockEstado.descartar = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('no muestra nada si no hay pendientes ni rechazos', () => {
    expect(montar().root.findAllByType(Pressable)).toHaveLength(0);
  });

  it('muestra los pendientes con una etiqueta accesible y explica que se enviarán solos', () => {
    mockEstado.pendientes = 2;
    const r = montar();

    const badge = r.root.findByProps({ accessibilityLabel: '2 registro(s) sin enviar. Se enviarán al recuperar señal.' });
    act(() => badge.props.onPress());

    expect(r.root.findAllByProps({ children: 'Sin conexión' }).length).toBeGreaterThan(0);
  });

  it('muestra los rechazos con su motivo, los anuncia y permite quitarlos', async () => {
    mockEstado.rechazadas = [rechazo];
    const r = montar();

    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(expect.stringContaining('1 registro(s)'));
    act(() => r.root.findByProps({ accessibilityLabel: '1 registro(s) no se pudieron enviar. Ver el motivo.' }).props.onPress());
    expect(r.root.findAllByProps({ children: 'Estás a 900 m del recinto.' }).length).toBeGreaterThan(0);

    const quitar = r.root.findByProps({ children: 'Ya avisé, quitar' });
    let nodo = quitar.parent;
    while (nodo && nodo.type !== Pressable) nodo = nodo.parent;
    await act(async () => {
      await nodo!.props.onPress();
    });
    expect(mockEstado.descartar).toHaveBeenCalled();
  });

  it('traduce los endpoints a nombres que entiende el operador', () => {
    expect(nombreRegistro('/tracking/recepcion-kit')).toBe('Recepción de kit');
    expect(nombreRegistro('/otro')).toBe('Registro');
  });
});
