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
    if (url === '/roles') return Promise.resolve({ data: [] });
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
    getMock.mockImplementation((url: string) =>
      Promise.resolve({ data: url === '/roles' ? [] : { items, total: items.length, page: 1, pageSize: 20 } }),
    );
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

describe('UsersList — filtro por rol y restablecer claves en bloque', () => {
  beforeEach(() => vi.clearAllMocks());

  const ROLES = [
    { id: 'r1', nombre: 'OPERADOR_CDA' },
    { id: 'r2', nombre: 'ASISTENTE_TRANSVERSAL' },
  ];
  const conRol = (id: string, nombres: string, rol: string) => ({ ...usuario(id, nombres, true), roles: [rol] }) as User;
  const OP1 = conRol('op1', 'Uno', 'OPERADOR_CDA');
  const OP2 = conRol('op2', 'Dos', 'OPERADOR_CDA');
  const OP3 = conRol('op3', 'Tres', 'OPERADOR_CDA');
  const AT = conRol('at1', 'Jairo', 'ASISTENTE_TRANSVERSAL');

  /** Página de 20 con OP1 y OP2; el total del filtro es 3 (OP3 está en otra página). */
  function apiPaginada() {
    getMock.mockImplementation((url: string) => {
      if (url === '/roles') return Promise.resolve({ data: ROLES });
      const q = new URLSearchParams(url.split('?')[1]);
      if (q.get('role') !== 'OPERADOR_CDA') {
        return Promise.resolve({ data: { items: [OP1, AT], total: 2, page: 1, pageSize: 20 } });
      }
      const items = q.get('pageSize') === '500' ? [OP1, OP2, OP3] : [OP1, OP2];
      return Promise.resolve({ data: { items, total: 3, page: 1, pageSize: Number(q.get('pageSize')) } });
    });
  }

  it('el combo "Rol" filtra el listado por el rol elegido', async () => {
    apiPaginada();
    renderLista();
    const user = userEvent.setup();
    await screen.findByText('Jairo Prueba');

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Filtrar por rol' }), 'OPERADOR_CDA');

    await waitFor(() => expect(getMock).toHaveBeenLastCalledWith(expect.stringContaining('role=OPERADOR_CDA')));
    expect(await screen.findByText('Dos Prueba')).toBeInTheDocument();
    expect(screen.queryByText('Jairo Prueba')).not.toBeInTheDocument();
  });

  it('cambiar el filtro limpia la selección (no se restablece a quien ya no se ve)', async () => {
    apiPaginada();
    renderLista();
    const user = userEvent.setup();
    const fila = (await screen.findByText('Jairo Prueba')).closest('tr')!;
    await user.click(within(fila).getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Restablecer clave (1)' })).toBeEnabled();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filtrar por rol' }), 'OPERADOR_CDA');

    expect(await screen.findByRole('button', { name: 'Restablecer clave (0)' })).toBeDisabled();
  });

  it('selecciona a todos los del filtro (también de otras páginas) y los restablece', async () => {
    apiPaginada();
    const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
    postMock.mockResolvedValueOnce({
      data: { restablecidos: 2, omitidos: [{ id: 'op3', nombre: 'Tres Prueba', motivo: 'Es su propia cuenta' }] },
    });
    renderLista();
    const user = userEvent.setup();
    await screen.findByText('Jairo Prueba');
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Filtrar por rol' }), 'OPERADOR_CDA');
    await screen.findByText('Dos Prueba');

    await user.click(screen.getByRole('checkbox', { name: 'Seleccionar los de esta página' }));
    await user.click(await screen.findByRole('button', { name: 'Seleccionar los 3 usuarios del filtro' }));
    await user.click(await screen.findByRole('button', { name: 'Restablecer clave (3)' }));

    const dialogo = await screen.findByRole('dialog');
    expect(dialogo).toHaveTextContent('3 usuario(s)');
    expect(dialogo).toHaveTextContent('OPERADOR_CDA: 3');
    expect(dialogo).not.toHaveTextContent('ASISTENTE_TRANSVERSAL');
    await user.click(within(dialogo).getByRole('button', { name: 'Restablecer 3 claves' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/users/reset-password-bulk', { userIds: ['op1', 'op2', 'op3'] }),
    );
    expect(await within(dialogo).findByText(/2 clave\(s\) restablecida\(s\)/)).toBeInTheDocument();
    expect(dialogo).toHaveTextContent('Tres Prueba: Es su propia cuenta');
  });
});
