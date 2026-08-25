import { ActivityIndicator, Text } from 'react-native';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import type { OperadorEnRetorno } from '@cne/shared-types';

// react-native-testing-library no está instalado; se usa react-test-renderer
// directamente (mismo patrón que EnTransitoScreen.test.tsx/SalidaDpiScreen.test.tsx).
jest.setTimeout(30000);

jest.mock('react-native-webview', () => ({
  WebView: require('react').forwardRef(() => null),
}));

jest.mock('../lib/queries/monitoreo', () => ({
  getOperadoresEnRetorno: jest.fn(),
}));

jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ logout: jest.fn() }),
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

jest.mock('../components/AppBar', () => ({ AppBar: () => null }));

import { MonitoreoScreen } from './MonitoreoScreen';
import { getOperadoresEnRetorno } from '../lib/queries/monitoreo';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const operadorTransito: OperadorEnRetorno = {
  operadorId: 'op-transito',
  operadorNombre: 'Carla Suárez',
  latitud: 0.36,
  longitud: -78.13,
  capturadoEn: '2026-07-01T09:30:00.000Z',
  kits: [],
  estado: 'EN_TRANSITO',
};

const operadorRetorno: OperadorEnRetorno = {
  operadorId: 'op-retorno',
  operadorNombre: 'Juan Pérez',
  latitud: 0.35,
  longitud: -78.12,
  capturadoEn: '2026-07-01T10:00:00.000Z',
  kits: [{ id: 'k1', codigoUnico: 'KIT-001', nombre: 'Kit A' }],
  estado: 'EN_RETORNO',
};

function textoDe(t: { props: { children: unknown } }): string {
  const c = t.props.children;
  return Array.isArray(c) ? c.join('') : String(c ?? '');
}

function textoDeFila(renderer: ReactTestRenderer, nombre: string): string {
  const nombreInstance = renderer.root.findByProps({ children: nombre });
  const fila = nombreInstance.parent!;
  return fila.findAllByType(Text).map(textoDe).join(' ');
}

function todoElTexto(renderer: ReactTestRenderer): string {
  return renderer.root.findAllByType(Text).map(textoDe).join(' ');
}

describe('MonitoreoScreen', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(async () => {
    // El poll (setInterval) solo se limpia al desmontar — sin esto, el timer
    // de una prueba sigue vivo y actualiza estado fuera de act() en la siguiente.
    if (renderer) {
      await act(async () => {
        renderer!.unmount();
      });
      renderer = undefined;
    }
  });

  it('muestra un indicador de carga mientras llega la primera respuesta', async () => {
    (getOperadoresEnRetorno as jest.Mock).mockReturnValue(new Promise(() => {}));

    await act(async () => {
      renderer = create(<MonitoreoScreen />);
      await flushPromises();
    });

    expect(renderer!.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);
  });

  it('muestra el error si la carga falla', async () => {
    (getOperadoresEnRetorno as jest.Mock).mockRejectedValue({
      response: { data: { message: 'No se pudo cargar el monitoreo' } },
    });

    await act(async () => {
      renderer = create(<MonitoreoScreen />);
      await flushPromises();
    });

    expect(renderer!.root.findByProps({ children: 'No se pudo cargar el monitoreo' })).toBeTruthy();
  });

  it('muestra el estado vacío cuando no hay operadores en tránsito ni en retorno', async () => {
    (getOperadoresEnRetorno as jest.Mock).mockResolvedValue([]);

    await act(async () => {
      renderer = create(<MonitoreoScreen />);
      await flushPromises();
    });

    expect(
      renderer!.root.findByProps({ children: 'No hay operadores en tránsito ni en retorno en este momento.' }),
    ).toBeTruthy();
  });

  it('lista operadores en ambos tramos, diferenciando ida de retorno', async () => {
    (getOperadoresEnRetorno as jest.Mock).mockResolvedValue([operadorTransito, operadorRetorno]);

    await act(async () => {
      renderer = create(<MonitoreoScreen />);
      await flushPromises();
    });

    expect(todoElTexto(renderer!)).toContain('En ruta (2)');
    expect(textoDeFila(renderer!, 'Carla Suárez')).toContain('En tránsito');
    expect(textoDeFila(renderer!, 'Juan Pérez')).toContain('En retorno');
  });
});
