import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Militar } from '@cne/shared-types';

import { MilitaresPage } from './MilitaresPage';
import { AuthProvider } from '../../auth/AuthContext';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const patchMock = api.patch as unknown as ReturnType<typeof vi.fn>;

const RECINTO_ID = '44444444-4444-4444-8444-444444444444';

const militar: Militar = {
  id: '77777777-7777-4777-8777-777777777777',
  cedula: '1003199443',
  nombres: 'Christian Becker',
  apellidos: 'Herrera Cadena',
  grado: 'CBOP',
  recintoId: RECINTO_ID,
  recintoNombre: 'Unidad Educativa Víctor Manuel Guzmán',
  recintoCodigo: '1359',
  creadoEn: '2026-11-26T10:00:00Z',
};

function renderPage() {
  localStorage.setItem(
    'cne.user',
    JSON.stringify({ id: 'u1', email: 'a@cne.gob.ec', nombres: 'A', apellidos: 'B', debeCambiarPwd: false, roles: ['ADMINISTRADOR'] }),
  );
  return render(
    <AuthProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <MilitaresPage />
        </MemoryRouter>
      </QueryClientProvider>
    </AuthProvider>,
  );
}

describe('MilitaresPage — grado', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    getMock.mockImplementation((url: string) => {
      if (url.startsWith('/militares')) {
        return Promise.resolve({ data: { items: [militar, { ...militar, id: 'm2', cedula: '1034567899', grado: null }], total: 2, page: 1, pageSize: 20 } });
      }
      if (url.startsWith('/recintos')) {
        return Promise.resolve({ data: { items: [{ id: RECINTO_ID, nombre: militar.recintoNombre, codigoRecinto: '1359' }], total: 1, page: 1, pageSize: 200 } });
      }
      return Promise.reject(new Error(`sin mock: ${url}`));
    });
    patchMock.mockResolvedValue({ data: militar });
  });

  it('muestra la columna Grado, con guion cuando no hay grado', async () => {
    renderPage();
    expect(await screen.findByRole('columnheader', { name: 'Grado' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'CBOP' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '—' })).toBeInTheDocument();
  });

  it('al editar envía el grado normalizado', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click((await screen.findAllByRole('button', { name: 'Editar' }))[0]);

    const grado = screen.getByLabelText('Grado');
    expect(grado).toHaveValue('CBOP');
    await user.clear(grado);
    await user.type(grado, 'sgop.');
    await user.click(screen.getByRole('button', { name: /guardar/i }));

    await waitFor(() => expect(patchMock).toHaveBeenCalled());
    expect(patchMock.mock.calls[0][0]).toBe(`/militares/${militar.id}`);
    expect(patchMock.mock.calls[0][1]).toMatchObject({ grado: 'SGOP' });
  });
});
