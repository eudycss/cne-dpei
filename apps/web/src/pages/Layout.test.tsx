import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { RoleName } from '@cne/shared-types';

import { AuthProvider } from '../auth/AuthContext';
import { Layout } from './Layout';
import { api } from '../lib/api';
import { sileo } from 'sileo';

vi.mock('../lib/api', () => ({
  api: { post: vi.fn(), get: vi.fn(), patch: vi.fn() },
  tokenStore: { set: vi.fn(), clear: vi.fn() },
}));

vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));

vi.mock('../components/NotificationsBell', () => ({
  NotificationsBell: () => <div>campanita</div>,
}));

const apiGetMock = api.get as unknown as ReturnType<typeof vi.fn>;
const apiPatchMock = api.patch as unknown as ReturnType<typeof vi.fn>;
const sileoErrorMock = sileo.error as unknown as ReturnType<typeof vi.fn>;

const USER_KEY = 'cne.user';

function setSessionUser(roles: RoleName[]) {
  localStorage.setItem(
    USER_KEY,
    JSON.stringify({
      id: 'u1',
      email: 'user@cne-imbabura.gob.ec',
      nombres: 'Test',
      apellidos: 'User',
      debeCambiarPwd: false,
      roles,
    }),
  );
}

function renderLayout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<Layout />}>
              <Route index element={<div>contenido</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function enlaceCaidoItem(id = 'n1', codigo = '978') {
  return {
    id,
    tipoEvento: 'ENLACE_CAIDO',
    canal: 'PUSH' as const,
    payload: { codigoRecinto: codigo, nombreRecinto: 'Escuela Central' },
    creadoEn: '2026-09-23T11:00:00.000Z',
    leidaEn: null,
  };
}

describe('Layout — visibilidad del menú lateral por rol', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    apiGetMock.mockResolvedValue({ data: { items: [], total: 0, noLeidas: 0 } });
  });

  it('LECTOR no ve el link "Alertas" (fuera de su alcance) pero sí ve "Reportes"', () => {
    setSessionUser(['LECTOR']);
    renderLayout();
    expect(screen.queryByText('Alertas')).not.toBeInTheDocument();
    expect(screen.getByText('Reportes')).toBeInTheDocument();
  });

  it('ADMINISTRADOR ve tanto "Alertas" como "Reportes"', () => {
    setSessionUser(['ADMINISTRADOR']);
    renderLayout();
    expect(screen.getByText('Alertas')).toBeInTheDocument();
    expect(screen.getByText('Reportes')).toBeInTheDocument();
  });

  it('TECNICO_SUPERVISOR ve "Alertas" pero no "Reportes" (solo admin/lector)', () => {
    setSessionUser(['TECNICO_SUPERVISOR']);
    renderLayout();
    expect(screen.getByText('Alertas')).toBeInTheDocument();
    expect(screen.queryByText('Reportes')).not.toBeInTheDocument();
  });

  it('los dominios en alcance de LECTOR siempre se muestran', () => {
    setSessionUser(['LECTOR']);
    renderLayout();
    for (const label of [
      'Usuarios',
      'Militares',
      'Recintos Electorales',
      'Eventos Electorales',
      'Asignaciones',
      'Kits Electorales',
      'Monitoreo',
      'Incidencias',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe('Layout — banner persistente de enlace caído', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    setSessionUser(['ADMINISTRADOR']);
  });

  it('muestra un banner persistente cuando llega una notificación ENLACE_CAIDO no leída', async () => {
    apiGetMock.mockResolvedValue({
      data: { items: [enlaceCaidoItem()], total: 1, noLeidas: 1 },
    });

    renderLayout();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Enlace caído: 978/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ya notifiqué' })).toBeInTheDocument();
  });

  it('el banner no bloquea: el resto del layout (menú, campanita) sigue en el documento', async () => {
    apiGetMock.mockResolvedValue({
      data: { items: [enlaceCaidoItem()], total: 1, noLeidas: 1 },
    });

    renderLayout();
    await screen.findByRole('alert');

    expect(screen.getByText('campanita')).toBeInTheDocument();
    expect(screen.getByText('Usuarios')).toBeInTheDocument();
    expect(screen.getByText('contenido')).toBeInTheDocument();
  });

  it('"Ya notifiqué" marca la notificación como leída y cierra el banner', async () => {
    const user = userEvent.setup();
    apiGetMock.mockResolvedValue({
      data: { items: [enlaceCaidoItem()], total: 1, noLeidas: 1 },
    });
    apiPatchMock.mockResolvedValue({ data: undefined });

    renderLayout();
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Ya notifiqué' }));

    expect(apiPatchMock).toHaveBeenCalledWith(expect.stringContaining('n1'));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('agrupa varias caídas sin leer en un solo banner y las confirma todas juntas', async () => {
    const user = userEvent.setup();
    apiGetMock.mockResolvedValue({
      data: {
        items: [enlaceCaidoItem('n1', '978'), enlaceCaidoItem('n2', '982')],
        total: 2,
        noLeidas: 2,
      },
    });
    apiPatchMock.mockResolvedValue({ data: undefined });

    renderLayout();
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('2 enlaces caídos');
    expect(screen.getByText(/Enlace caído: 978/)).toBeInTheDocument();
    expect(screen.getByText(/Enlace caído: 982/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ya notifiqué' }));

    expect(apiPatchMock).toHaveBeenCalledWith(expect.stringContaining('n1'));
    expect(apiPatchMock).toHaveBeenCalledWith(expect.stringContaining('n2'));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  it('aparece aunque el enlace caído quede fuera de la primera página de la lista general', async () => {
    // La lista paginada (page 1, pageSize 10) trae puras notificaciones más
    // nuevas que el enlace caído — este solo aparece en la consulta aparte
    // con soloNoLeidas. Si el banner derivara de la lista paginada, nunca
    // aparecería (bug real que motivó esta consulta separada).
    apiGetMock.mockImplementation((url: string) => {
      if (url.includes('soloNoLeidas=true')) {
        return Promise.resolve({
          data: { items: [enlaceCaidoItem()], total: 1, noLeidas: 11 },
        });
      }
      return Promise.resolve({ data: { items: [], total: 11, noLeidas: 11 } });
    });

    renderLayout();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Enlace caído: 978/)).toBeInTheDocument();
  });

  it('si falla la confirmación de una de varias caídas, cierra la que sí se confirmó y deja la fallida en el banner', async () => {
    const user = userEvent.setup();
    apiGetMock.mockResolvedValue({
      data: {
        items: [enlaceCaidoItem('n1', '978'), enlaceCaidoItem('n2', '982')],
        total: 2,
        noLeidas: 2,
      },
    });
    apiPatchMock.mockImplementation((url: string) =>
      url.includes('n2') ? Promise.reject(new Error('network error')) : Promise.resolve({ data: undefined }),
    );

    renderLayout();
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Ya notifiqué' }));

    await waitFor(() => {
      expect(screen.queryByText(/Enlace caído: 978/)).not.toBeInTheDocument();
    });
    // La fallida se queda visible — no desaparece sin haberse confirmado de verdad.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Enlace caído: 982/)).toBeInTheDocument();
    expect(sileoErrorMock).toHaveBeenCalled();
  });

  it('no aparece para roles sin acceso a notificaciones (ej. LECTOR)', async () => {
    setSessionUser(['LECTOR']);
    apiGetMock.mockResolvedValue({
      data: { items: [enlaceCaidoItem()], total: 1, noLeidas: 1 },
    });

    renderLayout();
    await screen.findByText('Reportes');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
