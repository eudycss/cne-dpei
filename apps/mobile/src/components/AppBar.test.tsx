import { act, create, ReactTestRenderer, TestInstance } from 'react-test-renderer';
import { Pressable } from 'react-native';

jest.mock('../lib/notifications', () => ({
  getMisNotificaciones: jest.fn(),
  marcarNotificacionLeida: jest.fn(),
  describirNotificacion: jest.requireActual('../lib/notifications').describirNotificacion,
  formatearFechaHora: jest.requireActual('../lib/notifications').formatearFechaHora,
}));
jest.mock('../lib/offline-queue', () => ({ usePendingCount: () => 0 }));
jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { roles: ['ADMINISTRADOR'] } }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'light',
    toggle: jest.fn(),
    colors: new Proxy({}, { get: () => '#000' }),
  }),
}));
// Se aíslan los demás hijos de AppBar (no son objeto de este test) para que
// sus propias dependencias no compliquen este test. EnlaceCaidoBanner
// NO se mockea: es lo que este test verifica.
jest.mock('./Logo', () => ({ Logo: () => null }));
jest.mock('./MiRecintoModal', () => ({ MiRecintoModal: () => null }));
jest.mock('./ReportarIncidenciaModal', () => ({ ReportarIncidenciaModal: () => null }));
jest.mock('./NotificacionesModal', () => ({ NotificacionesModal: () => null }));

import { AppBar } from './AppBar';
import { getMisNotificaciones, marcarNotificacionLeida } from '../lib/notifications';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

function pressableAncestor(instance: TestInstance): TestInstance {
  let node: TestInstance | null = instance;
  while (node && node.type !== Pressable) node = node.parent;
  if (!node) throw new Error('No se encontró un <Pressable> ancestro');
  return node;
}

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

describe('AppBar — aviso persistente de enlace caído', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('muestra el banner persistente cuando llega una notificación ENLACE_CAIDO no leída', async () => {
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

    expect(() =>
      renderer.root.findByProps({ children: 'Enlace caído: 978 — Escuela Central' }),
    ).not.toThrow();
    expect(() => renderer.root.findByProps({ children: 'Ya notifiqué' })).not.toThrow();

    await act(async () => {
      renderer.unmount();
    });
  }, 15000);

  it('"Ya notifiqué" marca la notificación como leída', async () => {
    (getMisNotificaciones as jest.Mock).mockResolvedValue({
      items: [enlaceCaidoItem()],
      total: 1,
      noLeidas: 1,
    });
    (marcarNotificacionLeida as jest.Mock).mockResolvedValue(undefined);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<AppBar />);
      await flushPromises();
    });

    const boton = pressableAncestor(renderer.root.findByProps({ children: 'Ya notifiqué' }));
    await act(async () => {
      boton.props.onPress();
      await flushPromises();
    });

    expect(marcarNotificacionLeida).toHaveBeenCalledWith('n1');
    expect(() => renderer.root.findByProps({ children: 'Ya notifiqué' })).toThrow();

    await act(async () => {
      renderer.unmount();
    });
  }, 15000);

  it('no muestra el banner si no hay notificaciones de enlace caído sin leer', async () => {
    (getMisNotificaciones as jest.Mock).mockResolvedValue({ items: [], total: 0, noLeidas: 0 });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<AppBar />);
      await flushPromises();
    });

    expect(() => renderer.root.findByProps({ children: 'Ya notifiqué' })).toThrow();

    await act(async () => {
      renderer.unmount();
    });
  }, 15000);

  it('aparece aunque el enlace caído quede fuera de la primera página de la lista general', async () => {
    // La lista paginada (pageSize 10, sin soloNoLeidas) trae puras
    // notificaciones más nuevas — el enlace caído solo aparece en la
    // consulta aparte con soloNoLeidas. Si el modal derivara de esa lista
    // paginada, nunca aparecería (bug real que motivó la consulta separada).
    (getMisNotificaciones as jest.Mock).mockImplementation((opts?: { soloNoLeidas?: boolean }) => {
      if (opts?.soloNoLeidas) {
        return Promise.resolve({ items: [enlaceCaidoItem()], total: 1, noLeidas: 11 });
      }
      return Promise.resolve({
        items: Array.from({ length: 10 }, (_, i) => ({
          id: `n${i}`,
          tipoEvento: 'SALIDA_DPI',
          canal: 'PUSH',
          payload: {},
          creadoEn: '2026-09-23T12:00:00.000Z',
          leidaEn: null,
        })),
        total: 11,
        noLeidas: 11,
      });
    });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<AppBar />);
      await flushPromises();
    });

    expect(() =>
      renderer.root.findByProps({ children: 'Enlace caído: 978 — Escuela Central' }),
    ).not.toThrow();

    await act(async () => {
      renderer.unmount();
    });
  }, 15000);

  it('si falla la confirmación de una de varias caídas, cierra la que sí se confirmó y deja la fallida en el banner', async () => {
    (getMisNotificaciones as jest.Mock).mockImplementation((opts?: { soloNoLeidas?: boolean }) =>
      Promise.resolve(
        opts?.soloNoLeidas
          ? { items: [enlaceCaidoItem('n1', '978'), enlaceCaidoItem('n2', '982')], total: 2, noLeidas: 2 }
          : { items: [], total: 0, noLeidas: 0 },
      ),
    );
    (marcarNotificacionLeida as jest.Mock).mockImplementation((id: string) =>
      id === 'n2' ? Promise.reject(new Error('network error')) : Promise.resolve(undefined),
    );

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<AppBar />);
      await flushPromises();
    });

    const boton = pressableAncestor(renderer.root.findByProps({ children: 'Ya notifiqué' }));
    await act(async () => {
      boton.props.onPress();
      await flushPromises();
    });

    expect(() =>
      renderer.root.findByProps({ children: 'Enlace caído: 978 — Escuela Central' }),
    ).toThrow();
    // La fallida se queda visible — no desaparece sin haberse confirmado de verdad.
    expect(() =>
      renderer.root.findByProps({ children: 'Enlace caído: 982 — Escuela Central' }),
    ).not.toThrow();
    expect(() => renderer.root.findByProps({ children: 'Ya notifiqué' })).not.toThrow();

    await act(async () => {
      renderer.unmount();
    });
  }, 15000);
});
