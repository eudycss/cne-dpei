import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import * as SecureStore from 'expo-secure-store';
import type { LoginResponse, RoleName } from '@cne/shared-types';
import { api, onSessionExpired, tokenStore } from '../lib/api';
import {
  guardarVerificadorOffline,
  limpiarVerificadorOffline,
  verificarLoginOffline,
} from '../lib/offlineAuth';

interface SessionUser {
  id: string;
  email: string;
  nombres: string;
  apellidos: string;
  debeCambiarPwd: boolean;
  roles: RoleName[];
}

export type ResultadoLoginOffline =
  | { ok: true }
  | { ok: false; razon: 'sin-verificador' | 'vencido' | 'invalido' };

interface AuthContextValue {
  user: SessionUser | null;
  restoring: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  loginOffline: (email: string, password: string) => Promise<ResultadoLoginOffline>;
  logout: () => Promise<void>;
  markPasswordChanged: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const USER_KEY = 'cne.user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(USER_KEY);
        if (raw) setUser(JSON.parse(raw) as SessionUser);
      } finally {
        setRestoring(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (user) SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
    else SecureStore.deleteItemAsync(USER_KEY);
  }, [user]);

  // api.ts notifica aquí cuando /auth/refresh rechaza el refresh token con
  // 401/403 real (sesión inválida) y ya limpió SecureStore. Sin esto, la UI
  // se quedaba con una sesión "zombie": tokens borrados pero `user` seteado.
  useEffect(() => {
    const unsubscribe = onSessionExpired(() => {
      setUser(null);
    });
    return unsubscribe;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<LoginResponse>('/auth/login', { email, password });
    await tokenStore.set(data.accessToken, data.refreshToken);
    setUser(data.user);
    // Solo se guarda si no hay cambio de contraseña pendiente: si no, el
    // gate de "cambiar contraseña obligatoria" quedaría sin efecto offline
    // (ver ChangePasswordScreen, que guarda su propio verificador al cambiarla).
    if (!data.user.debeCambiarPwd) {
      // Se espera (no fire-and-forget) para que quede escrito antes de que
      // login() resuelva: si no, un logout() disparado justo después podía
      // ganarle la carrera a este guardado y dejar un verificador huérfano
      // pese al logout explícito.
      try {
        await guardarVerificadorOffline(password, data.user);
      } catch {
        /* si falla el guardado local, el login online ya tuvo éxito igual */
      }
    }
    return data.user;
  }, []);

  const loginOffline = useCallback(async (email: string, password: string) => {
    const resultado = await verificarLoginOffline(email, password);
    if (!resultado.ok) return resultado;
    setUser(resultado.usuario);
    return { ok: true } as const;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    }
    await tokenStore.clear();
    // "Cerrar sesión" es una acción deliberada del operador: a diferencia de
    // una sesión invalidada por el servidor (que solo hace setUser(null) vía
    // onSessionExpired, sin pasar por acá, y sí deja el verificador intacto
    // para poder reingresar offline), un logout explícito debe cerrar
    // también la puerta de reingreso sin conexión.
    await limpiarVerificadorOffline();
    setUser(null);
  }, []);

  const markPasswordChanged = useCallback(() => {
    setUser((u) => (u ? { ...u, debeCambiarPwd: false } : u));
  }, []);

  const value = useMemo(
    () => ({ user, restoring, login, loginOffline, logout, markPasswordChanged }),
    [user, restoring, login, loginOffline, logout, markPasswordChanged],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth dentro de <AuthProvider>');
  return ctx;
}
