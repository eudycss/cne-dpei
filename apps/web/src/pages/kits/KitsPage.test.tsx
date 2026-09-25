import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ItemKitCatalog, RoleName } from '@cne/shared-types';

import { KitsPage } from './KitsPage';
import { AuthProvider } from '../../auth/AuthContext';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

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

let itemsCatalogActuales: ItemKitCatalog[];
let recintosActuales: { id: string; codigoRecinto: string; nombre: string }[];

function mockApiResponses() {
  getMock.mockImplementation((url: string) => {
    if (url.startsWith('/eventos')) {
      return Promise.resolve({
        data: [{
          id: '55555555-5555-5555-5555-555555555555',
          nombre: 'Evento 1',
          estado: 'ACTIVO',
          fechaJornada: '2026-01-01',
        }],
      });
    }
    if (url.startsWith('/items-kit')) {
      return Promise.resolve({ data: itemsCatalogActuales });
    }
    if (url.startsWith('/recintos')) {
      return Promise.resolve({
        data: { items: recintosActuales, total: recintosActuales.length, page: 1, pageSize: 200 },
      });
    }
    return Promise.resolve({ data: { items: [], total: 0, page: 1, pageSize: 20 } });
  });
}

function renderKitsPage() {
  const qc = new QueryClient();
  return render(
    <AuthProvider>
      <QueryClientProvider client={qc}>
        <KitsPage />
      </QueryClientProvider>
    </AuthProvider>,
  );
}

describe('KitsPage — botones de escritura ocultos para no-admin', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    itemsCatalogActuales = [];
    recintosActuales = [];
    mockApiResponses();
  });

  it('LECTOR no ve ningún botón de escritura', async () => {
    setSessionUser(['LECTOR']);
    renderKitsPage();

    await waitFor(() => expect(screen.getByText(/Evento:/)).toBeInTheDocument());

    expect(screen.queryByText('+ Nuevo kit')).not.toBeInTheDocument();
    expect(screen.queryByText('↓ Plantilla')).not.toBeInTheDocument();
    expect(screen.queryByText('↑ Importar')).not.toBeInTheDocument();
    expect(screen.queryByText('PDF QR')).not.toBeInTheDocument();
  });

  it('ADMINISTRADOR sí ve los botones de escritura', async () => {
    setSessionUser(['ADMINISTRADOR']);
    renderKitsPage();

    await waitFor(() => expect(screen.getByText(/Evento:/)).toBeInTheDocument());

    expect(screen.getByText('+ Nuevo kit')).toBeInTheDocument();
    expect(screen.getByText('↓ Plantilla')).toBeInTheDocument();
    expect(screen.getByText('↑ Importar')).toBeInTheDocument();
    expect(screen.getByText('PDF QR')).toBeInTheDocument();
  });

  it('ADMINISTRADOR ve la pestaña "Ítems de Kit"', async () => {
    setSessionUser(['ADMINISTRADOR']);
    renderKitsPage();

    await waitFor(() => expect(screen.getByText(/Evento:/)).toBeInTheDocument());

    expect(screen.getByText('Ítems de Kit')).toBeInTheDocument();
  });

  it('LECTOR no ve la pestaña "Ítems de Kit"', async () => {
    setSessionUser(['LECTOR']);
    renderKitsPage();

    await waitFor(() => expect(screen.getByText(/Evento:/)).toBeInTheDocument());

    expect(screen.queryByText('Ítems de Kit')).not.toBeInTheDocument();
  });
});

describe('KitsPage — CreateKitModal', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    setSessionUser(['ADMINISTRADOR']);
    itemsCatalogActuales = [
      { id: '11111111-1111-1111-1111-111111111111', codigo: 'COMPUTADOR', etiqueta: 'Computador', activo: true },
      { id: '22222222-2222-2222-2222-222222222222', codigo: 'MOUSE', etiqueta: 'Mouse', activo: true },
    ];
    recintosActuales = [
      { id: '33333333-3333-3333-3333-333333333333', codigoRecinto: '28', nombre: 'Escuela Central' },
    ];
    mockApiResponses();
  });

  async function openCreateModal() {
    const user = userEvent.setup();
    renderKitsPage();
    await waitFor(() => expect(screen.getByText(/Evento:/)).toBeInTheDocument());
    await user.click(screen.getByText('+ Nuevo kit'));
    await screen.findByText('Nuevo kit electoral');
    return user;
  }

  it('sin seleccionar recinto, no permite crear el kit', async () => {
    const user = await openCreateModal();

    await user.click(screen.getByRole('button', { name: 'Crear kit' }));

    expect(screen.getByText('Selecciona un recinto')).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('los ítems del catálogo aparecen todos marcados por defecto', async () => {
    await openCreateModal();

    expect(screen.getByLabelText('Computador')).toBeChecked();
    expect(screen.getByLabelText('Mouse')).toBeChecked();
  });

  it('desmarcar un ítem lo excluye del payload, y el nombre se autogenera desde el recinto', async () => {
    const user = await openCreateModal();
    postMock.mockResolvedValueOnce({ data: {} });

    await user.click(screen.getByRole('button', { name: '— Selecciona un recinto —' }));
    await user.click(screen.getByText('28 — Escuela Central'));
    await user.click(screen.getByLabelText('Mouse'));
    await user.click(screen.getByRole('button', { name: 'Crear kit' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/kits', {
        eventoId: '55555555-5555-5555-5555-555555555555',
        nombre: '28 — Escuela Central',
        contenidos: null,
        esPrueba: false,
        itemIds: ['11111111-1111-1111-1111-111111111111'],
        recintoId: '33333333-3333-3333-3333-333333333333',
      }),
    );
  });

  it('"+ Agregar otro" crea el ítem en el catálogo y lo deja marcado en el checklist', async () => {
    const user = await openCreateModal();
    postMock.mockImplementation((url: string) => {
      if (url === '/items-kit') {
        const nuevo = {
          id: '44444444-4444-4444-4444-444444444444',
          codigo: 'LINTERNA',
          etiqueta: 'Linterna',
          activo: true,
        };
        itemsCatalogActuales = [...itemsCatalogActuales, nuevo];
        return Promise.resolve({ data: nuevo });
      }
      return Promise.resolve({ data: {} });
    });

    await user.type(screen.getByPlaceholderText('Otro ítem…'), 'Linterna');
    expect(screen.getByPlaceholderText('Otro ítem…')).toHaveValue('Linterna');
    expect(screen.getByRole('button', { name: '+ Agregar otro' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: '+ Agregar otro' }));

    await screen.findByLabelText('Linterna');
    expect(postMock).toHaveBeenCalledWith('/items-kit', { codigo: 'LINTERNA', etiqueta: 'Linterna' });
    expect(screen.getByLabelText('Linterna')).toBeChecked();
  });
});
