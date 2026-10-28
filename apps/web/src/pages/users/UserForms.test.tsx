import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@cne/shared-types';

import { NewUser } from './NewUser';
import { EditUserModal } from './EditUserModal';
import { ResetPasswordModal } from './ResetPasswordModal';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
const patchMock = api.patch as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => vi.clearAllMocks());

const USER: User = {
  id: 'u1',
  cedula: '1712345678',
  email: 'ana@cne-imbabura.gob.ec',
  nombres: 'Ana',
  apellidos: 'Torres',
  telefono: null,
  activo: true,
  debeCambiarPwd: false,
  roles: ['OPERADOR_CDA'],
} as unknown as User;

describe('NewUser — accesibilidad', () => {
  it('cada campo tiene su etiqueta asociada y se puede llenar por nombre', async () => {
    const user = userEvent.setup();
    postMock.mockResolvedValue({ data: { email: 'ana@cne-imbabura.gob.ec', initialPassword: 'x' } });
    render(
      <MemoryRouter>
        <NewUser />
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText('Cédula (10 dígitos)'), '1712345675');
    await user.type(screen.getByLabelText('Email'), 'ana@cne-imbabura.gob.ec');
    await user.type(screen.getByLabelText('Nombres'), 'Ana');
    await user.type(screen.getByLabelText('Apellidos'), 'Torres');
    expect(screen.getByLabelText('Teléfono (opcional)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Crear' }));

    expect(postMock).toHaveBeenCalledWith('/users', expect.objectContaining({ cedula: '1712345675', nombres: 'Ana' }));
  });

  it('anuncia el error de validación a lectores de pantalla', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <NewUser />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText('Cédula (10 dígitos)'), '123');
    await user.type(screen.getByLabelText('Email'), 'ana@cne-imbabura.gob.ec');
    await user.type(screen.getByLabelText('Nombres'), 'Ana');
    await user.type(screen.getByLabelText('Apellidos'), 'Torres');
    await user.click(screen.getByRole('button', { name: 'Crear' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/c[eé]dula/i);
    expect(postMock).not.toHaveBeenCalled();
  });
});

describe('EditUserModal — accesibilidad', () => {
  it('los campos y el selector de rol tienen su etiqueta asociada', async () => {
    getMock.mockResolvedValue({ data: [{ id: 'r1', nombre: 'OPERADOR_CDA' }] });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <EditUserModal user={USER} isAdmin onClose={vi.fn()} onDone={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText('Cédula (10 dígitos)')).toHaveValue('1712345678');
    expect(screen.getByLabelText('Nombres')).toHaveValue('Ana');
    expect(screen.getByLabelText('Apellidos')).toHaveValue('Torres');
    expect(screen.getByLabelText('Email')).toHaveValue('ana@cne-imbabura.gob.ec');
    expect(screen.getByLabelText('Teléfono (opcional)')).toHaveValue('');
    expect(screen.getByLabelText('Rol')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Editar usuario' })).toHaveAttribute('aria-modal', 'true');
  });
});

describe('EditUserModal — cédula', () => {
  function renderModal() {
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <EditUserModal user={USER} isAdmin={false} onClose={vi.fn()} onDone={vi.fn()} />
      </QueryClientProvider>,
    );
  }

  it('envía la cédula nueva cuando se cambia', async () => {
    const user = userEvent.setup();
    patchMock.mockResolvedValue({ data: {} });
    renderModal();
    const input = screen.getByLabelText('Cédula (10 dígitos)');
    await user.clear(input);
    await user.type(input, '1710034065');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(patchMock).toHaveBeenCalledWith('/users/u1', expect.objectContaining({ cedula: '1710034065' }));
  });

  it('al pegar una cédula con espacios o guiones deja solo los dígitos', async () => {
    const user = userEvent.setup();
    renderModal();
    const input = screen.getByLabelText('Cédula (10 dígitos)');
    await user.clear(input);
    await user.click(input);
    await user.paste('171 003-4065');
    expect(input).toHaveValue('1710034065');
    expect(input).toHaveAccessibleDescription(/no afecta sus asignaciones/);
  });

  it('no envía la cédula si no cambió', async () => {
    const user = userEvent.setup();
    patchMock.mockResolvedValue({ data: {} });
    renderModal();
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(patchMock).toHaveBeenCalledWith('/users/u1', expect.not.objectContaining({ cedula: expect.anything() }));
  });

  it('bloquea una cédula inválida y lo anuncia', async () => {
    const user = userEvent.setup();
    renderModal();
    const input = screen.getByLabelText('Cédula (10 dígitos)');
    await user.clear(input);
    await user.type(input, '1710034066');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/c[eé]dula/i);
    expect(patchMock).not.toHaveBeenCalled();
  });
});

describe('EditUserModal — errores', () => {
  it('anuncia el error del servidor a lectores de pantalla', async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({ data: [{ id: 'r1', nombre: 'OPERADOR_CDA' }] });
    patchMock.mockRejectedValue({ response: { data: { message: 'Email ya registrado' } } });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <EditUserModal user={USER} isAdmin={false} onClose={vi.fn()} onDone={vi.fn()} />
      </QueryClientProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email ya registrado');
  });
});

describe('EditUserModal — cuenta CDA sin correo', () => {
  function renderSinCorreo() {
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <EditUserModal user={{ ...USER, email: null }} isAdmin={false} onClose={vi.fn()} onDone={vi.fn()} />
      </QueryClientProvider>,
    );
  }

  it('el correo queda vacío y opcional, y guardar no lo envía', async () => {
    const user = userEvent.setup();
    patchMock.mockResolvedValue({ data: {} });
    renderSinCorreo();

    const correo = screen.getByLabelText(/Email/);
    expect(correo).toHaveValue('');
    expect(correo).not.toBeRequired();
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(patchMock).toHaveBeenCalledWith('/users/u1', expect.not.objectContaining({ email: expect.anything() }));
  });

  it('si se escribe un correo, se envía', async () => {
    const user = userEvent.setup();
    patchMock.mockResolvedValue({ data: {} });
    renderSinCorreo();

    await user.type(screen.getByLabelText(/Email/), 'nuevo@cne-imbabura.gob.ec');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(patchMock).toHaveBeenCalledWith('/users/u1', expect.objectContaining({ email: 'nuevo@cne-imbabura.gob.ec' }));
  });
});

describe('ResetPasswordModal — cuenta CDA sin correo', () => {
  it('identifica a la persona por su cédula', () => {
    render(<ResetPasswordModal user={{ ...USER, email: null }} onClose={vi.fn()} onDone={vi.fn()} />);

    expect(screen.getByText(/cédula 1712345678/)).toBeInTheDocument();
    expect(screen.queryByText(/null/)).not.toBeInTheDocument();
  });
});
