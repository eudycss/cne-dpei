import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OperadorCda, PersonaCdaEncontrada } from '@cne/shared-types';

import { OperadoresCdaPage } from './OperadoresCdaPage';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const auth = vi.hoisted(() => ({ roles: ['ADMINISTRADOR'] }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { roles: auth.roles } }) }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;

const DIGITADORA: PersonaCdaEncontrada = {
  id: 'd1',
  apellidosNombres: 'PÉREZ LÓPEZ ANA',
  cedula: '1005201015',
  grupo: 'DIGITADOR',
  activo: true,
};

function operador(o: Partial<OperadorCda>): OperadorCda {
  return {
    id: 'o1',
    grupo: 'OPERADOR',
    numero: 1,
    apellidosNombres: 'RUIZ MORA JUAN',
    cedula: '1710034065',
    telefono: null,
    cargo: 'OPERADOR CDA',
    unidad: null,
    fechaInicio: null,
    tieneFoto: false,
    activo: true,
    cuenta: 'SIN_CUENTA',
    creadoEn: '2026-10-22T10:00:00Z',
    ...o,
  };
}

/** Respuestas de la API: lo que devuelve el buscador y el listado de cada cargo. */
function mockApi(encontradas: PersonaCdaEncontrada[], listados: Partial<Record<string, OperadorCda[]>> = {}) {
  getMock.mockImplementation((url: string) => {
    if (url.startsWith('/operadores-cda/buscar')) return Promise.resolve({ data: encontradas });
    if (url.startsWith('/operadores-cda/asistencia')) return Promise.resolve({ data: { fecha: '2026-10-22', esHoy: true, filas: [] } });
    const grupo = /grupo=([A-Z_]+)/.exec(url)?.[1] ?? '';
    return Promise.resolve({ data: listados[grupo] ?? [] });
  });
}

function renderPagina(ruta = '/operadores-cda') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <OperadoresCdaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const buscador = () => screen.getByRole('textbox', { name: 'Buscar persona en todos los cargos' });

describe('Buscador en todos los cargos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.roles = ['ADMINISTRADOR'];
  });

  it('con menos de 3 caracteres no consulta a la API y lo explica', async () => {
    mockApi([DIGITADORA]);
    renderPagina();
    await userEvent.type(buscador(), '10');
    expect(screen.getByText('Escriba al menos 3 caracteres del nombre o la cédula.')).toBeInTheDocument();
    expect(getMock).not.toHaveBeenCalledWith(expect.stringMatching(/^\/operadores-cda\/buscar/));
  });

  it('muestra a la persona con su cargo y centro, y "Ir a su listado" la deja filtrada en ese cargo', async () => {
    mockApi([DIGITADORA], { DIGITADOR: [operador({ ...DIGITADORA, grupo: 'DIGITADOR', cargo: 'DIGITADOR CPE' })] });
    renderPagina();
    await userEvent.type(buscador(), '1005201015');

    const resultados = await screen.findByRole('list', { name: 'Personas encontradas en todos los cargos' });
    expect(getMock).toHaveBeenCalledWith('/operadores-cda/buscar?q=1005201015&incluirInactivos=true');
    expect(screen.getByText('1 persona encontrada.')).toBeInTheDocument();
    const fila = within(resultados).getByRole('listitem');
    expect(fila).toHaveTextContent('PÉREZ LÓPEZ ANA');
    expect(fila).toHaveTextContent('1005201015');
    expect(fila).toHaveTextContent('Digitadores · CPE');

    await userEvent.click(within(fila).getByRole('button', { name: 'Ir al listado de PÉREZ LÓPEZ ANA' }));

    expect(screen.getByRole('combobox', { name: 'Cargo' })).toHaveDisplayValue('Digitadores');
    expect(screen.getByRole('tab', { name: 'Listado' })).toHaveAttribute('aria-selected', 'true');
    const filtro = await screen.findByRole('textbox', { name: 'Buscar digitador por nombre o cédula' });
    expect(filtro).toHaveValue('1005201015');
    // El foco no se pierde: queda en el filtro del listado al que se llegó.
    await waitFor(() => expect(filtro).toHaveFocus());
    expect(await screen.findByText('1 de 1 digitadores · 0 con foto')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/operadores-cda?grupo=DIGITADOR');
    // El buscador se vacía al llegar.
    expect(buscador()).toHaveValue('');
  });

  it('si la persona está oculta, al ir a su listado se activa "Mostrar ocultos"', async () => {
    mockApi([{ ...DIGITADORA, activo: false }]);
    renderPagina();
    await userEvent.type(buscador(), 'pérez');
    const fila = within(await screen.findByRole('list', { name: 'Personas encontradas en todos los cargos' })).getByRole('listitem');
    expect(fila).toHaveTextContent('Oculto');

    await userEvent.click(within(fila).getByRole('button', { name: 'Ir al listado de PÉREZ LÓPEZ ANA' }));

    expect(await screen.findByRole('button', { name: 'Mostrar ocultos' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/operadores-cda?grupo=DIGITADOR&incluirInactivos=true'));
  });

  it('quien no es administrador busca sin pedir ocultos', async () => {
    auth.roles = ['TECNICO_SUPERVISOR'];
    mockApi([DIGITADORA]);
    renderPagina();
    await userEvent.type(buscador(), 'pérez');
    await screen.findByRole('list', { name: 'Personas encontradas en todos los cargos' });
    expect(getMock).toHaveBeenCalledWith(`/operadores-cda/buscar?q=${encodeURIComponent('pérez')}`);
  });

  it('con 20 resultados avisa que escriba más; si la API falla, lo dice', async () => {
    mockApi(Array.from({ length: 20 }, (_, i) => ({ ...DIGITADORA, id: `d${i}`, cedula: `10052010${String(i).padStart(2, '0')}` })));
    renderPagina();
    await userEvent.type(buscador(), '1005');
    expect(await screen.findByText(/Se muestran las primeras 20/)).toBeInTheDocument();
    expect(screen.getByText('20 personas encontradas.')).toBeInTheDocument();

    getMock.mockRejectedValue({ response: { data: { message: 'Escriba al menos 3 caracteres del nombre o la cédula' } } });
    await userEvent.type(buscador(), '9');
    expect(await screen.findByRole('alert')).toHaveTextContent('Escriba al menos 3 caracteres');
  });

  it('sin coincidencias lo dice', async () => {
    mockApi([]);
    renderPagina();
    await userEvent.type(buscador(), 'zzz');
    expect(await screen.findByText('Nadie coincide con “zzz” en ningún cargo.')).toBeInTheDocument();
  });

  it('cuando el listado da 0 resultados, indica en qué otro cargo está la persona y lleva ahí', async () => {
    mockApi([DIGITADORA], { OPERADOR: [operador({})], DIGITADOR: [operador({ ...DIGITADORA, grupo: 'DIGITADOR' })] });
    renderPagina('/operadores-cda?tab=listado');
    await userEvent.type(await screen.findByRole('textbox', { name: 'Buscar operador por nombre o cédula' }), '1005201015');

    expect(screen.getByText('Ningún operador coincide con “1005201015”.')).toBeInTheDocument();
    const aviso = await screen.findByRole('list', { name: 'Está en otro cargo' });
    expect(aviso).toHaveTextContent('PÉREZ LÓPEZ ANA');
    expect(aviso).toHaveTextContent('Digitadores · CPE');

    await userEvent.click(within(aviso).getByRole('button', { name: 'Ir al listado de PÉREZ LÓPEZ ANA' }));
    expect(screen.getByRole('combobox', { name: 'Cargo' })).toHaveDisplayValue('Digitadores');
    const filtro = await screen.findByRole('textbox', { name: 'Buscar digitador por nombre o cédula' });
    expect(filtro).toHaveValue('1005201015');
    await waitFor(() => expect(filtro).toHaveFocus());
  });
});
