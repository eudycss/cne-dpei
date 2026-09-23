import { act, create, ReactTestRenderer, TestInstance } from 'react-test-renderer';
import { Pressable, Text } from 'react-native';

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

import { ErrorBoundary } from './ErrorBoundary';

function pressableAncestor(instance: TestInstance): TestInstance {
  let node: TestInstance | null = instance;
  while (node && node.type !== Pressable) node = node.parent;
  if (!node) throw new Error('No se encontró un <Pressable> ancestro');
  return node;
}

describe('ErrorBoundary', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renderiza los children normalmente cuando no hay error', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ErrorBoundary>
          <Text>contenido normal</Text>
        </ErrorBoundary>,
      );
    });

    expect(renderer.root.findByProps({ children: 'contenido normal' })).toBeTruthy();
  });

  it('muestra el fallback si un hijo lanza una excepción al renderizar', () => {
    function Boom(): null {
      throw new Error('boom');
    }

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      );
    });

    expect(renderer.root.findByProps({ children: 'Algo salió mal' })).toBeTruthy();
  });

  it('el botón "Reintentar" resetea el boundary y vuelve a mostrar contenido normal', () => {
    let shouldThrow = true;
    function MaybeBoom(): JSX.Element {
      if (shouldThrow) throw new Error('boom');
      return <Text>contenido recuperado</Text>;
    }

    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <ErrorBoundary>
          <MaybeBoom />
        </ErrorBoundary>,
      );
    });

    expect(renderer.root.findByProps({ children: 'Algo salió mal' })).toBeTruthy();

    shouldThrow = false;
    const boton = pressableAncestor(renderer.root.findByProps({ children: 'Reintentar' }));
    act(() => {
      boton.props.onPress();
    });

    expect(renderer.root.findByProps({ children: 'contenido recuperado' })).toBeTruthy();
  });
});
