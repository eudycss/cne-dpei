import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OperadorCda, RoleName } from '@cne/shared-types';

import { ListadoOperadores } from './ListadoOperadores';
import { iniciales, normalizar } from './utils';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
let roles: RoleName[] = ['ADMINISTRADOR'];
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { roles } }) }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

const operador = (over: Partial<OperadorCda>): OperadorCda => ({
  id: 'o1',
  numero: 1,
  apellidosNombres: 'CHÁVEZ MORA LUCÍA ESTEFANÍA',
  cedula: '1710034065',
  telefono: '0968333444',
  cargo: 'OPERADOR CDA',
  unidad: null,
  fechaInicio: '2026-10-20',
  tieneFoto: false,
  activo: true,
  creadoEn: '2026-10-22T10:00:00.000Z',
  ...over,
});

function renderPagina() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ListadoOperadores />
    </QueryClientProvider>,
  );
}

describe('ListadoOperadores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roles = ['ADMINISTRADOR'];
  });

  it('muestra nombre, cédula, teléfono, cargo y el estado de la foto', async () => {
    getMock.mockResolvedValueOnce({
      data: [operador({}), operador({ id: 'o2', apellidosNombres: 'ANDRADE LÓPEZ MARÍA JOSÉ', cedula: '1002003000', tieneFoto: true })],
    });
    renderPagina();

    const lista = await screen.findByRole('list', { name: 'Operadores CDA' });
    const tarjetas = within(lista).getAllByRole('listitem');
    expect(tarjetas).toHaveLength(2);
    expect(within(tarjetas[0]).getByRole('heading', { name: 'CHÁVEZ MORA LUCÍA ESTEFANÍA' })).toBeInTheDocument();
    expect(within(tarjetas[0]).getByText('0968333444')).toBeInTheDocument();
    expect(within(tarjetas[0]).getByText('Sin foto')).toBeInTheDocument();
    expect(within(tarjetas[1]).getByText('Foto cargada')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 de 2 operadores · 1 con foto');
  });

  it('filtra sin importar tildes ni mayúsculas, y por cédula', async () => {
    getMock.mockResolvedValueOnce({
      data: [operador({}), operador({ id: 'o2', apellidosNombres: 'ANDRADE LÓPEZ MARÍA JOSÉ', cedula: '1002003000' })],
    });
    renderPagina();
    const buscador = await screen.findByRole('textbox', { name: 'Buscar operador por nombre o cédula' });

    await userEvent.type(buscador, 'chavez');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);

    await userEvent.clear(buscador);
    await userEvent.type(buscador, '100200');
    expect(screen.getByRole('heading', { name: 'ANDRADE LÓPEZ MARÍA JOSÉ' })).toBeInTheDocument();

    await userEvent.clear(buscador);
    await userEvent.type(buscador, 'zzz');
    expect(screen.getByText('Ningún operador coincide con “zzz”.')).toBeInTheDocument();
  });

  it('sin operadores guía al administrador a importar el Excel', async () => {
    getMock.mockResolvedValueOnce({ data: [] });
    renderPagina();
    expect(await screen.findByText('Aún no hay operadores registrados.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importar Excel' })).toBeInTheDocument();
  });

  it('solo el administrador ve el botón de importar', async () => {
    roles = ['ASISTENTE_TRANSVERSAL'];
    getMock.mockResolvedValueOnce({ data: [operador({})] });
    renderPagina();
    await screen.findByRole('list', { name: 'Operadores CDA' });
    expect(screen.queryByRole('button', { name: 'Importar Excel' })).not.toBeInTheDocument();
  });
});

describe('iniciales / normalizar', () => {
  it('toma el primer apellido y el primer nombre', () => {
    expect(iniciales('CHÁVEZ MORA LUCÍA ESTEFANÍA')).toBe('CL');
    expect(iniciales('VEGA LUIS')).toBe('VL');
  });

  it('quita tildes y pasa a minúsculas', () => {
    expect(normalizar('CHÁVEZ Núñez')).toBe('chavez nunez');
  });

  it('"Enlace de foto" abre la ventana del enlace de ese operador; con foto muestra la foto y dice "Cambiar foto"', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:foto');
    URL.revokeObjectURL = vi.fn();
    getMock.mockImplementation(async (url: string) =>
      url === '/operadores-cda'
        ? { data: [operador({}), operador({ id: 'o2', apellidosNombres: 'ANDRADE LÓPEZ MARÍA JOSÉ', tieneFoto: true })] }
        : { data: new Blob(['jpg']) },
    );
    postMock.mockResolvedValue({ data: { token: 'T'.repeat(43), expiraEn: '2026-10-24T19:00:00.000Z' } });
    renderPagina();

    const lista = await screen.findByRole('list', { name: 'Operadores CDA' });
    const [lucia, maria] = within(lista).getAllByRole('listitem');
    expect(within(maria).getByRole('button', { name: 'Cambiar foto: ANDRADE LÓPEZ MARÍA JOSÉ' })).toBeInTheDocument();
    await waitFor(() => expect(maria.querySelector('img')).toHaveAttribute('src', 'blob:foto'));
    expect(getMock).toHaveBeenCalledWith('/operadores-cda/o2/foto', { responseType: 'blob' });
    expect(getMock).not.toHaveBeenCalledWith('/operadores-cda/o1/foto', expect.anything());

    await userEvent.click(within(lucia).getByRole('button', { name: 'Enlace de foto: CHÁVEZ MORA LUCÍA ESTEFANÍA' }));
    expect(await screen.findByRole('dialog', { name: 'Enlace para subir foto' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Generar enlace' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/operadores-cda/o1/enlace-foto'));
  });
});
