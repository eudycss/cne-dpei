import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import type { RoleName } from '@cne/shared-types';

import { AuthProvider } from './AuthContext';
import { ProtectedRoute } from './ProtectedRoute';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: { post: vi.fn(), get: vi.fn() },
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

function renderConModulo(modulo: 'alertas' | 'kits') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/protegido']}>
          <Routes>
            <Route
              path="/protegido"
              element={
                <ProtectedRoute modulo={modulo}>
                  <div>contenido protegido</div>
                </ProtectedRoute>
              }
            />
            <Route path="/kits" element={<div>página de kits</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('ProtectedRoute — módulos configurados por el administrador', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.get).mockReset();
  });

  it('muestra el módulo si está entre los visibles del usuario', async () => {
    setSessionUser({ roles: ['TECNICO_SUPERVISOR'] });
    vi.mocked(api.get).mockResolvedValue({ data: { modulos: ['alertas'] } });
    renderConModulo('alertas');
    expect(await screen.findByText('contenido protegido')).toBeInTheDocument();
  });

  it('si el módulo está oculto, lleva al primer módulo visible', async () => {
    setSessionUser({ roles: ['TECNICO_SUPERVISOR'] });
    vi.mocked(api.get).mockResolvedValue({ data: { modulos: ['kits'] } });
    renderConModulo('alertas');
    expect(await screen.findByText('página de kits')).toBeInTheDocument();
  });

  it('si no le queda ningún módulo visible, muestra "Acceso denegado"', async () => {
    setSessionUser({ roles: ['LECTOR'] });
    vi.mocked(api.get).mockResolvedValue({ data: { modulos: [] } });
    renderConModulo('kits');
    expect(await screen.findByText('Acceso denegado')).toBeInTheDocument();
  });

  it('mientras carga no redirige: espera la respuesta del servidor', async () => {
    setSessionUser({ roles: ['LECTOR'] });
    let responder!: (v: unknown) => void;
    vi.mocked(api.get).mockReturnValue(new Promise((r) => (responder = r)));
    // Alertas no es de fábrica para el lector: con la de fábrica se lo redirigiría.
    renderConModulo('alertas');
    expect(screen.getByRole('status')).toHaveTextContent('Cargando…');
    expect(screen.queryByText('página de kits')).not.toBeInTheDocument();
    responder({ data: { modulos: ['alertas', 'kits'] } });
    expect(await screen.findByText('contenido protegido')).toBeInTheDocument();
  });

  it('si el servidor falla usa la visibilidad de fábrica (sin bloquear al usuario)', async () => {
    setSessionUser({ roles: ['TECNICO_SUPERVISOR'] });
    vi.mocked(api.get).mockRejectedValue(new Error('red caída'));
    renderConModulo('alertas');
    expect(await screen.findByText('contenido protegido')).toBeInTheDocument();
  });

  it('el administrador ve todos los módulos sin consultar el servidor', () => {
    setSessionUser({ roles: ['ADMINISTRADOR'] });
    renderConModulo('kits');
    expect(screen.getByText('contenido protegido')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});
