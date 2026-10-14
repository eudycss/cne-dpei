import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EstadisticasEnlacesResponse } from '@cne/shared-types';

import {
  desplazarFecha,
  EstadisticasEnlaces,
  formatearDuracion,
  hoyEcuador,
  rotuloPeriodo,
} from './EstadisticasEnlaces';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));
const writeFile = vi.fn();
vi.mock('xlsx', async (original) => ({ ...(await original<typeof import('xlsx')>()), writeFile: (...a: unknown[]) => writeFile(...a) }));

const apiGet = api.get as unknown as ReturnType<typeof vi.fn>;

const stats = (over: Partial<EstadisticasEnlacesResponse> = {}): EstadisticasEnlacesResponse => ({
  periodo: 'dia',
  desde: '2026-10-14T05:00:00.000Z',
  hasta: '2026-10-15T05:00:00.000Z',
  historialDesde: '2026-10-01T05:00:00.000Z',
  datosParciales: false,
  totalRecintos: 3,
  ranking: [
    { codigoRecinto: '1207', nombreRecinto: 'Escuela Guallupe', canton: 'Cotacachi', caidas: 2, minutosCaido: 75, disponibilidad: 94.8, sigueCaido: true },
  ],
  sinCaidas: [
    { codigoRecinto: '28', nombreRecinto: 'UE Ibarra', canton: 'Ibarra' },
    { codigoRecinto: '96', nombreRecinto: 'UE Sánchez y Cifuentes', canton: 'Ibarra' },
  ],
  ...over,
});

function renderVista() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EstadisticasEnlaces />
    </QueryClientProvider>,
  );
}

describe('ayudantes de estadísticas', () => {
  it('desplazarFecha mueve días, semanas y meses', () => {
    expect(desplazarFecha('2026-10-14', 'dia', -1)).toBe('2026-10-13');
    expect(desplazarFecha('2026-10-14', 'semana', 1)).toBe('2026-10-21');
    expect(desplazarFecha('2026-01-31', 'mes', -1)).toBe('2025-12-01');
  });

  it('hoyEcuador usa la hora de Ecuador (23:00 del 14 en Ecuador = 04:00 UTC del 15)', () => {
    expect(hoyEcuador(Date.parse('2026-10-15T04:00:00Z'))).toBe('2026-10-14');
  });

  it('formatearDuracion', () => {
    expect(formatearDuracion(45)).toBe('45 min');
    expect(formatearDuracion(75)).toBe('1 h 15 min');
    expect(formatearDuracion(3000)).toBe('2 d 2 h');
  });

  it('rotuloPeriodo para semana y mes', () => {
    expect(
      rotuloPeriodo({ periodo: 'semana', desde: '2026-10-12T05:00:00.000Z', hasta: '2026-10-19T05:00:00.000Z' }),
    ).toBe('del 12/10 al 18/10/2026');
    expect(rotuloPeriodo({ periodo: 'mes', desde: '2026-10-01T05:00:00.000Z', hasta: '2026-11-01T05:00:00.000Z' })).toMatch(
      /octubre de 2026/,
    );
  });
});

describe('EstadisticasEnlaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGet.mockResolvedValue({ data: stats() });
  });

  it('muestra el ranking con caídas, tiempo y disponibilidad, y los que no se cayeron', async () => {
    const user = userEvent.setup();
    renderVista();

    const fila = (await screen.findByText('Escuela Guallupe')).closest('tr')!;
    expect(within(fila).getByText('(sigue caído)')).toBeInTheDocument();
    expect(within(fila).getByText('1 h 15 min')).toBeInTheDocument();
    expect(within(fila).getByText('94.8 %')).toBeInTheDocument();
    expect(screen.getByText(/2 caídas en 1 recinto · 2 de 3 sin caídas/)).toBeInTheDocument();

    await user.click(screen.getByText('Nunca se cayeron en este período (2)'));
    expect(screen.getByText(/UE Ibarra/)).toBeInTheDocument();
  });

  it('pide el día de hoy al abrir y cambia de período y fecha con los botones', async () => {
    const user = userEvent.setup();
    renderVista();
    await screen.findByText('Escuela Guallupe');
    expect(apiGet).toHaveBeenCalledWith('/enlaces/estadisticas', { params: { periodo: 'dia', fecha: hoyEcuador() } });

    await user.click(screen.getByRole('button', { name: 'Mes' }));
    expect(apiGet).toHaveBeenLastCalledWith('/enlaces/estadisticas', { params: { periodo: 'mes', fecha: hoyEcuador() } });

    await user.click(screen.getByRole('button', { name: 'Período anterior' }));
    expect(apiGet).toHaveBeenLastCalledWith('/enlaces/estadisticas', {
      params: { periodo: 'mes', fecha: desplazarFecha(hoyEcuador(), 'mes', -1) },
    });
    expect(screen.getByRole('button', { name: 'Hoy' })).toBeInTheDocument();
  });

  it('no deja avanzar a un período que todavía no empieza', async () => {
    apiGet.mockResolvedValue({ data: stats({ hasta: new Date(Date.now() + 3_600_000).toISOString() }) });
    renderVista();
    await screen.findByText('Escuela Guallupe');

    expect(screen.getByRole('button', { name: 'Período siguiente' })).toBeDisabled();
  });

  it('avisa cuando el período tiene datos parciales', async () => {
    apiGet.mockResolvedValue({ data: stats({ datosParciales: true }) });
    renderVista();

    expect(await screen.findByText(/este período está incompleto/)).toBeInTheDocument();
  });

  it('sin caídas muestra un mensaje en vez de la tabla', async () => {
    apiGet.mockResolvedValue({ data: stats({ ranking: [] }) });
    renderVista();

    expect(await screen.findByText('Ningún enlace se cayó en este período.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('exporta a Excel con el período en el nombre del archivo', async () => {
    const user = userEvent.setup();
    renderVista();
    await screen.findByText('Escuela Guallupe');

    await user.click(screen.getByRole('button', { name: 'Exportar Excel' }));

    expect(writeFile).toHaveBeenCalledWith(expect.anything(), 'estadisticas_enlaces_dia_2026-10-14.xlsx');
  });

  it('si la API falla, lo dice', async () => {
    apiGet.mockRejectedValue(new Error('500'));
    renderVista();

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar las estadísticas.');
  });
});
