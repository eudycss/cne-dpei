import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReporteFlujoItem, ReporteNoCdaItem } from '@cne/shared-types';

import { ReporteNoCdaPage } from './ReporteNoCdaPage';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn() },
}));

const aoaToSheet = vi.fn(() => ({}));
const bookNew = vi.fn(() => ({}));
const bookAppendSheet = vi.fn();
const writeFile = vi.fn();

vi.mock('xlsx', () => ({
  utils: {
    aoa_to_sheet: (...args: any[]) => aoaToSheet(...args),
    book_new: (...args: any[]) => bookNew(...args),
    book_append_sheet: (...args: any[]) => bookAppendSheet(...args),
  },
  writeFile: (...args: any[]) => writeFile(...args),
}));

const apiGetMock = api.get as unknown as ReturnType<typeof vi.fn>;

const flujoItem: ReporteFlujoItem = {
  cdaId: 'c1',
  cdaCodigo: 'C001',
  cdaNombre: 'Escuela Central',
  operadorNombre: 'Juan Pérez',
  operadorCedula: '1234567890',
  kitsCodigos: ['KIT-001'],
  salidaDpiEn: '2026-06-23T08:00:00.000Z',
  llegadaRecintoEn: null,
  salidaRecintoEn: null,
  llegadaDpiEn: null,
};

const noCdaItem: ReporteNoCdaItem = {
  cdaId: 'c1',
  cdaCodigo: 'C001',
  cdaNombre: 'Escuela Central',
  operadorNombre: 'Juan Pérez',
  operadorCedula: '1234567890',
  kitsCodigos: ['KIT-001'],
  totalNoCdas: 2,
  totalLlegados: 1,
  noCdas: [
    { id: 'nc1', codigoRecinto: 'NC01', nombre: 'Anexo 1', llegado: true },
    { id: 'nc2', codigoRecinto: 'NC02', nombre: 'Anexo 2', llegado: false },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ReporteNoCdaPage />
    </QueryClientProvider>,
  );
}

describe('ReporteNoCdaPage — exportar a Excel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/tracking/reporte-flujo') return Promise.resolve({ data: [flujoItem] });
      if (url === '/tracking/reporte-no-cda') return Promise.resolve({ data: [noCdaItem] });
      return Promise.resolve({ data: [] });
    });
  });

  it('el botón Excel está deshabilitado sin datos y habilitado con datos', async () => {
    apiGetMock.mockResolvedValue({ data: [] });
    renderPage();

    const boton = await screen.findByTitle('Exportar a Excel');
    expect(boton).toBeDisabled();
  });

  it('exporta la vista de flujo con las columnas esperadas', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Juan Pérez');
    const boton = await screen.findByTitle('Exportar a Excel');
    expect(boton).toBeEnabled();

    await user.click(boton);

    expect(aoaToSheet).toHaveBeenCalledTimes(1);
    const rows = aoaToSheet.mock.calls[0][0];
    expect(rows[2]).toEqual([
      'Operador',
      'Cédula',
      'CDA',
      'Kit(s)',
      'Salida DPI',
      'Llegada Recinto',
      'Salida Recinto',
      'Llegada DPI',
    ]);
    expect(rows[3][0]).toBe('Juan Pérez');
    expect(rows[3][4]).not.toBe('Pendiente'); // salidaDpiEn tiene valor
    expect(rows[3][5]).toBe('Pendiente'); // llegadaRecintoEn es null
    expect(writeFile).toHaveBeenCalledWith(expect.anything(), 'reporte_flujo_cdas.xlsx');
  });

  it('exporta la vista de NO-CDAs con las columnas esperadas', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Juan Pérez');
    await user.click(screen.getByText('CDAs con sus NO-CDAs'));
    await screen.findByText(/NC01/);
    const boton = await screen.findByTitle('Exportar a Excel');
    expect(boton).toBeEnabled();
    await user.click(boton);

    expect(aoaToSheet).toHaveBeenCalledTimes(1);
    const rows = aoaToSheet.mock.calls[0][0];
    expect(rows[2]).toEqual(['Operador', 'Cédula', 'CDA', 'Kit(s)', 'Llegados', 'Faltan', 'NO-CDAs']);
    expect(rows[3][4]).toBe(1); // totalLlegados
    expect(rows[3][5]).toBe(1); // faltan = totalNoCdas - totalLlegados
    expect(rows[3][6]).toContain('NC01');
    expect(rows[3][6]).toContain('NC02');
    expect(writeFile).toHaveBeenCalledWith(expect.anything(), 'reporte_cdas_nocdas.xlsx');
  });
});
