import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { OperadoresCdaPage } from './OperadoresCdaPage';
import { api } from '../../lib/api';
import { hoyEcuador, horaEcuador } from './utils';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { roles: ['ADMINISTRADOR'] } }) }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;

function renderPagina(ruta = '/operadores-cda') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <OperadoresCdaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OperadoresCdaPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockImplementation((url: string) =>
      Promise.resolve({ data: url.startsWith('/operadores-cda/asistencia') ? { fecha: '2026-10-22', esHoy: true, filas: [] } : [] }),
    );
  });

  it('abre en Asistencia y cambia de pestaña con clic o con las flechas', async () => {
    renderPagina();
    const asistencia = screen.getByRole('tab', { name: 'Asistencia' });
    expect(asistencia).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText(/Impórtelos desde la pestaña Listado/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Listado' }));
    expect(screen.getByRole('tab', { name: 'Listado' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('Aún no hay operadores registrados.')).toBeInTheDocument();

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Asistencia' })).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'pestana-asistencia');
  });

  it('?tab=listado abre directo el listado', async () => {
    renderPagina('/operadores-cda?tab=listado');
    expect(screen.getByRole('tab', { name: 'Listado' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('button', { name: 'Importar Excel' })).toBeInTheDocument();
  });
});

describe('utils de fecha (hora de Ecuador)', () => {
  it('a las 19:30 de Ecuador sigue siendo el mismo día aunque en UTC ya sea mañana', () => {
    expect(hoyEcuador(new Date('2026-10-23T00:30:00Z'))).toBe('2026-10-22');
    expect(horaEcuador('2026-10-23T00:30:00Z')).toBe('19:30');
    // Medianoche de Ecuador: 00:05, nunca "24:05".
    expect(horaEcuador('2026-10-23T05:05:00Z')).toBe('00:05');
  });
});
