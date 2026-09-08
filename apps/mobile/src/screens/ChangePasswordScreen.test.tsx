import { act, create, ReactTestRenderer, TestInstance } from 'react-test-renderer';
import { Alert, Pressable, TextInput } from 'react-native';

jest.setTimeout(30000);

const mockMarkPasswordChanged = jest.fn();
const mockApiPost = jest.fn();
const mockGuardarVerificadorOffline = jest.fn();

const sessionUser = {
  id: 'u1',
  email: 'operador@cne-imbabura.gob.ec',
  nombres: 'Ana',
  apellidos: 'Perez',
  debeCambiarPwd: true,
  roles: ['OPERADOR_CDA'],
};

let mockUser: typeof sessionUser | null = sessionUser;

jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: mockUser, markPasswordChanged: mockMarkPasswordChanged }),
}));

jest.mock('../lib/api', () => ({
  api: { post: (...args: any[]) => mockApiPost(...args) },
}));

jest.mock('../lib/offlineAuth', () => ({
  guardarVerificadorOffline: (...args: any[]) => mockGuardarVerificadorOffline(...args),
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

import { ChangePasswordScreen } from './ChangePasswordScreen';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));
const NUEVA_PASSWORD = 'Nueva1!';

function pressableAncestor(instance: TestInstance): TestInstance {
  let node: TestInstance | null = instance;
  while (node && node.type !== Pressable) node = node.parent;
  if (!node) throw new Error('No se encontró un <Pressable> ancestro');
  return node;
}

async function llenarYEnviar(renderer: ReactTestRenderer, actual: string, nueva: string, confirmar: string) {
  const inputs = renderer.root.findAllByType(TextInput);
  await act(async () => {
    inputs[0].props.onChangeText(actual);
    inputs[1].props.onChangeText(nueva);
    inputs[2].props.onChangeText(confirmar);
  });
  const boton = pressableAncestor(renderer.root.findByProps({ children: 'Cambiar contraseña' }));
  await act(async () => {
    boton.props.onPress();
    await flushPromises();
  });
}

describe('ChangePasswordScreen — guarda el verificador offline tras cambiar la contraseña', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = sessionUser;
    mockApiPost.mockResolvedValue({});
    mockGuardarVerificadorOffline.mockResolvedValue(undefined);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('tras un cambio exitoso, guarda el verificador con la nueva contraseña y debeCambiarPwd:false', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ChangePasswordScreen />);
    });

    await llenarYEnviar(renderer, 'Actual1!', NUEVA_PASSWORD, NUEVA_PASSWORD);

    expect(mockMarkPasswordChanged).toHaveBeenCalled();
    expect(mockGuardarVerificadorOffline).toHaveBeenCalledWith(NUEVA_PASSWORD, {
      ...sessionUser,
      debeCambiarPwd: false,
    });
  });

  it('si el guardado local falla, el cambio de contraseña igual se considera exitoso (sin alerta de error)', async () => {
    mockGuardarVerificadorOffline.mockRejectedValue(new Error('SecureStore no disponible'));

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ChangePasswordScreen />);
    });

    await llenarYEnviar(renderer, 'Actual1!', NUEVA_PASSWORD, NUEVA_PASSWORD);

    expect(mockMarkPasswordChanged).toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalledWith('Error', expect.anything());
  });

  it('si no hay usuario en contexto, no intenta guardar el verificador', async () => {
    mockUser = null;

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<ChangePasswordScreen />);
    });

    await llenarYEnviar(renderer, 'Actual1!', NUEVA_PASSWORD, NUEVA_PASSWORD);

    expect(mockMarkPasswordChanged).toHaveBeenCalled();
    expect(mockGuardarVerificadorOffline).not.toHaveBeenCalled();
  });
});
