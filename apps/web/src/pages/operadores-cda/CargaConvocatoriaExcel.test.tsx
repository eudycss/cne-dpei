import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CargaConvocatoriaCdaResult } from '@cne/shared-types';

import { CargaConvocatoriaExcel } from './CargaConvocatoriaExcel';
import { cargarConvocatoriaCda } from '../../lib/queries/operadores-cda';
import { sileo } from 'sileo';

vi.mock('../../lib/queries/operadores-cda', () => ({ cargarConvocatoriaCda: vi.fn(), descargarPlantillaConvocatoriaCda: vi.fn() }));
vi.mock('sileo', () => ({ sileo: { error: vi.fn(), success: vi.fn() } }));

const cargarMock = cargarConvocatoriaCda as unknown as ReturnType<typeof vi.fn>;

const previa: CargaConvocatoriaCdaResult = {
  aplicada: false,
  nuevas: 1,
  errores: 1,
  fechas: [{ fecha: '2026-11-05', convocados: 3, vinieron: 2, sinEntrada: 1 }],
  filas: [
    { fila: 2, fecha: '2026-11-05', cedula: '1000000002', apellidosNombres: 'BENÍTEZ BRUNO', estado: 'NUEVA', mensaje: null },
    { fila: 3, fecha: '2026-11-05', cedula: '1999999999', apellidosNombres: null, estado: 'ERROR', mensaje: 'No hay nadie del personal CDA/CPE con esa cédula' },
  ],
};

function montar() {
  const qc = new QueryClient();
  const invalidar = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <CargaConvocatoriaExcel fecha="2026-11-05" />
    </QueryClientProvider>,
  );
  return { invalidar };
}

describe('CargaConvocatoriaExcel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cargarMock.mockImplementation((_f: File, _d: string, aplicar: boolean) => Promise.resolve({ ...previa, aplicada: aplicar }));
  });

  it('muestra la vista previa (errores arriba y cómo queda cada día) y solo guarda al confirmar', async () => {
    const { invalidar } = montar();
    const archivo = new File(['Fecha,Cédula\n05/11/2026,1000000002\n'], 'conv.csv', { type: 'text/csv' });
    await userEvent.upload(screen.getByLabelText('Archivo Excel de la convocatoria'), archivo);

    const dialogo = await screen.findByRole('dialog', { name: 'Revisar convocatoria antes de guardar' });
    expect(cargarMock).toHaveBeenCalledWith(archivo, '2026-11-05', false);
    expect(within(dialogo).getByRole('status')).toHaveTextContent('Se convocará a 1 persona. 1 fila con error no se cargará.');
    const [dias, detalle] = within(dialogo).getAllByRole('table');
    expect(within(dias).getByRole('rowheader', { name: '05/11/2026' }).closest('tr')).toHaveTextContent('05/11/2026321');
    const filas = within(detalle).getAllByRole('row').slice(1);
    expect(within(filas[0]).getByText('Error')).toBeInTheDocument();
    expect(within(filas[1]).getByText('Se convoca')).toBeInTheDocument();

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Convocar a 1' }));
    await waitFor(() => expect(cargarMock).toHaveBeenLastCalledWith(archivo, '2026-11-05', true));
    expect(sileo.success).toHaveBeenCalledWith(expect.objectContaining({ title: '1 persona convocada' }));
    expect(invalidar).toHaveBeenCalledWith({ queryKey: ['atrasos-cda'] });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('si el archivo no se puede leer, muestra el mensaje y no abre la vista previa', async () => {
    cargarMock.mockRejectedValueOnce({ response: { data: { message: 'Use la plantilla en Excel (.xlsx) o un archivo .csv' } } });
    montar();
    await userEvent.upload(screen.getByLabelText('Archivo Excel de la convocatoria'), new File(['x'], 'conv.csv', { type: 'text/csv' }));
    await waitFor(() => expect(sileo.error).toHaveBeenCalledWith({ title: 'Use la plantilla en Excel (.xlsx) o un archivo .csv' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
