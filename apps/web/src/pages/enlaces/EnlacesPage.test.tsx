import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ConfigEnlacesResponse, EnlaceRecinto } from '@cne/shared-types';

import { EnlacesPage } from './EnlacesPage';
import { api } from '../../lib/api';
import { sileo } from 'sileo';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));

const apiGetMock = api.get as unknown as ReturnType<typeof vi.fn>;
const apiPostMock = api.post as unknown as ReturnType<typeof vi.fn>;
const apiDeleteMock = api.delete as unknown as ReturnType<typeof vi.fn>;
const sileoErrorMock = sileo.error as unknown as ReturnType<typeof vi.fn>;

const enlaces: EnlaceRecinto[] = [
  { codigoRecinto: '978', nombreRecinto: 'Escuela Central', canton: 'Otavalo', estado: 'FALLO', actualizadoEn: '2026-09-23T11:00:00.000Z' },
  { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide', canton: 'Cotacachi', estado: 'ACTIVO', actualizadoEn: '2026-09-23T11:00:00.000Z' },
];

let correosActuales: string[];
const config = (): ConfigEnlacesResponse => ({ correos: correosActuales });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EnlacesPage />
    </QueryClientProvider>,
  );
}

describe('EnlacesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    correosActuales = ['admin@cne.gob.ec'];
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/enlaces') return Promise.resolve({ data: enlaces });
      if (url === '/enlaces/config') return Promise.resolve({ data: config() });
      return Promise.resolve({ data: [] });
    });
  });

  it('lista los enlaces con su estado', async () => {
    renderPage();

    expect(await screen.findByText('Escuela Central')).toBeInTheDocument();
    expect(screen.getByText('Unidad Educativa Zaldumbide')).toBeInTheDocument();
    expect(screen.getByText('FALLO')).toBeInTheDocument();
    expect(screen.getByText('ACTIVO')).toBeInTheDocument();
  });

  it('lista los correos configurados y permite agregar uno nuevo', async () => {
    const user = userEvent.setup();
    apiPostMock.mockImplementation((_url: string, body: { correo: string }) => {
      correosActuales = [...correosActuales, body.correo];
      return Promise.resolve({ data: config() });
    });
    renderPage();

    expect(await screen.findByText('admin@cne.gob.ec')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Nuevo correo'), 'nuevo@cne.gob.ec');
    await user.click(screen.getByText('Agregar'));

    expect(apiPostMock).toHaveBeenCalledWith('/enlaces/config/correos', { correo: 'nuevo@cne.gob.ec' });
    expect(await screen.findByText('nuevo@cne.gob.ec')).toBeInTheDocument();
  });

  it('permite quitar un correo existente', async () => {
    const user = userEvent.setup();
    correosActuales = ['admin@cne.gob.ec', 'otro@cne.gob.ec'];
    apiDeleteMock.mockImplementation((_url: string, opts: { data: { correo: string } }) => {
      correosActuales = correosActuales.filter((c) => c !== opts.data.correo);
      return Promise.resolve({ data: config() });
    });
    renderPage();

    await screen.findByText('otro@cne.gob.ec');
    await user.click(screen.getByLabelText('Quitar otro@cne.gob.ec'));

    expect(apiDeleteMock).toHaveBeenCalledWith('/enlaces/config/correos', { data: { correo: 'otro@cne.gob.ec' } });
    await waitFor(() => {
      expect(screen.queryByText('otro@cne.gob.ec')).not.toBeInTheDocument();
    });
  });

  it('muestra un toast de error si agregar un correo falla', async () => {
    const user = userEvent.setup();
    apiPostMock.mockRejectedValue({ response: { data: { message: 'correo inválido' } } });
    renderPage();

    await screen.findByText('admin@cne.gob.ec');
    await user.type(screen.getByLabelText('Nuevo correo'), 'malo@cne.gob.ec');
    await user.click(screen.getByText('Agregar'));

    await waitFor(() => {
      expect(sileoErrorMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'correo inválido' }));
    });
  });

  it('muestra un toast de error si quitar un correo falla', async () => {
    const user = userEvent.setup();
    apiDeleteMock.mockRejectedValue({ response: { data: { message: 'no se pudo quitar' } } });
    renderPage();

    await screen.findByText('admin@cne.gob.ec');
    await user.click(screen.getByLabelText('Quitar admin@cne.gob.ec'));

    await waitFor(() => {
      expect(sileoErrorMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'no se pudo quitar' }));
    });
  });

  it('filtra la tabla por estado activo o fallido', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Escuela Central');
    expect(screen.getByText('Unidad Educativa Zaldumbide')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Fallidos/ }));
    expect(screen.getByText('Escuela Central')).toBeInTheDocument();
    expect(screen.queryByText('Unidad Educativa Zaldumbide')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Activos/ }));
    expect(screen.queryByText('Escuela Central')).not.toBeInTheDocument();
    expect(screen.getByText('Unidad Educativa Zaldumbide')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Todos/ }));
    expect(screen.getByText('Escuela Central')).toBeInTheDocument();
    expect(screen.getByText('Unidad Educativa Zaldumbide')).toBeInTheDocument();
  });

  it('filtra la tabla por nombre o código buscado', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Escuela Central');
    await user.type(screen.getByLabelText('Buscar por nombre o código'), 'zaldumbide');

    expect(screen.queryByText('Escuela Central')).not.toBeInTheDocument();
    expect(screen.getByText('Unidad Educativa Zaldumbide')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Buscar por nombre o código'));
    await user.type(screen.getByLabelText('Buscar por nombre o código'), '978');

    expect(screen.getByText('Escuela Central')).toBeInTheDocument();
    expect(screen.queryByText('Unidad Educativa Zaldumbide')).not.toBeInTheDocument();
  });

  it('filtra la tabla por cantón', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Escuela Central');
    await user.selectOptions(screen.getByLabelText('Filtrar por cantón'), 'Cotacachi');

    expect(screen.queryByText('Escuela Central')).not.toBeInTheDocument();
    expect(screen.getByText('Unidad Educativa Zaldumbide')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filtrar por cantón'), 'Todos los cantones');
    expect(screen.getByText('Escuela Central')).toBeInTheDocument();
  });

  it('anuncia por aria-live cuántos enlaces quedan tras filtrar', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Escuela Central');
    expect(screen.getByText('Mostrando 2 de 2 enlaces.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Fallidos/ }));
    expect(screen.getByText('Mostrando 1 de 2 enlaces.')).toBeInTheDocument();
  });

  it('muestra la cantidad de enlaces junto a cada filtro', async () => {
    renderPage();

    await screen.findByText('Escuela Central');
    expect(screen.getByRole('button', { name: 'Todos (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activos (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fallidos (1)' })).toBeInTheDocument();
  });

  it('marca aria-pressed en el botón de filtro activo y lo quita de los demás', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Escuela Central');
    const btnTodos = screen.getByRole('button', { name: /^Todos/ });
    const btnActivos = screen.getByRole('button', { name: /^Activos/ });
    const btnFallidos = screen.getByRole('button', { name: /^Fallidos/ });

    expect(btnTodos).toHaveAttribute('aria-pressed', 'true');
    expect(btnActivos).toHaveAttribute('aria-pressed', 'false');
    expect(btnFallidos).toHaveAttribute('aria-pressed', 'false');

    await user.click(btnFallidos);
    expect(btnFallidos).toHaveAttribute('aria-pressed', 'true');
    expect(btnTodos).toHaveAttribute('aria-pressed', 'false');
    expect(btnActivos).toHaveAttribute('aria-pressed', 'false');
  });

  it('vuelve a pedir los enlaces automáticamente sin recargar la página', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPage();

    await vi.waitFor(() => expect(apiGetMock).toHaveBeenCalledWith('/enlaces'));
    const llamadasIniciales = apiGetMock.mock.calls.filter((c) => c[0] === '/enlaces').length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    await vi.waitFor(() => {
      const llamadas = apiGetMock.mock.calls.filter((c) => c[0] === '/enlaces').length;
      expect(llamadas).toBeGreaterThan(llamadasIniciales);
    });

    vi.useRealTimers();
  });

  it('muestra un mensaje cuando el filtro no tiene resultados', async () => {
    const user = userEvent.setup();
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/enlaces') return Promise.resolve({ data: [enlaces[1]] });
      if (url === '/enlaces/config') return Promise.resolve({ data: config() });
      return Promise.resolve({ data: [] });
    });
    renderPage();

    await screen.findByText('Unidad Educativa Zaldumbide');
    await user.click(screen.getByRole('button', { name: /^Fallidos/ }));

    expect(await screen.findByText('No hay enlaces que coincidan con los filtros.')).toBeInTheDocument();
  });
});
