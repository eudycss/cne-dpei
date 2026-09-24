import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NotificacionItem } from '@cne/shared-types';

import { NotificationsBell } from './NotificationsBell';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: { get: vi.fn(), patch: vi.fn() },
}));

const apiGetMock = api.get as unknown as ReturnType<typeof vi.fn>;
const apiPatchMock = api.patch as unknown as ReturnType<typeof vi.fn>;

function item(id: string, creadoEn: string): NotificacionItem {
  return {
    id,
    tipoEvento: 'SALIDA_DPI',
    canal: 'PUSH',
    payload: {},
    creadoEn,
    leidaEn: null,
  };
}

function renderBell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NotificationsBell />
    </QueryClientProvider>,
  );
}

describe('NotificationsBell — paginación', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('muestra "Cargar más" cuando hay más notificaciones que las cargadas, y las agrega al hacer clic', async () => {
    const user = userEvent.setup();

    apiGetMock.mockImplementation((url: string) => {
      if (url.includes('page=2')) {
        return Promise.resolve({
          data: { items: [item('n10', '2026-09-01T10:00:00.000Z')], total: 15, noLeidas: 15 },
        });
      }
      return Promise.resolve({
        data: {
          items: Array.from({ length: 10 }, (_, i) => item(`n${i}`, '2026-09-08T10:00:00.000Z')),
          total: 15,
          noLeidas: 15,
        },
      });
    });

    renderBell();

    await user.click(screen.getByLabelText('Notificaciones'));
    const boton = await screen.findByText('Cargar más');
    expect(screen.getAllByRole('listitem')).toHaveLength(10);

    await user.click(boton);

    expect(apiGetMock).toHaveBeenCalledWith(expect.stringContaining('page=2'));
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(11);
    });
  });

  it('marcar una notificación como leída no descarta las páginas ya cargadas con "Cargar más"', async () => {
    const user = userEvent.setup();
    apiPatchMock.mockResolvedValue({ data: undefined });

    apiGetMock.mockImplementation((url: string) => {
      if (url.includes('page=2')) {
        return Promise.resolve({
          data: { items: [item('n10', '2026-09-01T10:00:00.000Z')], total: 11, noLeidas: 11 },
        });
      }
      return Promise.resolve({
        data: {
          items: Array.from({ length: 10 }, (_, i) => item(`n${i}`, '2026-09-08T10:00:00.000Z')),
          total: 11,
          noLeidas: 11,
        },
      });
    });

    renderBell();

    await user.click(screen.getByLabelText('Notificaciones'));
    const boton = await screen.findByText('Cargar más');
    await user.click(boton);
    await waitFor(() => {
      expect(screen.getAllByRole('listitem')).toHaveLength(11);
    });

    await user.click(screen.getAllByRole('listitem')[0]);

    expect(apiPatchMock).toHaveBeenCalledWith(expect.stringContaining('n0'));
    // La lista sigue teniendo las 11 notificaciones cargadas (no se resetea a la primera página).
    expect(screen.getAllByRole('listitem')).toHaveLength(11);
    expect(await screen.findByText('10 sin leer')).toBeInTheDocument();
  });

  it('si "Cargar más" falla, el botón vuelve a estado habilitado en vez de quedarse cargando', async () => {
    const user = userEvent.setup();
    apiGetMock.mockImplementation((url: string) => {
      if (url.includes('page=2')) return Promise.reject(new Error('network error'));
      return Promise.resolve({
        data: {
          items: Array.from({ length: 10 }, (_, i) => item(`n${i}`, '2026-09-08T10:00:00.000Z')),
          total: 15,
          noLeidas: 15,
        },
      });
    });

    renderBell();

    await user.click(screen.getByLabelText('Notificaciones'));
    const boton = await screen.findByText('Cargar más');
    await user.click(boton);

    await waitFor(() => {
      const botonDeNuevo = screen.getByText('Cargar más');
      expect(botonDeNuevo.closest('button')).not.toBeDisabled();
    });
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
  });

  it('no muestra "Cargar más" cuando ya se cargaron todas las notificaciones', async () => {
    const user = userEvent.setup();
    apiGetMock.mockResolvedValue({
      data: { items: [item('n1', '2026-09-08T10:00:00.000Z')], total: 1, noLeidas: 1 },
    });

    renderBell();

    await user.click(screen.getByLabelText('Notificaciones'));
    await screen.findByText('1 sin leer');

    expect(screen.queryByText('Cargar más')).not.toBeInTheDocument();
  });
});
