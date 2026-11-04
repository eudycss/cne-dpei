import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { HistorialParejasCda } from '@cne/shared-types';

import { OperadoresCdaPage } from './OperadoresCdaPage';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
const auth = vi.hoisted(() => ({ roles: ['TECNICO_SUPERVISOR'] }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { roles: auth.roles } }) }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;

const HISTORIAL: HistorialParejasCda = {
  fechas: ['2026-10-28', '2026-11-01'],
  personas: [
    {
      id: 'p1',
      apellidosNombres: 'GUDIÑO LUIS',
      cedula: '1710034065',
      grupo: 'OPERADOR',
      dispositivo: 'ANDROID',
      activo: true,
      fechas: ['2026-10-28'],
      recintos: ['971 · UE Chaltura'],
    },
    {
      id: 'p2',
      apellidosNombres: 'MUÑOZ MARÍA',
      cedula: '1713175071',
      grupo: 'ASISTENTE',
      dispositivo: null,
      activo: true,
      fechas: [],
      recintos: [],
    },
    {
      id: 'p3',
      apellidosNombres: 'PÉREZ ANA',
      cedula: '1712345675',
      grupo: 'ASISTENTE',
      dispositivo: 'IPHONE',
      activo: false,
      fechas: ['2026-11-01'],
      recintos: ['971 · UE Chaltura'],
    },
  ],
  recintos: [
    {
      id: 'r1',
      codigo: '971',
      nombre: 'UE Chaltura',
      canton: 'ANTONIO ANTE',
      visitas: [{ fecha: '2026-10-28', operador: 'GUDIÑO LUIS', asistente: null, kitCodigo: 'KIT-0001', llevaKit: 'GUDIÑO LUIS' }],
    },
    { id: 'r2', codigo: '1133', nombre: 'CECIB Manuel J. Calle', canton: 'COTACACHI', visitas: [] },
  ],
};

function mockApi(fechas = ['2026-10-28', '2026-11-01']) {
  getMock.mockImplementation((url: string) => {
    if (url.startsWith('/parejas-cda/fechas')) return Promise.resolve({ data: fechas });
    if (url.startsWith('/parejas-cda/historial/reporte.')) return Promise.resolve({ data: new Blob(['x']), headers: {} });
    if (url.startsWith('/parejas-cda/historial?')) return Promise.resolve({ data: HISTORIAL });
    if (url.startsWith('/operadores-cda/asistencia')) return Promise.resolve({ data: { fecha: '2026-11-01', esHoy: true, filas: [] } });
    return Promise.resolve({ data: [] });
  });
}

function renderPagina(ruta = '/operadores-cda?tab=historial') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <OperadoresCdaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const filas = (region: string) => within(screen.getByRole('region', { name: region })).getAllByRole('row').slice(1);
const nombres = (region: string) => filas(region).map((f) => within(f).getByRole('rowheader').textContent);

describe('Historial de parejas', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auth.roles = ['TECNICO_SUPERVISOR'];
  });

  it('la pestaña solo existe en Operadores y Asistentes CDA', async () => {
    mockApi();
    renderPagina('/operadores-cda');
    expect(screen.getByRole('tab', { name: 'Historial de parejas' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cargo' }), 'Digitadores');
    expect(screen.queryByRole('tab', { name: 'Historial de parejas' })).not.toBeInTheDocument();
  });

  it('por defecto pide todas las fechas con lista y muestra el resumen', async () => {
    mockApi();
    renderPagina();
    expect(await screen.findByText('2 / 3')).toBeInTheDocument();
    expect(screen.getByText('1 / 2')).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/parejas-cda/historial?fechas=2026-10-28&fechas=2026-11-01');
    expect(screen.getByRole('button', { name: /2026-10-28/ })).toHaveAttribute('aria-pressed', 'true');
    expect(nombres('Personal del historial')).toEqual([
      expect.stringContaining('GUDIÑO LUIS'),
      expect.stringContaining('MUÑOZ MARÍA'),
      expect.stringContaining('PÉREZ ANA'),
    ]);
    expect(within(filas('Personal del historial')[2]).getByText('Oculto')).toBeInTheDocument();
    // La propuesta para una nueva prueba solo la arma el administrador.
    expect(screen.queryByRole('button', { name: 'Propuesta para nueva prueba' })).not.toBeInTheDocument();
  });

  it('quitar una fecha vuelve a pedir el historial solo con las que quedan; sin ninguna, lo avisa', async () => {
    mockApi();
    renderPagina();
    await screen.findByText('2 / 3');
    await userEvent.click(screen.getByRole('button', { name: /2026-10-28/ }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/parejas-cda/historial?fechas=2026-11-01'));
    await userEvent.click(screen.getByRole('button', { name: /2026-11-01/ }));
    expect(screen.getByRole('alert')).toHaveTextContent('Elija al menos una fecha.');
    expect(screen.queryByRole('button', { name: 'Reporte PDF' })).not.toBeInTheDocument();
  });

  it('filtra al personal por ¿fue?, cargo, dispositivo y buscador sin tildes', async () => {
    mockApi();
    renderPagina();
    await screen.findByText('2 / 3');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: '¿Fue?' }), 'No fue');
    expect(nombres('Personal del historial')).toEqual([expect.stringContaining('MUÑOZ MARÍA')]);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '¿Fue?' }), 'Todos');

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Dispositivo' }), 'Sin registrar');
    expect(nombres('Personal del historial')).toEqual([expect.stringContaining('MUÑOZ MARÍA')]);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Dispositivo' }), 'Todos');

    // El combo "Cargo" de la página es el primero; el del historial, el segundo.
    const [, cargo] = screen.getAllByRole('combobox', { name: 'Cargo' });
    await userEvent.selectOptions(cargo, 'Asistente CDA');
    expect(filas('Personal del historial')).toHaveLength(2);
    await userEvent.selectOptions(cargo, 'Todos');

    await userEvent.type(screen.getByRole('textbox', { name: /Buscar personal/ }), 'gudino');
    expect(nombres('Personal del historial')).toEqual([expect.stringContaining('GUDIÑO LUIS')]);
    expect(screen.getByText('1 de 3')).toHaveAttribute('role', 'status');
  });

  it('la vista Recintos muestra visitados y no visitados, con la pareja y el kit; filtra por cantón', async () => {
    mockApi();
    renderPagina();
    await screen.findByText('2 / 3');
    await userEvent.click(screen.getByRole('button', { name: 'Recintos' }));

    const [chaltura, calle] = filas('Recintos del historial');
    expect(within(chaltura).getByText('Visitado')).toBeInTheDocument();
    expect(chaltura).toHaveTextContent('GUDIÑO LUIS (sin asistente) · Kit KIT-0001, lo lleva GUDIÑO LUIS');
    expect(within(calle).getByText('No visitado')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cantón' }), 'COTACACHI');
    expect(nombres('Recintos del historial')).toEqual([expect.stringContaining('1133')]);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cantón' }), 'Todos');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '¿Visitado?' }), 'Visitado');
    expect(nombres('Recintos del historial')).toEqual([expect.stringContaining('971')]);
  });

  it.each([
    ['Reporte PDF', 'pdf'],
    ['Reporte Excel', 'xlsx'],
  ])('"%s" descarga el reporte de las fechas elegidas', async (boton, formato) => {
    mockApi();
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const descargas: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      descargas.push(this.download);
    });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: boton }));
    await waitFor(() => expect(descargas).toEqual([`historial_parejas_cda_2026-10-28_2026-11-01.${formato}`]));
    expect(getMock).toHaveBeenCalledWith(`/parejas-cda/historial/reporte.${formato}?fechas=2026-10-28&fechas=2026-11-01`, {
      responseType: 'blob',
    });
  });

  it('si el historial no carga, muestra el error del servidor', async () => {
    mockApi();
    const base = getMock.getMockImplementation()!;
    getMock.mockImplementation((url: string) =>
      url.startsWith('/parejas-cda/historial?') ? Promise.reject({ response: { data: { message: 'Elija como máximo 20 fechas' } } }) : base(url),
    );
    renderPagina();
    expect(await screen.findByRole('alert')).toHaveTextContent('Elija como máximo 20 fechas');
  });

  it('quien fue y hoy tiene otro cargo se ve con el nombre de ese cargo', async () => {
    mockApi();
    const base = getMock.getMockImplementation()!;
    const otro = { ...HISTORIAL.personas[0], id: 'p9', apellidosNombres: 'ZAMBRANO JOSÉ', grupo: 'DIGITADOR' };
    getMock.mockImplementation((url: string) =>
      url.startsWith('/parejas-cda/historial?') ? Promise.resolve({ data: { ...HISTORIAL, personas: [otro] } }) : base(url),
    );
    renderPagina();
    const [fila] = await screen.findAllByRole('row').then(() => filas('Personal del historial'));
    expect(fila).toHaveTextContent('Digitadores');
  });

  it('el administrador abre la propuesta con las fechas elegidas como referencia', async () => {
    auth.roles = ['ADMINISTRADOR'];
    mockApi();
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Propuesta para nueva prueba' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Referencia: 2026-10-28, 2026-11-01');
  });

  it('sin listas de parejas lo dice', async () => {
    mockApi([]);
    renderPagina();
    expect(await screen.findByText('Aún no hay listas de parejas.')).toBeInTheDocument();
  });
});
