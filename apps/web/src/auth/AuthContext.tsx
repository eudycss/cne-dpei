import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { LoginResponse, RoleName } from '@cne/shared-types';
import { QueryClientContext } from '@tanstack/react-query';
import { api, tokenStore } from '../lib/api';

interface SessionUser {
  id: string;
  /** null en cuentas CDA (entran con cédula). */
  email: string | null;
  nombres: string;
  apellidos: string;
  debeCambiarPwd: boolean;
  roles: RoleName[];
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login: (usuario: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
  markPasswordChanged: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const USER_KEY = 'cne.user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(() => {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  });
  const [loading, setLoading] = useState(false);
  // Opcional: en producción siempre hay QueryClientProvider por encima (main.tsx).
  const queryClient = useContext(QueryClientContext);

  useEffect(() => {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  }, [user]);

  const login = useCallback(async (usuario: string, password: string) => {
    setLoading(true);
    try {
      const { data } = await api.post<LoginResponse>('/auth/login', { usuario, password });
      tokenStore.set(data.accessToken, data.refreshToken);
      const u: SessionUser = data.user;
      setUser(u);
      return u;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    }
    tokenStore.clear();
    // Sin recargar la página, la caché seguiría con datos de la sesión (fotos
    // del personal, cédulas, teléfonos) y quien entre después en este equipo
    // podría verlos. cancel antes de clear: una consulta en vuelo no la vuelve a llenar.
    if (queryClient) {
      await queryClient.cancelQueries();
      queryClient.clear();
    }
    setUser(null);
  }, [queryClient]);

  const markPasswordChanged = useCallback(() => {
    setUser((u) => (u ? { ...u, debeCambiarPwd: false } : u));
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, markPasswordChanged }),
    [user, loading, login, logout, markPasswordChanged],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth dentro de <AuthProvider>');
  return ctx;
}
