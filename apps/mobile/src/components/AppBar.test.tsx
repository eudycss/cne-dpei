import { act, create, ReactTestRenderer } from 'react-test-renderer';

jest.mock('../lib/notifications', () => ({
  getMisNotificaciones: jest.fn(),
  marcarNotificacionLeida: jest.fn(),
  describirNotificacion: jest.requireActual('../lib/notifications').describirNotificacion,
  formatearFechaHora: jest.requireActual('../lib/notifications').formatearFechaHora,
}));
jest.mock('./EstadoSincronizacion', () => ({ EstadoSincronizacion: () => null }));
jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { roles: ['ADMINISTRADOR'] } }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'light',
    toggle: jest.fn(),
    colors: new Proxy({}, { get: () => '#000' }),
  }),
}));
// Se aíslan los demás hijos de AppBar (no son objeto de este test) para que
// sus propias dependencias no compliquen este test.
jest.mock('./Logo', () => ({ Logo: () => null }));
jest.mock('./MiRecintoModal', () => ({ MiRecintoModal: () => null }));
jest.mock('./ReportarIncidenciaModal', () => ({ ReportarIncidenciaModal: () => null }));
jest.mock('./NotificacionesModal', () => ({ NotificacionesModal: () => null }));

import { View } from 'react-native';
import { AppBar, AppBarSinInsetSuperior } from './AppBar';
import { getMisNotificaciones } from '../lib/notifications';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

function enlaceCaidoItem(id = 'n1', codigoRecinto = '978') {
  return {
    id,
    tipoEvento: 'ENLACE_CAIDO',
    canal: 'PUSH',
    payload: { codigoRecinto, nombreRecinto: 'Escuela Central' },
    creadoEn: '2026-09-23T11:00:00.000Z',
    leidaEn: null,
  };
}

describe('AppBar — sin aviso de enlace caído', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('no muestra banner aunque haya notificaciones ENLACE_CAIDO sin leer (quedan en la campanita)', async () => {
    (getMisNotificaciones as jest.Mock).mockResolvedValue({
      items: [enlaceCaidoItem()],
      total: 1,
      noLeidas: 1,
    });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<AppBar />);
      await flushPromises();
    });

    expect(() => renderer.root.findByProps({ children: 'Ya notifiqué' })).toThrow();
    expect(() =>
      renderer.root.findByProps({ children: 'Enlace caído: 978 — Escuela Central' }),
    ).toThrow();
    expect(() => renderer.root.findByProps({ accessibilityLabel: 'Notificaciones' })).not.toThrow();

    await act(async () => {
      renderer.unmount();
    });
  }, 15000);
});

describe('AppBar — inset superior', () => {
  const paddingTopBarra = (r: ReactTestRenderer) => {
    const barra = r.root.findAllByType(View)[0];
    return Object.assign({}, ...[barra.props.style].flat(Infinity).filter(Boolean)).paddingTop;
  };

  beforeEach(() => {
    (getMisNotificaciones as jest.Mock).mockResolvedValue({ items: [], total: 0, noLeidas: 0 });
  });

  it('por defecto suma el inset superior del dispositivo (pantallas del operador)', async () => {
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(<AppBar />);
      await flushPromises();
    });
    expect(paddingTopBarra(r)).toBe(24 + 10);
    await act(async () => r.unmount());
  }, 15000);

  it('bajo AppBarSinInsetSuperior no lo vuelve a sumar (pestañas del supervisor)', async () => {
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <AppBarSinInsetSuperior.Provider value={true}>
          <AppBar />
        </AppBarSinInsetSuperior.Provider>,
      );
      await flushPromises();
    });
    expect(paddingTopBarra(r)).toBe(10);
    await act(async () => r.unmount());
  }, 15000);
});
