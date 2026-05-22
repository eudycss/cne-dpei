import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { LoginResponse, RoleName } from '@cne/shared-types';
import { api, tokenStore } from '../lib/api';

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
  loading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
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

  useEffect(() => {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  }, [user]);

  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data } = await api.post<LoginResponse>('/auth/login', { email, password });
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
    setUser(null);
  }, []);

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
