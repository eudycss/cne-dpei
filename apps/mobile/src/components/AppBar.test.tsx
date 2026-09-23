import { act, create } from 'react-test-renderer';
import { Alert } from 'react-native';

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
// sus propias dependencias no compliquen este test.
jest.mock('./Logo', () => ({ Logo: () => null }));
jest.mock('./MiRecintoModal', () => ({ MiRecintoModal: () => null }));
jest.mock('./ReportarIncidenciaModal', () => ({ ReportarIncidenciaModal: () => null }));
jest.mock('./NotificacionesModal', () => ({ NotificacionesModal: () => null }));

import { AppBar } from './AppBar';
import { getMisNotificaciones } from '../lib/notifications';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe('AppBar — aviso de enlace caído', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it('muestra Alert.alert la primera vez que llega una notificación ENLACE_CAIDO no leída', async () => {
    (getMisNotificaciones as jest.Mock).mockResolvedValue({
      items: [
        {
          id: 'n1',
          tipoEvento: 'ENLACE_CAIDO',
          canal: 'PUSH',
          payload: { codigoRecinto: '978', nombreRecinto: 'Escuela Central' },
          creadoEn: '2026-09-23T11:00:00.000Z',
          leidaEn: null,
        },
      ],
      total: 1,
      noLeidas: 1,
    });

    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(<AppBar />);
      await flushPromises();
    });

    expect(Alert.alert).toHaveBeenCalledWith('Enlace caído', expect.stringContaining('978'));

    await act(async () => {
      renderer.unmount();
    });
  });
});
