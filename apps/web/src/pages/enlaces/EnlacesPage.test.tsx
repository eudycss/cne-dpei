import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ConfigEnlacesResponse, EnlaceRecinto } from '@cne/shared-types';

import { EnlacesPage, ultimaActualizacionVencida } from './EnlacesPage';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));

const apiGetMock = api.get as unknown as ReturnType<typeof vi.fn>;

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

  it('muestra la cantidad de correos configurados en el botón y abre el modal al hacer clic', async () => {
    const user = userEvent.setup();
    correosActuales = ['admin@cne.gob.ec', 'otro@cne.gob.ec'];
    renderPage();

    const boton = await screen.findByRole('button', { name: 'Correos de aviso (2)' });
    expect(screen.queryByText('admin@cne.gob.ec')).not.toBeInTheDocument();

    await user.click(boton);

    expect(await screen.findByText('admin@cne.gob.ec')).toBeInTheDocument();
    expect(screen.getByText('otro@cne.gob.ec')).toBeInTheDocument();
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

  it('los conteos por estado respetan el cantón y la búsqueda seleccionados', async () => {
    const user = userEvent.setup();
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/enlaces') {
        return Promise.resolve({
          data: [
            ...enlaces,
            { codigoRecinto: '990', nombreRecinto: 'Escuela Imantag', canton: 'Cotacachi', estado: 'FALLO', actualizadoEn: '2026-09-23T11:00:00.000Z' },
          ],
        });
      }
      if (url === '/enlaces/config') return Promise.resolve({ data: config() });
      return Promise.resolve({ data: [] });
    });
    renderPage();

    await screen.findByText('Escuela Central');
    await user.selectOptions(screen.getByLabelText('Filtrar por cantón'), 'Cotacachi');

    expect(screen.getByRole('button', { name: 'Todos (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activos (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fallidos (1)' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Buscar por nombre o código'), 'imantag');
    expect(screen.getByRole('button', { name: 'Todos (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Activos (0)' })).toBeInTheDocument();
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

describe('ultimaActualizacionVencida', () => {
  const ahora = new Date('2026-09-29T15:00:00.000Z').getTime();
  const enlace = (actualizadoEn: string): EnlaceRecinto => ({
    codigoRecinto: '1', nombreRecinto: 'X', canton: '', estado: 'ACTIVO', actualizadoEn,
  });

  it('devuelve null si no hay enlaces', () => {
    expect(ultimaActualizacionVencida([], ahora)).toBeNull();
  });

  it('devuelve null en el límite exacto de 15 min y lo marca vencido un segundo después', () => {
    expect(ultimaActualizacionVencida([enlace('2026-09-29T14:45:00.000Z')], ahora)).toBeNull();
    expect(ultimaActualizacionVencida([enlace('2026-09-29T14:44:59.000Z')], ahora)).toBe('2026-09-29T14:44:59.000Z');
  });

  it('ignora fechas inválidas en vez de fallar en silencio', () => {
    expect(ultimaActualizacionVencida([enlace('no-es-fecha')], ahora)).toBeNull();
    const lista = [enlace('no-es-fecha'), enlace('2026-09-28T09:25:00.000Z')];
    expect(ultimaActualizacionVencida(lista, ahora)).toBe('2026-09-28T09:25:00.000Z');
  });

  it('compara por instante y no por texto (offset +00:00 vs Z)', () => {
    const lista = [enlace('2026-09-29T14:58:00+00:00'), enlace('2026-09-28T09:25:00.000Z')];
    expect(ultimaActualizacionVencida(lista, ahora)).toBeNull();
  });

  it('usa la actualización MÁS RECIENTE: un recinto viejo no dispara el aviso si otro está al día', () => {
    const lista = [enlace('2026-09-28T09:25:00.000Z'), enlace('2026-09-29T14:58:00.000Z')];
    expect(ultimaActualizacionVencida(lista, ahora)).toBeNull();
  });

  it('devuelve la última actualización si pasaron más de 15 min', () => {
    const lista = [enlace('2026-09-28T09:25:00.000Z'), enlace('2026-09-28T14:25:00.000Z')];
    expect(ultimaActualizacionVencida(lista, ahora)).toBe('2026-09-28T14:25:00.000Z');
  });
});

describe('EnlacesPage — aviso de datos sin actualizar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    correosActuales = [];
    // Solo se congela Date: los timers reales siguen funcionando para React Query/userEvent.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-23T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function mockEnlaces(data: EnlaceRecinto[]) {
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/enlaces') return Promise.resolve({ data });
      if (url === '/enlaces/config') return Promise.resolve({ data: config() });
      return Promise.resolve({ data: [] });
    });
  }

  it('muestra el aviso cuando la última actualización tiene más de 15 minutos', async () => {
    mockEnlaces(enlaces); // actualizados 11:00, ahora son las 12:00
    renderPage();

    const aviso = await screen.findByText(/Datos sin actualizar desde/);
    expect(aviso).toHaveAttribute('role', 'status');
  });

  it('no muestra el aviso cuando los datos están al día', async () => {
    mockEnlaces(enlaces.map((e) => ({ ...e, actualizadoEn: '2026-09-23T11:55:00.000Z' })));
    renderPage();

    await screen.findByText('Escuela Central');
    expect(screen.queryByText(/Datos sin actualizar desde/)).not.toBeInTheDocument();
  });

  it('el aviso aparece solo con el paso del tiempo, sin recargar ni cambiar los datos', async () => {
    // Re-instalar desde cero: llamar useFakeTimers sobre el del beforeEach no cambia `toFake`.
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2026-09-23T11:10:00.000Z'));
    mockEnlaces(enlaces); // actualizados 11:00 → al día a las 11:10
    renderPage();

    await screen.findByText('Escuela Central');
    expect(screen.queryByText(/Datos sin actualizar desde/)).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(6 * 60_000); // 11:16 → más de 15 min
    });

    expect(await screen.findByText(/Datos sin actualizar desde/)).toBeInTheDocument();
  });
});
