import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FilaInformeCustodia } from '@cne/shared-types';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));
vi.mock('xlsx', () => ({
  utils: { aoa_to_sheet: vi.fn(() => ({})), book_new: vi.fn(() => ({})), book_append_sheet: vi.fn() },
  writeFile: vi.fn(),
}));
vi.mock('../../lib/queries/custodia', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/queries/custodia')>();
  return { ...real, guardarArchivo: vi.fn() };
});

import * as XLSX from 'xlsx';
import { api } from '../../lib/api';
import { guardarArchivo } from '../../lib/queries/custodia';
import { CadenaCustodiaPage } from './CadenaCustodiaPage';

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;

function fila(o: Partial<FilaInformeCustodia> = {}): FilaInformeCustodia {
  return {
    kitId: 'k1',
    codigoUnico: 'ABCD2345',
    recintoId: 'r1',
    recintoCodigo: '28',
    recintoNombre: 'Escuela Central',
    cantonId: 30,
    cantonNombre: 'IBARRA',
    operadorNombre: 'Pérez Ana',
    operadorCedula: '1002003004',
    entrega: {
      militarNombre: 'Paz Juan',
      militarCedula: '1004005006',
      entregadoEn: '2026-11-16T11:00:00.000Z',
      entregadoPorNombre: 'Leal Jairo',
      militarDeOtroRecinto: true,
    },
    recepcion: { confirmadoEn: '2026-11-16T13:00:00.000Z', tieneFoto: true },
    devolucion: {
      confirmadoEn: '2026-11-16T23:00:00.000Z',
      verificadoPorNombre: 'Leal Jairo',
      completo: false,
      observaciones: 'Falta cargador',
    },
    correcciones: 1,
    ...o,
  };
}

const filas = [
  fila(),
  fila({
    kitId: 'k2',
    codigoUnico: 'WXYZ6789',
    recintoId: 'r2',
    recintoCodigo: '35',
    recintoNombre: 'Colegio Otavalo',
    cantonId: 35,
    cantonNombre: 'OTAVALO',
    entrega: null,
    recepcion: null,
    devolucion: null,
    correcciones: 0,
  }),
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CadenaCustodiaPage />
    </QueryClientProvider>,
  );
}

describe('CadenaCustodiaPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockImplementation((url: string) =>
      url === '/custodia/informe' ? Promise.resolve({ data: filas }) : Promise.resolve({ data: new Blob(['%PDF']) }),
    );
  });

  it('muestra cada kit con sus tres etapas, pendientes y avisos', async () => {
    renderPage();
    const tabla = await screen.findByRole('table');
    const [, kit1, kit2] = within(tabla).getAllByRole('row');

    expect(within(kit1).getByRole('rowheader')).toHaveTextContent('ABCD2345');
    expect(kit1).toHaveTextContent('1 corrección');
    expect(kit1).toHaveTextContent('Paz Juan · registró Leal Jairo');
    expect(kit1).toHaveTextContent('Militar de otro recinto');
    expect(kit1).toHaveTextContent('Contenido incompleto');
    expect(within(kit2).getAllByText('✗ Pendiente')).toHaveLength(3);
    expect(screen.getByText(/Entregados al militar:/).parentElement).toHaveTextContent('1');
  });

  it('filtra por cantón y por estado de la cadena', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('ABCD2345');

    await user.selectOptions(screen.getByLabelText('Cantón'), '35');
    expect(screen.queryByText('ABCD2345')).not.toBeInTheDocument();
    expect(screen.getByText('WXYZ6789')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Cantón'), '');
    // ABCD2345 tiene las tres etapas; WXYZ6789 ninguna.
    await user.selectOptions(screen.getByLabelText('Estado'), 'PENDIENTES');
    expect(screen.queryByText('ABCD2345')).not.toBeInTheDocument();
    expect(screen.getByText('WXYZ6789')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Estado'), 'COMPLETOS');
    expect(screen.getByText('ABCD2345')).toBeInTheDocument();
    expect(screen.queryByText('WXYZ6789')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Cantón'), '35');
    expect(screen.getByText('No hay kits para los filtros elegidos.')).toBeInTheDocument();
  });

  it('descarga el acta de un kit y todas las actas con los filtros elegidos', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('ABCD2345');

    await user.click(screen.getByRole('button', { name: 'Descargar acta del kit ABCD2345' }));
    await waitFor(() => expect(guardarArchivo).toHaveBeenCalledWith(expect.any(Blob), 'acta_ABCD2345.pdf'));
    expect(getMock).toHaveBeenCalledWith('/custodia/kits/k1/acta', { responseType: 'blob' });

    await user.selectOptions(screen.getByLabelText('Cantón'), '30');
    await user.click(screen.getByRole('button', { name: 'Actas PDF' }));
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith('/custodia/actas', { params: { cantonId: '30' }, responseType: 'blob' }),
    );
  });

  it('exporta a Excel solo las filas visibles', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('ABCD2345');
    await user.selectOptions(screen.getByLabelText('Cantón'), '30');
    await user.click(screen.getByRole('button', { name: 'Excel' }));

    const filasExcel = (XLSX.utils.aoa_to_sheet as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as unknown[][];
    expect(filasExcel.slice(3)).toHaveLength(1);
    expect(filasExcel[3][0]).toBe('ABCD2345');
    expect(XLSX.writeFile).toHaveBeenCalledWith(expect.anything(), 'cadena_custodia_kits.xlsx');
  });

  it('distingue "no hay evento activo" (404) de un error de conexión', async () => {
    getMock.mockRejectedValueOnce({ response: { status: 404 } });
    const { unmount } = renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('No hay un evento electoral activo.');
    unmount();

    getMock.mockRejectedValueOnce(new Error('Network Error'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Revisa la conexión');
  });

  it('si el servidor rechaza las actas (p. ej. demasiadas), muestra su mensaje', async () => {
    const { sileo } = await import('sileo');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('ABCD2345');
    getMock.mockRejectedValueOnce({
      response: { data: new Blob([JSON.stringify({ message: 'Son 120 actas; filtra por cantón' })]) },
    });
    await user.click(screen.getByRole('button', { name: 'Actas PDF' }));
    await waitFor(() => expect(sileo.error).toHaveBeenCalledWith({ title: 'Son 120 actas; filtra por cantón' }));
  });
});
