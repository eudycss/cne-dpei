import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { RoleName } from '@cne/shared-types';

import { AuthProvider } from './AuthContext';
import { ProtectedRoute } from './ProtectedRoute';

vi.mock('../lib/api', () => ({
  api: { post: vi.fn() },
  tokenStore: { set: vi.fn(), clear: vi.fn() },
}));

const USER_KEY = 'cne.user';

function setSessionUser(overrides: Partial<{ debeCambiarPwd: boolean; roles: RoleName[] }> = {}) {
  localStorage.setItem(
    USER_KEY,
    JSON.stringify({
      id: 'u1',
      email: 'admin@cne-imbabura.gob.ec',
      nombres: 'Admin',
      apellidos: 'CNE',
      debeCambiarPwd: false,
      roles: ['ADMINISTRADOR'],
      ...overrides,
    }),
  );
}

function renderProtected(
  path: string,
  props: { roles?: RoleName[]; allowChangePassword?: boolean } = {},
) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<div>pantalla login</div>} />
          <Route path="/change-password" element={<div>pantalla cambiar password</div>} />
          <Route
            path="/protegido"
            element={
              <ProtectedRoute {...props}>
                <div>contenido protegido</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('redirige a /login si no hay usuario en sesión', () => {
    renderProtected('/protegido');
    expect(screen.getByText('pantalla login')).toBeInTheDocument();
  });

  it('redirige a /change-password si el usuario debe cambiar la contraseña', () => {
    setSessionUser({ debeCambiarPwd: true });
    renderProtected('/protegido');
    expect(screen.getByText('pantalla cambiar password')).toBeInTheDocument();
  });

  it('permite acceso a /change-password aunque debeCambiarPwd sea true si allowChangePassword está activo', () => {
    setSessionUser({ debeCambiarPwd: true });
    renderProtected('/protegido', { allowChangePassword: true });
    expect(screen.getByText('contenido protegido')).toBeInTheDocument();
  });

  it('muestra "Acceso denegado" si el rol del usuario no está en la lista permitida', () => {
    setSessionUser({ roles: ['OPERADOR_CDA'] });
    renderProtected('/protegido', { roles: ['ADMINISTRADOR'] });
    expect(screen.getByText('Acceso denegado')).toBeInTheDocument();
    expect(screen.queryByText('contenido protegido')).not.toBeInTheDocument();
  });

  it('permite acceso si el rol del usuario está en la lista permitida', () => {
    setSessionUser({ roles: ['TECNICO_SUPERVISOR'] });
    renderProtected('/protegido', { roles: ['ADMINISTRADOR', 'TECNICO_SUPERVISOR'] });
    expect(screen.getByText('contenido protegido')).toBeInTheDocument();
  });

  it('permite acceso sin restricción de roles', () => {
    setSessionUser();
    renderProtected('/protegido');
    expect(screen.getByText('contenido protegido')).toBeInTheDocument();
  });
});
