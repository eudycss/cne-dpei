import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@cne/shared-types';

import { UsersList } from './UsersList';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { roles: ['ADMINISTRADOR'] } }) }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;

const usuario = (id: string, nombres: string, activo: boolean) =>
  ({
    id,
    cedula: '1712345675',
    email: `${id}@cne-imbabura.gob.ec`,
    nombres,
    apellidos: 'Prueba',
    telefono: null,
    activo,
    debeCambiarPwd: false,
    roles: ['OPERADOR_CDA'],
  }) as unknown as User;

const ACTIVA = usuario('ana', 'Ana', true);
const INACTIVO = usuario('luis', 'Luis', false);

/** Simula la API: con activo=true devuelve solo activos; sin filtro, todos. */
function apiUsuarios() {
  getMock.mockImplementation((url: string) => {
    const soloActivos = new URLSearchParams(url.split('?')[1]).get('activo') === 'true';
    const items = soloActivos ? [ACTIVA] : [ACTIVA, INACTIVO];
    return Promise.resolve({ data: { items, total: items.length, page: 1, pageSize: 20 } });
  });
}

function renderLista() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <UsersList />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('UsersList — usuarios inactivos', () => {
  beforeEach(() => vi.clearAllMocks());

  it('por defecto pide solo activos y no muestra a los desactivados', async () => {
    apiUsuarios();
    renderLista();

    expect(await screen.findByText('Ana Prueba')).toBeInTheDocument();
    expect(screen.queryByText('Luis Prueba')).not.toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith(expect.stringContaining('activo=true'));
    expect(screen.getByRole('checkbox', { name: 'Mostrar inactivos' })).not.toBeChecked();
  });

  it('con "Mostrar inactivos" aparecen los desactivados con su botón Activar', async () => {
    const user = userEvent.setup();
    apiUsuarios();
    renderLista();
    await screen.findByText('Ana Prueba');

    await user.click(screen.getByRole('checkbox', { name: 'Mostrar inactivos' }));

    const fila = (await screen.findByText('Luis Prueba')).closest('tr')!;
    expect(fila).toHaveTextContent('Inactivo');
    expect(fila.querySelector('button')).not.toBeNull();
    await waitFor(() => expect(getMock).toHaveBeenLastCalledWith(expect.not.stringContaining('activo=')));
  });
});

describe('UsersList — cuentas CDA sin correo y bloqueo', () => {
  beforeEach(() => vi.clearAllMocks());

  function apiCon(items: User[]) {
    getMock.mockResolvedValue({ data: { items, total: items.length, page: 1, pageSize: 20 } });
  }

  it('una cuenta sin correo muestra un guion en la columna de email', async () => {
    apiCon([{ ...ACTIVA, email: null }]);
    renderLista();

    const fila = (await screen.findByText('Ana Prueba')).closest('tr')!;
    // Columnas con administrador: selección, cédula, nombre, email…
    const celdaEmail = within(fila).getAllByRole('cell')[3];
    expect(celdaEmail).toHaveTextContent('—');
  });

  it('muestra "Bloqueada hasta" y desbloquea con el botón', async () => {
    const hasta = new Date(Date.now() + 10 * 60_000).toISOString();
    apiCon([{ ...ACTIVA, bloqueadoHasta: hasta }]);
    const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
    postMock.mockResolvedValueOnce({ data: { ...ACTIVA, bloqueadoHasta: null } });
    renderLista();

    expect(await screen.findByText(/Bloqueada hasta/)).toBeInTheDocument();
    // Cada fila dice a quién desbloquea (WCAG 2.4.6).
    await userEvent.setup().click(screen.getByRole('button', { name: 'Desbloquear a Ana Prueba' }));

    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/users/ana/desbloquear'));
  });

  it('un bloqueo vencido no se muestra ni ofrece desbloquear', async () => {
    apiCon([{ ...ACTIVA, bloqueadoHasta: new Date(Date.now() - 60_000).toISOString() }]);
    renderLista();

    await screen.findByText('Ana Prueba');
    expect(screen.queryByText(/Bloqueada hasta/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /desbloquear/i })).not.toBeInTheDocument();
  });
});

describe('UsersList — llegada al DPEI olvidada', () => {
  beforeEach(() => vi.clearAllMocks());

  it('un operador CDA tiene "Registrar llegada al DPEI", que abre el diálogo y la registra con el motivo', async () => {
    apiUsuarios();
    const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
    postMock.mockResolvedValueOnce({ data: { id: 'x', ocurridoEn: '2026-10-30T23:00:00Z' } });
    renderLista();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Registrar llegada al DPEI de Ana Prueba' }));
    await user.type(screen.getByLabelText('Motivo (requerido)'), 'Olvidó marcarla en la app');
    await user.click(screen.getByRole('button', { name: 'Registrar llegada' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/tracking/operadores/ana/llegada-dpi-manual', { motivo: 'Olvidó marcarla en la app' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
