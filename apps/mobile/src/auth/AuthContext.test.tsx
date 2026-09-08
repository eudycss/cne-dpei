import { act, create } from 'react-test-renderer';

jest.mock('../lib/api', () => {
  const listeners = new Set<() => void>();
  return {
    __esModule: true,
    api: { post: jest.fn() },
    tokenStore: { set: jest.fn(), clear: jest.fn() },
    onSessionExpired: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    // Solo para tests: dispara el evento que api.ts emitiría en un 401/403
    // real de /auth/refresh.
    __emitSessionExpired: () => listeners.forEach((cb) => cb()),
  };
});

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock('../lib/offlineAuth', () => ({
  guardarVerificadorOffline: jest.fn(),
  limpiarVerificadorOffline: jest.fn(),
  verificarLoginOffline: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { AuthProvider, useAuth } from './AuthContext';
import { guardarVerificadorOffline, limpiarVerificadorOffline, verificarLoginOffline } from '../lib/offlineAuth';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __emitSessionExpired, api, tokenStore } = require('../lib/api');

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

const sessionUser = {
  id: 'u1',
  email: 'operador@cne-imbabura.gob.ec',
  nombres: 'Operador',
  apellidos: 'CNE',
  debeCambiarPwd: false,
  roles: ['OPERADOR_CDA'],
};

function TestHarness({ onRender }: { onRender: (ctx: ReturnType<typeof useAuth>) => void }) {
  const ctx = useAuth();
  onRender(ctx);
  return null;
}

// Cada test que monta un AuthProvider debe desmontarlo, o su listener de
// onSessionExpired queda vivo en el Set del mock (module-scoped) y contamina
// los tests siguientes. Se registran aquí para forzar el desmontaje en
// afterEach aunque el propio test ya lo haya hecho (unmount() es idempotente).
const mountedRenderers: ReturnType<typeof create>[] = [];

async function renderAuth() {
  let latest: ReturnType<typeof useAuth>;
  let renderer!: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      <AuthProvider>
        <TestHarness
          onRender={(ctx) => {
            latest = ctx;
          }}
        />
      </AuthProvider>,
    );
    await flushPromises();
  });
  mountedRenderers.push(renderer);
  return {
    get current() {
      return latest;
    },
    unmount: () => {
      act(() => {
        renderer.unmount();
      });
      const idx = mountedRenderers.indexOf(renderer);
      if (idx !== -1) mountedRenderers.splice(idx, 1);
    },
  };
}

describe('AuthContext — reacción a sesión expirada', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    while (mountedRenderers.length) {
      const renderer = mountedRenderers.pop()!;
      act(() => {
        renderer.unmount();
      });
    }
  });

  it('NO limpia el verificador offline cuando la sesión se invalida por el servidor (a diferencia de logout())', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) =>
      key === 'cne.user' ? Promise.resolve(JSON.stringify(sessionUser)) : Promise.resolve(null),
    );

    const harness = await renderAuth();
    expect(harness.current.user).toEqual(sessionUser);

    await act(async () => {
      __emitSessionExpired();
      await flushPromises();
    });

    expect(harness.current.user).toBeNull();
    expect(limpiarVerificadorOffline).not.toHaveBeenCalled();
  });

  it('setea user en null cuando api.ts emite onSessionExpired (401/403 real del refresh)', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) =>
      key === 'cne.user' ? Promise.resolve(JSON.stringify(sessionUser)) : Promise.resolve(null),
    );

    const harness = await renderAuth();
    expect(harness.current.user).toEqual(sessionUser);

    await act(async () => {
      __emitSessionExpired();
      await flushPromises();
    });

    expect(harness.current.user).toBeNull();
  });

  it('se desuscribe del evento al desmontar (no queda un listener colgado)', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) =>
      key === 'cne.user' ? Promise.resolve(JSON.stringify(sessionUser)) : Promise.resolve(null),
    );
    // Si el listener siguiera vivo tras desmontar, setUser() en un componente
    // desmontado dispararía el warning de React "not wrapped in act(...)"
    // vía console.error — lo usamos como señal de que el cleanup no corrió.
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const harness = await renderAuth();
    expect(harness.current.user).toEqual(sessionUser);

    harness.unmount();
    __emitSessionExpired();

    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('AuthContext — login offline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (guardarVerificadorOffline as jest.Mock).mockResolvedValue(undefined);
    (limpiarVerificadorOffline as jest.Mock).mockResolvedValue(undefined);
  });

  afterEach(() => {
    while (mountedRenderers.length) {
      const renderer = mountedRenderers.pop()!;
      act(() => {
        renderer.unmount();
      });
    }
  });

  it('login() online exitoso guarda el verificador offline cuando no hay cambio de contraseña pendiente', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: { accessToken: 'a', refreshToken: 'r', user: sessionUser },
    });

    const harness = await renderAuth();
    await act(async () => {
      await harness.current.login('operador@cne-imbabura.gob.ec', 'Secreto123!');
    });

    expect(guardarVerificadorOffline).toHaveBeenCalledWith('Secreto123!', sessionUser);
  });

  it('login() online exitoso NO guarda el verificador si el usuario debe cambiar la contraseña', async () => {
    const usuarioDebeCambiar = { ...sessionUser, debeCambiarPwd: true };
    (api.post as jest.Mock).mockResolvedValue({
      data: { accessToken: 'a', refreshToken: 'r', user: usuarioDebeCambiar },
    });

    const harness = await renderAuth();
    await act(async () => {
      await harness.current.login('operador@cne-imbabura.gob.ec', 'Secreto123!');
    });

    expect(guardarVerificadorOffline).not.toHaveBeenCalled();
  });

  it('loginOffline() exitoso setea user sin llamar al backend', async () => {
    (verificarLoginOffline as jest.Mock).mockResolvedValue({ ok: true, usuario: sessionUser });

    const harness = await renderAuth();
    let resultado: any;
    await act(async () => {
      resultado = await harness.current.loginOffline('operador@cne-imbabura.gob.ec', 'Secreto123!');
    });

    expect(resultado).toEqual({ ok: true });
    expect(harness.current.user).toEqual(sessionUser);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('loginOffline() fallido no cambia user y propaga la razón', async () => {
    (verificarLoginOffline as jest.Mock).mockResolvedValue({ ok: false, razon: 'vencido' });

    const harness = await renderAuth();
    let resultado: any;
    await act(async () => {
      resultado = await harness.current.loginOffline('operador@cne-imbabura.gob.ec', 'Secreto123!');
    });

    expect(resultado).toEqual({ ok: false, razon: 'vencido' });
    expect(harness.current.user).toBeNull();
  });

  it('logout() limpia el verificador offline además de los tokens', async () => {
    (api.post as jest.Mock).mockResolvedValue({});

    const harness = await renderAuth();
    await act(async () => {
      await harness.current.logout();
    });

    expect(limpiarVerificadorOffline).toHaveBeenCalled();
    expect(tokenStore.clear).toHaveBeenCalled();
  });
});
