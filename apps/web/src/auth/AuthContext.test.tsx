import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';

import { AuthProvider, useAuth } from './AuthContext';
import { api, tokenStore } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: { post: vi.fn() },
  tokenStore: { set: vi.fn(), clear: vi.fn() },
}));

const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

const sessionUser = {
  id: 'u1',
  email: 'admin@cne-imbabura.gob.ec',
  nombres: 'Admin',
  apellidos: 'CNE',
  debeCambiarPwd: false,
  roles: ['ADMINISTRADOR'],
};

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('useAuth lanza si se usa fuera de <AuthProvider>', () => {
    // React loguea el error a console.error aunque el throw sea el comportamiento esperado.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useAuth())).toThrow(/AuthProvider/);
    spy.mockRestore();
  });

  it('inicializa sin usuario cuando no hay sesión persistida', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.user).toBeNull();
  });

  it('rehidrata el usuario desde localStorage al montar', () => {
    localStorage.setItem('cne.user', JSON.stringify(sessionUser));
    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current.user).toEqual(sessionUser);
  });

  it('login guarda tokens, setea el usuario y lo persiste', async () => {
    postMock.mockResolvedValueOnce({
      data: { accessToken: 'acc', refreshToken: 'ref', user: sessionUser },
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.login('admin@cne-imbabura.gob.ec', 'secreto');
    });

    expect(tokenStore.set).toHaveBeenCalledWith('acc', 'ref');
    expect(result.current.user).toEqual(sessionUser);
    expect(JSON.parse(localStorage.getItem('cne.user')!)).toEqual(sessionUser);
  });

  it('logout limpia tokens, usuario y localStorage', async () => {
    localStorage.setItem('cne.user', JSON.stringify(sessionUser));
    postMock.mockResolvedValueOnce({ data: {} }); // POST /auth/logout

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.logout();
    });

    expect(tokenStore.clear).toHaveBeenCalledTimes(1);
    expect(result.current.user).toBeNull();
    expect(localStorage.getItem('cne.user')).toBeNull();
  });

  it('logout limpia la sesión aunque el POST /auth/logout falle', async () => {
    localStorage.setItem('cne.user', JSON.stringify(sessionUser));
    postMock.mockRejectedValueOnce(new Error('network'));

    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.user).toBeNull();
    expect(tokenStore.clear).toHaveBeenCalledTimes(1);
  });

  it('markPasswordChanged pone debeCambiarPwd en false', async () => {
    localStorage.setItem('cne.user', JSON.stringify({ ...sessionUser, debeCambiarPwd: true }));
    const { result } = renderHook(() => useAuth(), { wrapper });

    act(() => {
      result.current.markPasswordChanged();
    });

    expect(result.current.user?.debeCambiarPwd).toBe(false);
  });
});
