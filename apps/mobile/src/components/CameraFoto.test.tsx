import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { Image, Pressable, Text } from 'react-native';

const mockPermiso = { current: { granted: true, canAskAgain: true } as unknown };

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('expo-camera', () => {
  const { forwardRef, useImperativeHandle } = jest.requireActual('react');
  const CameraView = forwardRef((props: { onCameraReady?: () => void }, ref: unknown) => {
    useImperativeHandle(ref, () => ({
      takePictureAsync: () => Promise.resolve({ uri: 'file:///foto.jpg', base64: 'AAA' }),
    }));
    (globalThis as { __camaraLista?: () => void }).__camaraLista = props.onCameraReady;
    return null;
  });
  return { CameraView, useCameraPermissions: () => [mockPermiso.current, jest.fn()] };
});

import { CameraFoto } from './CameraFoto';

const flush = () => new Promise((r) => setImmediate(r));

function render(titulo = 'Acta de instalación') {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<CameraFoto titulo={titulo} onCapture={jest.fn()} onCancel={jest.fn()} />);
  });
  return tree;
}

function botones(tree: ReactTestRenderer) {
  return tree.root.findAll((n) => n.type === Pressable);
}

describe('CameraFoto — accesibilidad', () => {
  beforeEach(() => {
    mockPermiso.current = { granted: true, canAskAgain: true };
  });

  it('todos los botones se anuncian como botón', () => {
    const tree = render();
    const pressables = botones(tree);
    expect(pressables.length).toBeGreaterThan(0);
    pressables.forEach((p) => expect(p.props.accessibilityRole).toBe('button'));
  });

  it('el disparador tiene nombre y queda deshabilitado mientras la cámara inicia', () => {
    const tree = render();
    const disparador = botones(tree).find((p) => p.props.accessibilityLabel === 'Tomar foto')!;
    expect(disparador.props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(disparador.props.accessibilityHint).toBe('La cámara se está iniciando');

    act(() => (globalThis as { __camaraLista?: () => void }).__camaraLista!());

    const listo = botones(tree).find((p) => p.props.accessibilityLabel === 'Tomar foto')!;
    expect(listo.props.accessibilityState).toEqual({ disabled: false, busy: false });
    expect(listo.props.accessibilityHint).toBeUndefined();
  });

  it('el título se anuncia como encabezado', () => {
    const tree = render('Foto de la incidencia');
    const titulo = tree.root.findAll(
      (n) => n.type === Text && n.props.accessibilityRole === 'header',
    );
    expect(titulo[0].props.children).toBe('Foto de la incidencia');
  });

  it('en la revisión, la foto y los botones tienen nombre', async () => {
    const tree = render('Acta de escrutinio');
    act(() => (globalThis as { __camaraLista?: () => void }).__camaraLista!());
    const disparador = botones(tree).find((p) => p.props.accessibilityLabel === 'Tomar foto')!;
    await act(async () => {
      disparador.props.onPress();
      await flush();
    });

    expect(tree.root.findByType(Image).props.accessibilityLabel).toBe('Vista previa: Acta de escrutinio');
    expect(botones(tree).some((p) => p.props.accessibilityLabel === 'Repetir foto')).toBe(true);
    botones(tree).forEach((p) => expect(p.props.accessibilityRole).toBe('button'));
  });

  it('sin permiso, los botones de permiso también se anuncian como botón', () => {
    mockPermiso.current = { granted: false, canAskAgain: false };
    const tree = render();
    const pressables = botones(tree);
    expect(pressables).toHaveLength(2);
    pressables.forEach((p) => expect(p.props.accessibilityRole).toBe('button'));
    expect(pressables[0].props.accessibilityHint).toMatch(/ajustes/);
  });
});
