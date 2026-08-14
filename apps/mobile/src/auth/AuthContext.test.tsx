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

import * as SecureStore from 'expo-secure-store';
import { AuthProvider, useAuth } from './AuthContext';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { __emitSessionExpired } = require('../lib/api');

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
