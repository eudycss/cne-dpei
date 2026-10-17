import { act, create } from 'react-test-renderer';
import { Alert, Text } from 'react-native';

const mockLogout = jest.fn();
jest.mock('./AuthContext', () => ({ useAuth: () => ({ logout: mockLogout }) }));
jest.mock('../lib/offline-queue', () => ({ contarPendientes: jest.fn(), leerRechazadas: jest.fn() }));
jest.mock('../lib/offline-foto-militar', () => ({ hayFotoMilitarPendiente: jest.fn() }));

import { useCerrarSesion } from './useCerrarSesion';
import { contarPendientes, leerRechazadas } from '../lib/offline-queue';
import { hayFotoMilitarPendiente } from '../lib/offline-foto-militar';

let cerrarSesion: () => Promise<void>;
function Harness() {
  cerrarSesion = useCerrarSesion();
  return <Text>harness</Text>;
}

describe('useCerrarSesion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    (contarPendientes as jest.Mock).mockResolvedValue(0);
    (leerRechazadas as jest.Mock).mockResolvedValue([]);
    (hayFotoMilitarPendiente as jest.Mock).mockResolvedValue(false);
    act(() => {
      create(<Harness />);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sin nada pendiente cierra sesión directo', async () => {
    await act(() => cerrarSesion());

    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('con registros pendientes avisa y no cierra hasta que el operador lo confirme', async () => {
    (contarPendientes as jest.Mock).mockResolvedValue(3);

    await act(() => cerrarSesion());

    expect(mockLogout).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('Tienes datos sin enviar', expect.stringContaining('3 registro(s)'), expect.any(Array));
    const botones = (Alert.alert as jest.Mock).mock.calls[0][2];
    expect(botones[0]).toMatchObject({ text: 'Esperar', style: 'cancel' });

    botones[1].onPress();
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('avisa también por la foto del militar sin subir y por avisos de rechazo sin revisar', async () => {
    (hayFotoMilitarPendiente as jest.Mock).mockResolvedValue(true);
    (leerRechazadas as jest.Mock).mockResolvedValue([{ id: 'a' }, { id: 'b' }]);

    await act(() => cerrarSesion());

    const mensaje = (Alert.alert as jest.Mock).mock.calls[0][1];
    expect(mensaje).toContain('la foto del militar');
    expect(mensaje).toContain('2 aviso(s)');
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('si no puede leer el almacenamiento, cierra sesión igual', async () => {
    (contarPendientes as jest.Mock).mockRejectedValue(new Error('storage'));
    (leerRechazadas as jest.Mock).mockRejectedValue(new Error('storage'));
    (hayFotoMilitarPendiente as jest.Mock).mockRejectedValue(new Error('storage'));

    await act(() => cerrarSesion());

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
