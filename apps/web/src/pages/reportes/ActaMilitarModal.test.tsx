import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'yo', roles: ['ASISTENTE_TRANSVERSAL'] } }) }));
vi.mock('../../lib/queries/custodia', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/queries/custodia')>();
  return { ...real, guardarArchivo: vi.fn() };
});

import { api } from '../../lib/api';
import { ActaMilitarModal } from './ActaMilitarModal';

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;

function renderModal(responsables: { id: string; nombre: string; cedula: string }[]) {
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
  beforeEach(() => vi.clearAllMocks());

  it('sin Jairo Leal entre los activos, propone a quien descarga', async () => {
    renderModal([
      { id: 'otro', nombre: 'Carlos Cañares Diaz', cedula: '1' },
      { id: 'yo', nombre: 'Sebastian Cabascango', cedula: '2' },
    ]);
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Responsable (Asistente Transversal)' })).toHaveValue('yo'));
  });

  it('sin fecha avisa y no descarga', async () => {
    renderModal([{ id: 'jl', nombre: 'Jairo Leal Aviles', cedula: '2' }]);
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
