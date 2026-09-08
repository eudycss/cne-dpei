import { act, create, ReactTestRenderer, TestInstance } from 'react-test-renderer';
import { Alert, Pressable, TextInput } from 'react-native';

jest.setTimeout(30000);

const mockLogin = jest.fn();
const mockLoginOffline = jest.fn();

jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ login: mockLogin, loginOffline: mockLoginOffline }),
}));

jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({ colors: new Proxy({}, { get: () => '#000000' }) }),
}));

jest.mock('../lib/reload', () => ({ reiniciarApp: jest.fn() }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { LoginScreen } from './LoginScreen';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

function pressableAncestor(instance: TestInstance): TestInstance {
  let node: TestInstance | null = instance;
  while (node && node.type !== Pressable) node = node.parent;
  if (!node) throw new Error('No se encontró un <Pressable> ancestro');
  return node;
}

function networkError() {
  const err: any = new Error('Network Error');
  err.isAxiosError = true;
  err.response = undefined;
  return err;
}

describe('LoginScreen — reingreso sin conexión', () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
    jest.restoreAllMocks();
  });

  async function llenarYEnviar(renderer: ReactTestRenderer, email: string, password: string) {
    const inputs = renderer.root.findAllByType(TextInput);
    await act(async () => {
      inputs[0].props.onChangeText(email);
      inputs[1].props.onChangeText(password);
    });
    const boton = pressableAncestor(renderer.root.findByProps({ children: 'Iniciar sesión' }));
    await act(async () => {
      boton.props.onPress();
      await flushPromises();
    });
  }

  it('si login() falla por red y loginOffline() tiene éxito, entra en modo sin conexión', async () => {
    mockLogin.mockRejectedValue(networkError());
    mockLoginOffline.mockResolvedValue({ ok: true });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<LoginScreen />);
    });

    await llenarYEnviar(renderer, 'operador@cne-imbabura.gob.ec', 'Secreto123!');

    expect(mockLoginOffline).toHaveBeenCalledWith('operador@cne-imbabura.gob.ec', 'Secreto123!');
    expect(alertSpy).toHaveBeenCalledWith('Sesión sin conexión', expect.stringContaining('sin internet'));
  });

  it('si login() falla por red y no hay verificador guardado, explica que hace falta un ingreso online primero', async () => {
    mockLogin.mockRejectedValue(networkError());
    mockLoginOffline.mockResolvedValue({ ok: false, razon: 'sin-verificador' });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<LoginScreen />);
    });

    await llenarYEnviar(renderer, 'operador@cne-imbabura.gob.ec', 'Secreto123!');

    expect(alertSpy).toHaveBeenCalledWith('Sin conexión', expect.stringContaining('conectarte a internet al menos una vez'));
  });

  it('si login() falla por red y el acceso offline venció, lo indica', async () => {
    mockLogin.mockRejectedValue(networkError());
    mockLoginOffline.mockResolvedValue({ ok: false, razon: 'vencido' });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<LoginScreen />);
    });

    await llenarYEnviar(renderer, 'operador@cne-imbabura.gob.ec', 'Secreto123!');

    expect(alertSpy).toHaveBeenCalledWith('Sin conexión', expect.stringContaining('venció'));
  });

  it('si login() falla por credenciales inválidas (no es error de red), NO intenta loginOffline()', async () => {
    const err: any = new Error('Unauthorized');
    err.isAxiosError = true;
    err.response = { status: 401, data: { message: 'Credenciales inválidas' } };
    mockLogin.mockRejectedValue(err);

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<LoginScreen />);
    });

    await llenarYEnviar(renderer, 'operador@cne-imbabura.gob.ec', 'malaClave');

    expect(mockLoginOffline).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Error', 'Credenciales inválidas');
  });

  it('si login() tiene éxito, no intenta loginOffline()', async () => {
    mockLogin.mockResolvedValue({ id: 'u1' });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<LoginScreen />);
    });

    await llenarYEnviar(renderer, 'operador@cne-imbabura.gob.ec', 'Secreto123!');

    expect(mockLoginOffline).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
