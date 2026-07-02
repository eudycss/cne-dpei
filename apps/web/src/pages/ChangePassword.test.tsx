import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

import { AuthProvider } from '../auth/AuthContext';
import { ChangePassword } from './ChangePassword';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: { post: vi.fn() },
  tokenStore: { set: vi.fn(), clear: vi.fn() },
}));

const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
const USER_KEY = 'cne.user';

function setSessionUser(overrides: Partial<{ debeCambiarPwd: boolean }> = {}) {
  localStorage.setItem(
    USER_KEY,
    JSON.stringify({
      id: 'u1',
      email: 'admin@cne-imbabura.gob.ec',
      nombres: 'Admin',
      apellidos: 'CNE',
      debeCambiarPwd: true,
      roles: ['ADMINISTRADOR'],
      ...overrides,
    }),
  );
}

function renderChangePassword() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/change-password']}>
        <Routes>
          <Route path="/change-password" element={<ChangePassword />} />
          <Route path="/users" element={<div>pantalla users</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

async function fillAndSubmit(
  container: HTMLElement,
  current: string,
  next: string,
  confirm: string,
) {
  const user = userEvent.setup();
  const [currentInput, newInput, confirmInput] = Array.from(
    container.querySelectorAll('input[type="password"]'),
  );
  await user.type(currentInput, current);
  await user.type(newInput, next);
  await user.type(confirmInput, confirm);
  await user.click(screen.getByRole('button', { name: /cambiar contraseña/i }));
}

describe('ChangePassword', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    setSessionUser();
  });

  it('muestra error si la confirmación no coincide', async () => {
    const { container } = renderChangePassword();

    await fillAndSubmit(container, 'Actual1!', 'Nueva1!', 'Otra1!');

    expect(await screen.findByText('La confirmación no coincide')).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('muestra error si la nueva contraseña no cumple la política de seguridad', async () => {
    const { container } = renderChangePassword();

    await fillAndSubmit(container, 'Actual1!', 'abc123', 'abc123');

    expect(await screen.findByText('Debe incluir al menos una mayúscula')).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('muestra error del servidor si la contraseña actual es incorrecta', async () => {
    postMock.mockRejectedValueOnce({
      response: { data: { message: 'La contraseña actual no es correcta' } },
    });
    const { container } = renderChangePassword();

    await fillAndSubmit(container, 'ActualMal1!', 'Nueva12!', 'Nueva12!');

    expect(await screen.findByText('La contraseña actual no es correcta')).toBeInTheDocument();
  });

  it('cambia la contraseña, marca al usuario como al día y navega a /users', async () => {
    postMock.mockResolvedValueOnce({ data: {} });
    const { container } = renderChangePassword();

    await fillAndSubmit(container, 'Actual1!', 'Nueva12!', 'Nueva12!');

    expect(postMock).toHaveBeenCalledWith('/auth/change-password', {
      currentPassword: 'Actual1!',
      newPassword: 'Nueva12!',
    });
    expect(await screen.findByText('Contraseña actualizada')).toBeInTheDocument();

    const stored = JSON.parse(localStorage.getItem(USER_KEY) ?? '{}');
    expect(stored.debeCambiarPwd).toBe(false);

    // el componente navega a /users con un setTimeout(800ms) real tras el éxito
    expect(await screen.findByText('pantalla users', {}, { timeout: 2000 })).toBeInTheDocument();
  });
});
