import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
