import { act, create } from 'react-test-renderer';
import { Alert, Text } from 'react-native';

const mockLogout = jest.fn();
jest.mock('./AuthContext', () => ({ useAuth: () => ({ logout: mockLogout }) }));
jest.mock('../lib/offline-queue', () => ({ contarPendientes: jest.fn() }));

import { useCerrarSesion } from './useCerrarSesion';
import { contarPendientes } from '../lib/offline-queue';

let cerrarSesion: () => Promise<void>;
function Harness() {
  cerrarSesion = useCerrarSesion();
  return <Text>harness</Text>;
}

describe('useCerrarSesion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    act(() => {
      create(<Harness />);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sin registros pendientes cierra sesión directo', async () => {
    (contarPendientes as jest.Mock).mockResolvedValue(0);

    await act(() => cerrarSesion());

    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('con registros pendientes avisa y no cierra hasta que el operador lo confirme', async () => {
    (contarPendientes as jest.Mock).mockResolvedValue(3);

    await act(() => cerrarSesion());

    expect(mockLogout).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('Registros sin enviar', expect.stringContaining('3 registro(s)'), expect.any(Array));
    const botones = (Alert.alert as jest.Mock).mock.calls[0][2];
    expect(botones[0]).toMatchObject({ text: 'Esperar', style: 'cancel' });

    botones[1].onPress();
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  it('si no puede leer la cola, cierra sesión igual', async () => {
    (contarPendientes as jest.Mock).mockRejectedValue(new Error('storage'));

    await act(() => cerrarSesion());

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });
});
