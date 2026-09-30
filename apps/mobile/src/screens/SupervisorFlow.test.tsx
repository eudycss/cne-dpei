import { act, create, ReactTestRenderer, TestInstance } from 'react-test-renderer';
import { Pressable, Text } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

// Mismo enfoque que LlegadaDpiScreen.test.tsx: react-test-renderer directo.
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

// Solo interesa el contexto del AppBar, no sus dependencias (notificaciones, auth…).
jest.mock('../components/AppBar', () => ({
  AppBarSinInsetSuperior: require('react').createContext(false),
}));

// Cada pantalla hija expone si su AppBar debe omitir el inset superior y el
// inset real que siguen viendo los demás consumidores (p. ej. CameraQr en un Modal).
function mockPantalla(nombre: string) {
  return function Pantalla() {
    const { useContext } = require('react');
    const { Text: T } = require('react-native');
    const { useSafeAreaInsets: useInsets } = require('react-native-safe-area-context');
    const { AppBarSinInsetSuperior } = require('../components/AppBar');
    const appBar = useContext(AppBarSinInsetSuperior) ? 'sin-inset' : 'con-inset';
    return <T testID="pantalla">{`${nombre}:${appBar}:${useInsets().top}`}</T>;
  };
}
jest.mock('./MonitoreoScreen', () => ({ MonitoreoScreen: mockPantalla('monitoreo') }));
jest.mock('./VerificacionDpiScreen', () => ({ VerificacionDpiScreen: mockPantalla('verificar') }));
jest.mock('./KitsVerificadosScreen', () => ({ KitsVerificadosScreen: mockPantalla('verificados') }));
jest.mock('./AlertasScreen', () => ({ AlertasScreen: mockPantalla('alertas') }));
jest.mock('./RecintosDificilAccesoScreen', () => ({ RecintosDificilAccesoScreen: mockPantalla('dificil') }));

import { SupervisorFlow } from './SupervisorFlow';

const INSETS = { top: 40, bottom: 0, left: 0, right: 0 };

function renderizar(): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <SafeAreaInsetsContext.Provider value={INSETS}>
        <SupervisorFlow />
      </SafeAreaInsetsContext.Provider>,
    );
  });
  return r;
}

const tabs = (r: ReactTestRenderer): TestInstance[] =>
  r.root.findAll((n) => n.type === Pressable && n.props.accessibilityRole === 'tab');
const tab = (r: ReactTestRenderer, label: string) => tabs(r).find((t) => t.props.accessibilityLabel === label)!;
const pantalla = (r: ReactTestRenderer) => r.root.findByProps({ testID: 'pantalla' }).props.children;

describe('SupervisorFlow — barra de pestañas', () => {
  it('expone las 5 pestañas con rol tab y solo la activa como seleccionada (WCAG 4.1.2)', () => {
    const r = renderizar();
    expect(tabs(r).map((t) => t.props.accessibilityLabel)).toEqual([
      'Monitoreo',
      'Verificar Kits DPI',
      'Verificados',
      'Alertas',
      'Recintos difíciles',
    ]);
    expect(tabs(r).filter((t) => t.props.accessibilityState.selected).map((t) => t.props.accessibilityLabel)).toEqual([
      'Monitoreo',
    ]);
    expect(r.root.findAll((n) => n.props.accessibilityRole === 'tablist' && typeof n.type === 'string')).toHaveLength(1);
  });

  it('al tocar una pestaña cambia la pantalla y el estado seleccionado', () => {
    const r = renderizar();
    act(() => tab(r, 'Alertas').props.onPress());
    expect(pantalla(r)).toMatch(/^alertas:/);
    expect(tab(r, 'Alertas').props.accessibilityState).toEqual({ selected: true });
    expect(tab(r, 'Monitoreo').props.accessibilityState).toEqual({ selected: false });
  });

  it('las etiquetas de una palabra no se parten: una línea que se achica; las de varias usan dos', () => {
    const r = renderizar();
    const texto = (label: string) => tab(r, label).findByType(Text).props;
    expect(texto('Verificados')).toMatchObject({ numberOfLines: 1, adjustsFontSizeToFit: true });
    expect(texto('Recintos difíciles')).toMatchObject({ numberOfLines: 2, adjustsFontSizeToFit: false });
  });

  it('el AppBar de las pantallas omite el inset ya consumido, pero el inset real sigue disponible (CameraQr)', () => {
    const r = renderizar();
    expect(pantalla(r)).toBe('monitoreo:sin-inset:40');
    act(() => tab(r, 'Verificar Kits DPI').props.onPress());
    expect(pantalla(r)).toBe('verificar:sin-inset:40');
  });

  it('las pestañas cumplen el área táctil mínima de 44 pt', () => {
    const r = renderizar();
    for (const t of tabs(r)) {
      const estilo = Object.assign({}, ...[t.props.style].flat(Infinity).filter(Boolean));
      expect(estilo.minHeight).toBeGreaterThanOrEqual(44);
    }
  });

  it('la barra sí respeta el inset superior del dispositivo', () => {
    const r = renderizar();
    const barra = r.root.find((n) => n.props.accessibilityRole === 'tablist' && typeof n.type === 'string');
    const estilo = Object.assign({}, ...[barra.props.style].flat(Infinity));
    expect(estilo.paddingTop).toBe(INSETS.top + 6);
  });
});

