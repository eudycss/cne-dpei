import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';

import { PreparacionPage } from './PreparacionPage';
import { pasoActual } from '../../lib/queries/preparacion';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn() },
}));

const apiGetMock = api.get as unknown as ReturnType<typeof vi.fn>;

const EVENTO = { id: 'ev1', nombre: 'Elecciones Seccionales 2027', estado: 'ACTIVO' };

interface Datos {
  recintos?: number;
  usuarios?: number;
  militares?: number;
  evento?: typeof EVENTO | '';
  asignaciones?: number;
  kits?: number;
}

function mockApi({ recintos = 0, usuarios = 0, militares = 0, evento = '', asignaciones = 0, kits = 0 }: Datos) {
  apiGetMock.mockImplementation((url: string) => {
    const pag = (total: number) => Promise.resolve({ data: { items: [], total, page: 1, pageSize: 1 } });
    if (url.startsWith('/recintos')) return pag(recintos);
    if (url.startsWith('/users')) return pag(usuarios);
    if (url.startsWith('/militares')) return pag(militares);
    if (url === '/eventos/active') return Promise.resolve({ data: evento });
    if (url.startsWith('/asignaciones')) return Promise.resolve({ data: new Array(asignaciones).fill({}) });
    if (url.startsWith('/kits')) return pag(kits);
    return Promise.reject(new Error(`URL inesperada: ${url}`));
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PreparacionPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PreparacionPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marca los pasos con datos como listos y el primero sin datos como siguiente', async () => {
    mockApi({ recintos: 137, usuarios: 1, militares: 0 });
    renderPage();

    expect(await screen.findByText('2 de 6 pasos con datos')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '2');

    const pasos = screen.getAllByRole('listitem');
    expect(within(pasos[0]).getByText('Listo · 137 recintos')).toBeInTheDocument();
    expect(within(pasos[1]).getByText('Listo · 1 operador CDA activo')).toBeInTheDocument();
    expect(within(pasos[2]).getByText('Siguiente · 0 militares')).toBeInTheDocument();
    expect(pasos[2]).toHaveAttribute('aria-current', 'step');
    expect(within(pasos[3]).getByText('Pendiente · Ningún evento activo')).toBeInTheDocument();
    expect(within(pasos[2]).getByRole('link', { name: /Ir a Militares/ })).toHaveAttribute('href', '/militares');
  });

  it('sin evento activo no consulta asignaciones ni kits', async () => {
    mockApi({ recintos: 5, usuarios: 2, militares: 3 });
    renderPage();
    await screen.findByText('3 de 6 pasos con datos');
    const urls = apiGetMock.mock.calls.map(([u]) => u as string);
    expect(urls.some((u) => u.startsWith('/asignaciones') || u.startsWith('/kits'))).toBe(false);
  });

  it('con evento activo cuenta asignaciones y kits de ese evento', async () => {
    mockApi({ recintos: 5, usuarios: 2, militares: 3, evento: EVENTO, asignaciones: 4, kits: 0 });
    renderPage();

    expect(await screen.findByText('Listo · Elecciones Seccionales 2027')).toBeInTheDocument();
    expect(screen.getByText('Listo · 4 asignaciones en el evento activo')).toBeInTheDocument();
    expect(screen.getByText('Siguiente · 0 kits en el evento activo')).toBeInTheDocument();
    expect(apiGetMock).toHaveBeenCalledWith('/asignaciones?eventoId=ev1');
    expect(apiGetMock).toHaveBeenCalledWith('/kits?eventoId=ev1&pageSize=1');
  });

  it('con todo listo invita a pasar a Operación', async () => {
    mockApi({ recintos: 5, usuarios: 2, militares: 3, evento: EVENTO, asignaciones: 4, kits: 60 });
    renderPage();
    expect(await screen.findByText('Todos los pasos tienen datos. Puede pasar a Operación.')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '6');
    expect(screen.getAllByRole('listitem').some((li) => li.hasAttribute('aria-current'))).toBe(false);
  });

  it('anuncia la carga mientras llegan los datos', () => {
    apiGetMock.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status')).toHaveTextContent('Cargando…');
  });

  it('usa el singular cuando hay un solo elemento', async () => {
    mockApi({ recintos: 1, usuarios: 1, militares: 1 });
    renderPage();
    expect(await screen.findByText('Listo · 1 recinto')).toBeInTheDocument();
    expect(screen.getByText('Listo · 1 militar')).toBeInTheDocument();
  });

  it('cuenta solo operadores CDA activos', async () => {
    mockApi({});
    renderPage();
    await screen.findByText('0 de 6 pasos con datos');
    expect(apiGetMock).toHaveBeenCalledWith('/users?role=OPERADOR_CDA&activo=true&pageSize=1');
  });

  it('si falla la carga muestra un aviso con opción de reintentar', async () => {
    apiGetMock.mockRejectedValue(new Error('red'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar el estado de la preparación.');

    mockApi({ recintos: 1 });
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('1 de 6 pasos con datos')).toBeInTheDocument();
  });
});

describe('pasoActual', () => {
  const base = { recintos: 1, usuarios: 1, militares: 1, evento: 1, asignaciones: 1, kits: 1 };

  it('devuelve el primer paso sin datos, en el orden del flujo', () => {
    expect(pasoActual({ ...base, militares: 0, kits: 0 })).toBe('militares');
  });

  it('devuelve undefined cuando todos los pasos tienen datos', () => {
    expect(pasoActual(base)).toBeUndefined();
  });
});
