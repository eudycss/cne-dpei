import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { AccessibilityInfo, Linking, Pressable, View } from 'react-native';

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

import { AvisoRastreo } from './AvisoRastreo';

function render(props: Partial<Parameters<typeof AvisoRastreo>[0]> = {}) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <AvisoRastreo activando={false} permisoDenegado={false} onActivar={jest.fn()} {...props} />,
    );
  });
  return tree;
}

describe('AvisoRastreo', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  });

  it('se anuncia a TalkBack al aparecer y el contenedor es una alerta', () => {
    const tree = render();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Rastreo de ubicación detenido');
    const alerta = tree.root.findAll((n) => n.type === View && n.props.accessibilityRole === 'alert');
    expect(alerta).toHaveLength(1);
  });

  it('"Activar rastreo" llama a onActivar', () => {
    const onActivar = jest.fn();
    const tree = render({ onActivar });
    const boton = tree.root.findByType(Pressable);
    expect(boton.props.accessibilityLabel).toBe('Activar rastreo');
    act(() => boton.props.onPress());
    expect(onActivar).toHaveBeenCalledTimes(1);
  });

  it('mientras activa, el botón queda deshabilitado, ocupado y conserva su nombre', () => {
    const tree = render({ activando: true });
    const boton = tree.root.findByType(Pressable);
    expect(boton.props.disabled).toBe(true);
    expect(boton.props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(boton.props.accessibilityLabel).toBe('Activar rastreo');
  });

  it('con el permiso denegado ofrece abrir los ajustes del teléfono', () => {
    const abrir = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    const tree = render({ permisoDenegado: true });
    const boton = tree.root.findByType(Pressable);
    expect(tree.root.findAllByProps({ children: 'Abrir ajustes' }).length).toBeGreaterThan(0);
    act(() => boton.props.onPress());
    expect(abrir).toHaveBeenCalledTimes(1);
  });
});
