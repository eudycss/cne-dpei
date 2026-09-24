import { act, create, ReactTestRenderer, TestInstance } from 'react-test-renderer';
import { Pressable } from 'react-native';
import type { NotificacionItem } from '@cne/shared-types';

import { EnlaceCaidoBanner } from './EnlaceCaidoBanner';

function pressableAncestor(instance: TestInstance): TestInstance {
  let node: TestInstance | null = instance;
  while (node && node.type !== Pressable) node = node.parent;
  if (!node) throw new Error('No se encontró un <Pressable> ancestro');
  return node;
}

function item(id: string, codigoRecinto: string): NotificacionItem {
  return {
    id,
    tipoEvento: 'ENLACE_CAIDO',
    canal: 'PUSH',
    payload: { codigoRecinto, nombreRecinto: 'Escuela Central' },
    creadoEn: '2026-09-23T11:00:00.000Z',
    leidaEn: null,
  };
}

describe('EnlaceCaidoBanner', () => {
  it('muestra el detalle del enlace caído y el botón "Ya notifiqué"', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<EnlaceCaidoBanner items={[item('n1', '978')]} onConfirmar={jest.fn()} />);
    });

    expect(() =>
      renderer.root.findByProps({ children: 'Enlace caído: 978 — Escuela Central' }),
    ).not.toThrow();
    expect(() => renderer.root.findByProps({ children: 'Ya notifiqué' })).not.toThrow();
  });

  it('agrupa varios enlaces caídos bajo un solo título', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <EnlaceCaidoBanner items={[item('n1', '978'), item('n2', '982')]} onConfirmar={jest.fn()} />,
      );
    });

    expect(() => renderer.root.findByProps({ children: '2 enlaces caídos' })).not.toThrow();
    expect(() =>
      renderer.root.findByProps({ children: 'Enlace caído: 978 — Escuela Central' }),
    ).not.toThrow();
    expect(() =>
      renderer.root.findByProps({ children: 'Enlace caído: 982 — Escuela Central' }),
    ).not.toThrow();
  });

  it('llama a onConfirmar al tocar "Ya notifiqué"', async () => {
    const onConfirmar = jest.fn().mockResolvedValue(undefined);
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<EnlaceCaidoBanner items={[item('n1', '978')]} onConfirmar={onConfirmar} />);
    });

    const boton = pressableAncestor(renderer.root.findByProps({ children: 'Ya notifiqué' }));
    await act(async () => {
      await boton.props.onPress();
    });

    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });

  it('no usa <Modal>: es una vista normal que no bloquea el resto de la pantalla', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<EnlaceCaidoBanner items={[item('n1', '978')]} onConfirmar={jest.fn()} />);
    });

    expect(() => renderer.root.findByType(require('react-native').Modal)).toThrow();
    expect(renderer.root.findByProps({ accessibilityRole: 'alert' })).toBeTruthy();
  });
});
