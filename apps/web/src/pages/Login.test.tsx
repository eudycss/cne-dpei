import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import { AuthProvider } from '../auth/AuthContext';
import { Login } from './Login';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: { post: vi.fn() },
  tokenStore: { set: vi.fn(), clear: vi.fn() },
}));

const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

function baseUser(overrides: Partial<{ debeCambiarPwd: boolean }> = {}) {
  return {
    id: 'u1',
    email: 'admin@cne-imbabura.gob.ec',
    nombres: 'Admin',
    apellidos: 'CNE',
    debeCambiarPwd: false,
    roles: ['ADMINISTRADOR'],
    ...overrides,
  };
}

function renderLogin(initialEntries: (string | { pathname: string; state?: unknown })[] = ['/login']) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/change-password" element={<div>pantalla cambiar password</div>} />
          <Route path="/kits" element={<div>pantalla kits</div>} />
          <Route path="/" element={<div>pantalla home</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

async function submitLogin(container: HTMLElement, email: string, password: string) {
  const user = userEvent.setup();
  await user.type(container.querySelector('input[type="email"]')!, email);
  await user.type(container.querySelector('input[type="password"]')!, password);
  await user.click(screen.getByRole('button', { name: /iniciar sesión/i }));
}

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('muestra error si las credenciales son inválidas', async () => {
    postMock.mockRejectedValueOnce({ response: { data: { message: 'Credenciales inválidas' } } });
    const { container } = renderLogin();

    await submitLogin(container, 'x@x.com', 'wrongpass');

    expect(await screen.findByText('Credenciales inválidas')).toBeInTheDocument();
  });

  it('redirige a /change-password si el usuario debe cambiar la contraseña', async () => {
    postMock.mockResolvedValueOnce({
      data: { accessToken: 'a', refreshToken: 'r', user: baseUser({ debeCambiarPwd: true }) },
    });
    const { container } = renderLogin();

    await submitLogin(container, 'x@x.com', 'Abc123!!');

    expect(await screen.findByText('pantalla cambiar password')).toBeInTheDocument();
  });

  it('redirige a la ruta original (location.state.from) tras login exitoso', async () => {
    postMock.mockResolvedValueOnce({
      data: { accessToken: 'a', refreshToken: 'r', user: baseUser() },
    });
    const { container } = renderLogin([
      { pathname: '/login', state: { from: { pathname: '/kits' } } },
    ]);

    await submitLogin(container, 'x@x.com', 'Abc123!!');

    expect(await screen.findByText('pantalla kits')).toBeInTheDocument();
  });

  it('redirige a / si no hay ruta previa guardada', async () => {
    postMock.mockResolvedValueOnce({
      data: { accessToken: 'a', refreshToken: 'r', user: baseUser() },
    });
    const { container } = renderLogin();

    await submitLogin(container, 'x@x.com', 'Abc123!!');

    expect(await screen.findByText('pantalla home')).toBeInTheDocument();
  });
});
