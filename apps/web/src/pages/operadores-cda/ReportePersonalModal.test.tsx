import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CargoCda } from '@cne/shared-types';

import { ReportePersonalModal } from './ReportePersonalModal';
import { api } from '../../lib/api';
import { guardarArchivo } from '../../lib/queries/custodia';
import { hoyEcuador } from './utils';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn() } }));
vi.mock('../../lib/queries/custodia', () => ({ guardarArchivo: vi.fn() }));
vi.mock('sileo', () => ({ sileo: { error: vi.fn(), success: vi.fn() } }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;

const cargo = (clave: string, nombre: string, centro: 'CDA' | 'CPE', orden: number, over: Partial<CargoCda> = {}): CargoCda => ({
  clave,
  nombre,
  centro,
  activo: true,
  protegido: false,
  orden,
  personas: 3,
  ...over,
});

const CARGOS = [
  cargo('OPERADOR', 'Operadores CDA', 'CDA', 1),
  cargo('ASISTENTE', 'Asistentes CDA', 'CDA', 2),
  cargo('DIGITADOR', 'Digitadores', 'CPE', 3, { personas: 1 }),
  cargo('VIEJO', 'Cargo retirado', 'CPE', 4, { activo: false }),
];

function renderModal(grupoInicial = 'OPERADOR') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReportePersonalModal grupoInicial={grupoInicial} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('ReportePersonalModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockImplementation((url: string) =>
      Promise.resolve({ data: url === '/cargos-cda' ? CARGOS : new Blob(['x']) }),
    );
  });

  it('empieza con el centro y el cargo que se estaban viendo y descarga el Excel general', async () => {
    renderModal();
    expect(await screen.findByRole('checkbox', { name: 'Operadores CDA' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'CDA' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'CPE' })).not.toBeChecked();
    // Solo los cargos del centro marcado.
    expect(screen.queryByRole('checkbox', { name: /Digitadores/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }));

    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith('/operadores-cda/reporte-personal.xlsx?cargos=OPERADOR&modo=GENERAL', {
        responseType: 'blob',
      }),
    );
    expect(guardarArchivo).toHaveBeenCalledWith(expect.any(Blob), `personal_cda_${hoyEcuador()}.xlsx`);
  });

  it('CDA y CPE con "Todos los cargos", por cargo en PDF; no ofrece cargos desactivados', async () => {
    renderModal();
    await screen.findByRole('checkbox', { name: 'CPE' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'CPE' }));
    expect(screen.queryByRole('checkbox', { name: /Cargo retirado/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Todos los cargos' }));
    expect(screen.getByRole('checkbox', { name: 'Digitadores', description: 'CPE · 1 persona' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Por cargo' }));
    await userEvent.click(screen.getByRole('radio', { name: 'PDF' }));
    await userEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));

    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith(
        '/operadores-cda/reporte-personal.pdf?cargos=OPERADOR&cargos=ASISTENTE&cargos=DIGITADOR&modo=POR_CARGO',
        { responseType: 'blob' },
      ),
    );
    expect(guardarArchivo).toHaveBeenCalledWith(expect.any(Blob), `personal_cda_cpe_por_cargo_${hoyEcuador()}.pdf`);
  });

  it('al quitar un centro se quitan sus cargos; sin cargos avisa y no descarga', async () => {
    renderModal();
    await screen.findByRole('checkbox', { name: 'CDA' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'CDA' }));
    await userEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Elija CDA, CPE o ambos.');
    expect(screen.getByRole('alert')).toHaveFocus();

    await userEvent.click(screen.getByRole('checkbox', { name: 'CDA' }));
    expect(screen.getByRole('checkbox', { name: /Operadores CDA/ })).not.toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Elija al menos un cargo.');
    expect(getMock).not.toHaveBeenCalledWith(expect.stringContaining('reporte-personal'), expect.anything());
  });

  it('"Todos los cargos" queda a medio marcar con selección parcial; marcado, se desmarca y deja ninguno', async () => {
    renderModal();
    const todos = (await screen.findByRole('checkbox', { name: 'Todos los cargos' })) as HTMLInputElement;
    expect(todos.indeterminate).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent('2 cargos para elegir, 1 marcado');
    await userEvent.click(todos);
    expect(todos).toBeChecked();
    expect(todos.indeterminate).toBe(false);
    await userEvent.click(todos);
    expect(screen.getByRole('checkbox', { name: 'Operadores CDA' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Asistentes CDA' })).not.toBeChecked();
  });

  it('con un solo cargo activo en el centro no ofrece "Todos los cargos"', async () => {
    renderModal('DIGITADOR');
    expect(await screen.findByRole('checkbox', { name: 'Digitadores' })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Todos los cargos' })).not.toBeInTheDocument();
  });
});
