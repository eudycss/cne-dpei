import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ExportarReporteModal } from './ExportarReporteModal';
import { api } from '../../lib/api';
import { guardarArchivo } from '../../lib/queries/custodia';
import { sileo } from 'sileo';
import { hoyEcuador } from './utils';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn() } }));
vi.mock('../../lib/queries/custodia', () => ({ guardarArchivo: vi.fn() }));
vi.mock('sileo', () => ({ sileo: { error: vi.fn(), success: vi.fn() } }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;

function renderModal(reporte: 'asistencia' | 'atrasos' = 'asistencia', onClose = vi.fn()) {
  render(<ExportarReporteModal reporte={reporte} desdeInicial="2026-10-01" hastaInicial="2026-10-22" onClose={onClose} />);
  return onClose;
}

describe('ExportarReporteModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue({ data: new Blob(['x']) });
  });

  it('por defecto descarga el Excel general del rango recibido', async () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: 'Exportar asistencia' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'General' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Excel' })).toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }));

    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith(
        '/operadores-cda/asistencia/exportar.xlsx?desde=2026-10-01&hasta=2026-10-22&modo=GENERAL',
        { responseType: 'blob' },
      ),
    );
    expect(guardarArchivo).toHaveBeenCalledWith(expect.any(Blob), 'asistencia_operadores_cda_2026-10-01_2026-10-22.xlsx');
  });

  it('atrasos por día en PDF', async () => {
    renderModal('atrasos');
    await userEvent.click(screen.getByRole('radio', { name: 'Por día' }));
    await userEvent.click(screen.getByRole('radio', { name: 'PDF' }));
    await userEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));

    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith(
        '/operadores-cda/asistencia/atrasos.pdf?desde=2026-10-01&hasta=2026-10-22&modo=POR_DIA',
        { responseType: 'blob' },
      ),
    );
    expect(guardarArchivo).toHaveBeenCalledWith(expect.any(Blob), 'atrasos_operadores_cda_2026-10-01_2026-10-22_por_dia.pdf');
  });

  it('valida el rango antes de pedir: invertido o con fecha futura', async () => {
    renderModal();
    const desde = screen.getByLabelText('Desde');
    fireEvent.change(desde, { target: { value: '2026-10-25' } });
    await userEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }));
    expect(screen.getByText('La fecha inicial es posterior a la final')).toBeInTheDocument();
    expect(desde).toHaveAttribute('aria-invalid', 'true');
    expect(desde).toHaveFocus();

    fireEvent.change(desde, { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2999-01-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }));
    expect(screen.getByText('La fecha final no puede ser futura')).toBeInTheDocument();
    expect(getMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Hasta')).toHaveAttribute('max', hoyEcuador());
  });

  it('en PDF no deja más de 31 días (Excel sí)', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-09-01' } });
    await userEvent.click(screen.getByRole('radio', { name: 'PDF' }));
    await userEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
    expect(screen.getByText(/En PDF el rango máximo es de 31 días/)).toBeInTheDocument();
    expect(screen.getByLabelText('Hasta')).toHaveFocus();
    expect(getMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('radio', { name: 'Excel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }));
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
  });

  it('anuncia "Generando reporte…" mientras se descarga', async () => {
    let resolver: (v: unknown) => void = () => {};
    getMock.mockReturnValueOnce(new Promise((r) => (resolver = r)));
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Generando reporte…');
    resolver({ data: new Blob(['x']) });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(''));
  });

  it('muestra el mensaje del servidor si la descarga falla y no cierra', async () => {
    const onClose = renderModal();
    getMock.mockRejectedValueOnce({
      response: { data: new Blob([JSON.stringify({ message: 'Demasiadas solicitudes' })], { type: 'application/json' }) },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }));
    await waitFor(() => expect(sileo.error).toHaveBeenCalledWith({ title: 'Demasiadas solicitudes' }));
    expect(guardarArchivo).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cerrar y Escape cierran el diálogo', async () => {
    const onClose = renderModal();
    // La "×" de la cabecera y el botón del pie se llaman igual.
    const cerrar = screen.getAllByRole('button', { name: 'Cerrar' });
    expect(cerrar).toHaveLength(2);
    await userEvent.click(cerrar[1]);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
