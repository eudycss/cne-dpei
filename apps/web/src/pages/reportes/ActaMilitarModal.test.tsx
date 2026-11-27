import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));
let roles = ['ASISTENTE_TRANSVERSAL'];
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'yo', roles } }) }));
vi.mock('../../lib/queries/custodia', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/queries/custodia')>();
  return { ...real, guardarArchivo: vi.fn() };
});

import { api } from '../../lib/api';
import { ActaMilitarModal } from './ActaMilitarModal';

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;

function renderModal(responsables: { id: string; nombre: string }[]) {
  getMock.mockImplementation((url: string) =>
    Promise.resolve({ data: url === '/custodia/responsables-acta' ? responsables : new Blob(['%PDF']) }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ActaMilitarModal kits={[{ kitId: 'k1', codigoUnico: 'ABCD2345' }]} onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('ActaMilitarModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roles = ['ASISTENTE_TRANSVERSAL'];
  });

  it('un Lector no elige responsable: no pide la lista y descarga sin responsableId', async () => {
    roles = ['LECTOR'];
    renderModal([{ id: 'jl', nombre: 'Jairo Leal Aviles' }]);
    expect(screen.queryByRole('combobox', { name: /Responsable/ })).not.toBeInTheDocument();
    expect(screen.getByText('Responsable: el Asistente Transversal que registró la entrega del kit.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith('/custodia/kits/k1/acta-militar', {
        params: { formato: 'pdf', fecha: '2026-11-28' },
        responseType: 'blob',
      }),
    );
    expect(getMock).not.toHaveBeenCalledWith('/custodia/responsables-acta');
  });

  it('sin Jairo Leal entre los activos, propone a quien descarga', async () => {
    renderModal([
      { id: 'otro', nombre: 'Carlos Cañares Diaz' },
      { id: 'yo', nombre: 'Sebastian Cabascango' },
    ]);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Responsable (Asistente Transversal)' })).toHaveValue('yo'));
  });

  it('sin fecha avisa y no descarga', async () => {
    renderModal([{ id: 'jl', nombre: 'Jairo Leal Aviles' }]);
    await waitFor(() => expect(screen.getByRole('combobox', { name: /Responsable/ })).toHaveValue('jl'));
    fireEvent.change(screen.getByLabelText('Fecha del acta'), { target: { value: '' } });
    await userEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Elija la fecha del acta.');
    const campo = screen.getByLabelText('Fecha del acta');
    expect(campo).toHaveFocus();
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(campo).toHaveAccessibleDescription('Elija la fecha del acta.');
    expect(getMock).not.toHaveBeenCalledWith('/custodia/kits/k1/acta-militar', expect.anything());
  });

  it('sin Asistentes Transversales activos no deja descargar', async () => {
    renderModal([]);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Sin Asistentes Transversales activos' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Descargar PDF' })).toBeDisabled();
  });
});
