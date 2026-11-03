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

jest.mock('../lib/location', () => ({
  detenerRastreo: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../lib/offlineAuth', () => ({
  guardarVerificadorOffline: jest.fn(),
  limpiarVerificadorOffline: jest.fn(),
  verificarLoginOffline: jest.fn(),
}));

import * as SecureStore from 'expo-secure-store';
import { AuthProvider, AVISO_SESION_CERRADA, useAuth } from './AuthContext';
import { guardarVerificadorOffline, limpiarVerificadorOffline, verificarLoginOffline } from '../lib/offlineAuth';
import { detenerRastreo } from '../lib/location';
import type { MiAsignacionResponse } from '@cne/shared-types';
import {
  guardarAsignacion,
  guardarEtapa,
  leerAsignacion,
  leerEtapa,
  prepararCacheParaUsuario,
} from '../lib/cache-jornada';
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
    // Decisión de diseño: el rastreo del retorno sigue; sus posiciones se
    // encolan y se envían cuando el mismo operador vuelve a ingresar.
    expect(detenerRastreo).not.toHaveBeenCalled();
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

  it('al cerrarse la sesión deja un aviso para la pantalla de ingreso', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) =>
      key === 'cne.user' ? Promise.resolve(JSON.stringify(sessionUser)) : Promise.resolve(null),
    );
    const harness = await renderAuth();
    expect(harness.current.avisoSesion).toBeNull();

    await act(async () => {
      __emitSessionExpired();
      await flushPromises();
    });

    expect(harness.current.avisoSesion).toBe(AVISO_SESION_CERRADA);
  });

  it('sin nadie dentro, el evento no deja aviso', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    const harness = await renderAuth();

    await act(async () => {
      __emitSessionExpired();
      await flushPromises();
    });

    expect(harness.current.avisoSesion).toBeNull();
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

  it('login() rechazado por credenciales inválidas borra la contraseña guardada para el ingreso sin conexión', async () => {
    const err: any = new Error('Unauthorized');
    err.isAxiosError = true;
    err.response = { status: 401, data: { message: 'Credenciales inválidas' } };
    (api.post as jest.Mock).mockRejectedValue(err);
    (verificarLoginOffline as jest.Mock).mockResolvedValue({ ok: true, usuario: sessionUser });

    const harness = await renderAuth();
    await act(async () => {
      await expect(harness.current.login('1712345678', 'claveVieja')).rejects.toBe(err);
    });

    expect(limpiarVerificadorOffline).toHaveBeenCalled();
  });

  it('login() rechazado por un error de tipeo (no coincide con la guardada) NO la borra', async () => {
    const err: any = new Error('Unauthorized');
    err.isAxiosError = true;
    err.response = { status: 401, data: { message: 'Credenciales inválidas' } };
    (api.post as jest.Mock).mockRejectedValue(err);
    (verificarLoginOffline as jest.Mock).mockResolvedValue({ ok: false, razon: 'invalido' });

    const harness = await renderAuth();
    await act(async () => {
      await expect(harness.current.login('1712345678', 'clavMal')).rejects.toBe(err);
    });

    expect(limpiarVerificadorOffline).not.toHaveBeenCalled();
  });

  it('logout() no deja el aviso de sesión cerrada aunque un 401 llegue mientras limpia', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) =>
      key === 'cne.user' ? Promise.resolve(JSON.stringify(sessionUser)) : Promise.resolve(null),
    );
    // Simula una petición en vuelo que vuelve con 401 durante el logout.
    (limpiarVerificadorOffline as jest.Mock).mockImplementation(async () => {
      __emitSessionExpired();
    });
    (api.post as jest.Mock).mockResolvedValue({});
    const harness = await renderAuth();

    await act(async () => {
      await harness.current.logout();
    });

    expect(harness.current.user).toBeNull();
    expect(harness.current.avisoSesion).toBeNull();
  });

  it('loginOffline() exitoso quita el aviso de sesión cerrada', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) =>
      key === 'cne.user' ? Promise.resolve(JSON.stringify(sessionUser)) : Promise.resolve(null),
    );
    (verificarLoginOffline as jest.Mock).mockResolvedValue({ ok: true, usuario: sessionUser });
    const harness = await renderAuth();
    await act(async () => {
      __emitSessionExpired();
      await flushPromises();
    });
    expect(harness.current.avisoSesion).not.toBeNull();

    await act(async () => {
      await harness.current.loginOffline('operador@cne-imbabura.gob.ec', 'Secreto123!');
    });

    expect(harness.current.avisoSesion).toBeNull();
  });

  it('login() que falla por red NO borra la contraseña guardada (sirve para entrar sin conexión)', async () => {
    const err: any = new Error('Network Error');
    err.isAxiosError = true;
    (api.post as jest.Mock).mockRejectedValue(err);

    const harness = await renderAuth();
    await act(async () => {
      await expect(harness.current.login('1712345678', 'clave')).rejects.toBe(err);
    });

    expect(limpiarVerificadorOffline).not.toHaveBeenCalled();
  });

  it('login() online exitoso quita el aviso de sesión cerrada', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) =>
      key === 'cne.user' ? Promise.resolve(JSON.stringify(sessionUser)) : Promise.resolve(null),
    );
    (api.post as jest.Mock).mockResolvedValue({ data: { accessToken: 'a', refreshToken: 'r', user: sessionUser } });
    const harness = await renderAuth();
    await act(async () => {
      __emitSessionExpired();
      await flushPromises();
    });

    await act(async () => {
      await harness.current.login('operador@cne-imbabura.gob.ec', 'Secreto123!');
    });

    expect(harness.current.avisoSesion).toBeNull();
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

  it('logout() detiene el rastreo en segundo plano (no sigue encolando posiciones de quien salió)', async () => {
    (api.post as jest.Mock).mockResolvedValue({});

    const harness = await renderAuth();
    await act(async () => {
      await harness.current.logout();
    });

    expect(detenerRastreo).toHaveBeenCalled();
  });

  it('logout() detiene el rastreo ANTES de borrar los tokens (sin 401 de la tarea en el medio)', async () => {
    (api.post as jest.Mock).mockResolvedValue({});
    let rastreoDetenidoAlBorrarTokens = false;
    (tokenStore.clear as jest.Mock).mockImplementationOnce(async () => {
      rastreoDetenidoAlBorrarTokens = (detenerRastreo as jest.Mock).mock.calls.length > 0;
    });

    const harness = await renderAuth();
    await act(async () => {
      await harness.current.logout();
    });

    expect(rastreoDetenidoAlBorrarTokens).toBe(true);
  });

  it('logout() termina aunque detener el rastreo falle', async () => {
    (api.post as jest.Mock).mockResolvedValue({});
    (detenerRastreo as jest.Mock).mockRejectedValueOnce(new Error('task no registrada'));

    const harness = await renderAuth();
    await act(async () => {
      await harness.current.logout();
    });

    expect(harness.current.user).toBeNull();
  });

  describe('copia local de la jornada', () => {
    beforeEach(async () => {
      await prepararCacheParaUsuario(sessionUser.id);
      await guardarAsignacion({ eventoId: 'ev1' } as MiAsignacionResponse);
      await guardarEtapa('ev1', 'EN_RECINTO');
    });

    it('login() online del mismo operador la conserva (p. ej. tras expirar la sesión)', async () => {
      (api.post as jest.Mock).mockResolvedValue({
        data: { accessToken: 'a', refreshToken: 'r', user: sessionUser },
      });

      const harness = await renderAuth();
      await act(async () => {
        await harness.current.login('operador@cne-imbabura.gob.ec', 'Secreto123!');
      });

      await expect(leerEtapa()).resolves.toEqual({ eventoId: 'ev1', etapa: 'EN_RECINTO' });
    });

    it('login() del mismo operador NO detiene su rastreo (las posiciones pendientes son suyas)', async () => {
      (api.post as jest.Mock).mockResolvedValue({
        data: { accessToken: 'a', refreshToken: 'r', user: sessionUser },
      });

      const harness = await renderAuth();
      await act(async () => {
        await harness.current.login('operador@cne-imbabura.gob.ec', 'Secreto123!');
      });

      expect(detenerRastreo).not.toHaveBeenCalled();
    });

    it('login() de otro operador detiene el rastreo del anterior ANTES de guardar los tokens nuevos', async () => {
      let rastreoDetenidoAlGuardarTokens = false;
      (tokenStore.set as jest.Mock).mockImplementationOnce(async () => {
        rastreoDetenidoAlGuardarTokens = (detenerRastreo as jest.Mock).mock.calls.length > 0;
      });
      const otro = { ...sessionUser, id: `${sessionUser.id}-otro` };
      (api.post as jest.Mock).mockResolvedValue({
        data: { accessToken: 'a', refreshToken: 'r', user: otro },
      });

      const harness = await renderAuth();
      await act(async () => {
        await harness.current.login('otro@cne-imbabura.gob.ec', 'Secreto123!');
      });

      expect(rastreoDetenidoAlGuardarTokens).toBe(true);
    });

    it('si detener el rastreo del anterior falla, el login del nuevo operador sigue', async () => {
      (detenerRastreo as jest.Mock).mockRejectedValueOnce(new Error('task no registrada'));
      const otro = { ...sessionUser, id: `${sessionUser.id}-otro` };
      (api.post as jest.Mock).mockResolvedValue({
        data: { accessToken: 'a', refreshToken: 'r', user: otro },
      });

      const harness = await renderAuth();
      await act(async () => {
        await harness.current.login('otro@cne-imbabura.gob.ec', 'Secreto123!');
      });

      expect(harness.current.user).toEqual(otro);
    });

    it('loginOffline() de otro operador también detiene el rastreo del anterior', async () => {
      const otro = { ...sessionUser, id: `${sessionUser.id}-otro` };
      (verificarLoginOffline as jest.Mock).mockResolvedValue({ ok: true, usuario: otro });

      const harness = await renderAuth();
      await act(async () => {
        await harness.current.loginOffline('otro@cne-imbabura.gob.ec', 'Secreto123!');
      });

      expect(detenerRastreo).toHaveBeenCalled();
    });

    it('login() online de otro operador la descarta', async () => {
      const otro = { ...sessionUser, id: `${sessionUser.id}-otro` };
      (api.post as jest.Mock).mockResolvedValue({
        data: { accessToken: 'a', refreshToken: 'r', user: otro },
      });

      const harness = await renderAuth();
      await act(async () => {
        await harness.current.login('otro@cne-imbabura.gob.ec', 'Secreto123!');
      });

      await expect(leerAsignacion()).resolves.toBeNull();
      await expect(leerEtapa()).resolves.toBeNull();
    });

    it('login() de otro operador vacía la cola ANTES de guardar los tokens nuevos', async () => {
      const { enqueue, contarPendientes } = jest.requireActual('../lib/offline-queue');
      await enqueue({ endpoint: '/tracking/salida-dpi', method: 'post', payload: {} });
      let pendientesAlGuardarTokens = -1;
      (tokenStore.set as jest.Mock).mockImplementationOnce(async () => {
        pendientesAlGuardarTokens = await contarPendientes();
      });
      const otro = { ...sessionUser, id: `${sessionUser.id}-otro` };
      (api.post as jest.Mock).mockResolvedValue({
        data: { accessToken: 'a', refreshToken: 'r', user: otro },
      });

      const harness = await renderAuth();
      await act(async () => {
        await harness.current.login('otro@cne-imbabura.gob.ec', 'Secreto123!');
      });

      expect(pendientesAlGuardarTokens).toBe(0);
    });

    it('loginOffline() la conserva para seguir trabajando sin señal', async () => {
      (verificarLoginOffline as jest.Mock).mockResolvedValue({ ok: true, usuario: sessionUser });

      const harness = await renderAuth();
      await act(async () => {
        await harness.current.loginOffline('operador@cne-imbabura.gob.ec', 'Secreto123!');
      });

      await expect(leerEtapa()).resolves.toEqual({ eventoId: 'ev1', etapa: 'EN_RECINTO' });
    });

    it('logout() la descarta', async () => {
      (api.post as jest.Mock).mockResolvedValue({});

      const harness = await renderAuth();
      await act(async () => {
        await harness.current.logout();
      });

      await expect(leerAsignacion()).resolves.toBeNull();
    });
  });
});

