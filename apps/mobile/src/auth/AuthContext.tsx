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

interface SessionUser {
  id: string;
  email: string;
  nombres: string;
  apellidos: string;
  debeCambiarPwd: boolean;
  roles: RoleName[];
}

interface AuthContextValue {
  user: SessionUser | null;
  restoring: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
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
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    }
    await tokenStore.clear();
    setUser(null);
  }, []);

  const markPasswordChanged = useCallback(() => {
    setUser((u) => (u ? { ...u, debeCambiarPwd: false } : u));
  }, []);

  const value = useMemo(
    () => ({ user, restoring, login, logout, markPasswordChanged }),
    [user, restoring, login, logout, markPasswordChanged],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth dentro de <AuthProvider>');
  return ctx;
}
