import { act, create, ReactTestRenderer, TestInstance } from 'react-test-renderer';
import { Pressable } from 'react-native';
import type { NotificacionItem } from '@cne/shared-types';

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

import { NotificacionesModal } from './NotificacionesModal';

function pressableAncestor(instance: TestInstance): TestInstance {
  let node: TestInstance | null = instance;
  while (node && node.type !== Pressable) node = node.parent;
  if (!node) throw new Error('No se encontró un <Pressable> ancestro');
  return node;
}

const item: NotificacionItem = {
  id: 'n1',
  tipoEvento: 'SALIDA_DPI',
  canal: 'PUSH',
  payload: {},
  creadoEn: '2026-09-08T10:00:00.000Z',
  leidaEn: null,
};

describe('NotificacionesModal', () => {
  it('muestra el botón "Cargar más" cuando hayMas=true', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <NotificacionesModal
          visible
          items={[item]}
          noLeidas={1}
          onMarkLeida={jest.fn()}
          onClose={jest.fn()}
          hayMas
          cargandoMas={false}
          onCargarMas={jest.fn()}
        />,
      );
    });

    expect(() => renderer.root.findByProps({ children: 'Cargar más' })).not.toThrow();
  });

  it('no muestra el botón "Cargar más" cuando hayMas=false', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <NotificacionesModal
          visible
          items={[item]}
          noLeidas={1}
          onMarkLeida={jest.fn()}
          onClose={jest.fn()}
          hayMas={false}
          cargandoMas={false}
          onCargarMas={jest.fn()}
        />,
      );
    });

    expect(() => renderer.root.findByProps({ children: 'Cargar más' })).toThrow();
  });

  it('dispara onCargarMas al tocar el botón', () => {
    const onCargarMas = jest.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <NotificacionesModal
          visible
          items={[item]}
          noLeidas={1}
          onMarkLeida={jest.fn()}
          onClose={jest.fn()}
          hayMas
          cargandoMas={false}
          onCargarMas={onCargarMas}
        />,
      );
    });

    const boton = pressableAncestor(renderer.root.findByProps({ children: 'Cargar más' }));
    act(() => {
      boton.props.onPress();
    });

    expect(onCargarMas).toHaveBeenCalledTimes(1);
  });

  it('deshabilita el botón mientras cargandoMas=true', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <NotificacionesModal
          visible
          items={[item]}
          noLeidas={1}
          onMarkLeida={jest.fn()}
          onClose={jest.fn()}
          hayMas
          cargandoMas
          onCargarMas={jest.fn()}
        />,
      );
    });

    // Con cargandoMas=true se muestra un ActivityIndicator en vez del texto.
    expect(() => renderer.root.findByProps({ children: 'Cargar más' })).toThrow();
    const boton = renderer.root.findByProps({ accessibilityLabel: 'Cargar más notificaciones' });
    expect(boton.props.disabled).toBe(true);
  });
});
