import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ItemKitCatalog, Kit, RoleName } from '@cne/shared-types';

import { KitsPage } from './KitsPage';
import { AuthProvider } from '../../auth/AuthContext';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
const patchMock = api.patch as unknown as ReturnType<typeof vi.fn>;

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
let operadoresActuales: { id: string; nombres: string; apellidos: string; cedula: string }[] = [];
let kitsActuales: Kit[] = [];
let recintosOcupadosActuales: string[] = [];

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
    if (url.startsWith('/users')) {
      return Promise.resolve({
        data: { items: operadoresActuales, total: operadoresActuales.length, page: 1, pageSize: 100 },
      });
    }
    if (url.startsWith('/kits/recintos-ocupados')) {
      return Promise.resolve({ data: recintosOcupadosActuales });
    }
    if (url.startsWith('/kits')) {
      return Promise.resolve({
        data: { items: kitsActuales, total: kitsActuales.length, page: 1, pageSize: 20 },
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
    operadoresActuales = [];
    kitsActuales = [];
    recintosOcupadosActuales = [];
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
      { id: '99999999-9999-9999-9999-999999999999', codigoRecinto: '30', nombre: 'Escuela Norte' },
    ];
    operadoresActuales = [];
    kitsActuales = [];
    recintosOcupadosActuales = [];
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

  it('no ofrece un recinto que ya tiene un kit real en este evento', async () => {
    recintosOcupadosActuales = ['99999999-9999-9999-9999-999999999999'];
    const user = await openCreateModal();

    await user.click(screen.getByRole('button', { name: '— Selecciona un recinto —' }));

    expect(screen.getByText('28 — Escuela Central')).toBeInTheDocument();
    expect(screen.queryByText('30 — Escuela Norte')).not.toBeInTheDocument();
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

describe('KitsPage — tabla, AsignarKitModal y EditKitModal', () => {
  const itemId = '11111111-1111-1111-1111-111111111111';
  const recintoId = '33333333-3333-3333-3333-333333333333';
  const otroRecintoId = '77777777-7777-7777-7777-777777777777';
  const operadorId = '66666666-6666-6666-6666-666666666666';
  const kitId = '88888888-8888-8888-8888-888888888888';

  function kit(overrides: Partial<Kit> = {}): Kit {
    return {
      id: kitId,
      eventoId: '55555555-5555-5555-5555-555555555555',
      codigoUnico: 'ABCD2345',
      qrPayload: 'ABCD2345',
      nombre: '28 — Escuela Central',
      contenidos: null,
      items: ['Computador'],
      itemIds: [itemId],
      recintoId,
      operadorId: null,
      estado: 'ASIGNADO',
      esPrueba: false,
      creadoEn: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    setSessionUser(['ADMINISTRADOR']);
    itemsCatalogActuales = [
      { id: itemId, codigo: 'COMPUTADOR', etiqueta: 'Computador', activo: true },
    ];
    recintosActuales = [
      { id: recintoId, codigoRecinto: '28', nombre: 'Escuela Central' },
      { id: otroRecintoId, codigoRecinto: '30', nombre: 'Escuela Norte' },
    ];
    operadoresActuales = [
      { id: operadorId, nombres: 'Juan', apellidos: 'Pérez', cedula: '1710034065' },
    ];
    kitsActuales = [kit()];
    // El propio recinto del kit ya está "ocupado" (por él mismo) — debe
    // seguir apareciendo en el selector de EditKitModal aunque esté ocupado.
    recintosOcupadosActuales = [recintoId];
    mockApiResponses();
  });

  it('la tabla ya no muestra la columna Recinto', async () => {
    renderKitsPage();
    await screen.findByText('ABCD2345');
    expect(screen.queryByText('Recinto')).not.toBeInTheDocument();
  });

  it('el botón "Asignar" está deshabilitado si el kit no tiene recinto', async () => {
    kitsActuales = [kit({ recintoId: null })];
    renderKitsPage();
    await screen.findByText('ABCD2345');
    expect(screen.getByRole('button', { name: 'Asignar' })).toBeDisabled();
  });

  it('AsignarKitModal no tiene campo de Recinto y el payload no incluye recintoId', async () => {
    const user = userEvent.setup();
    renderKitsPage();
    await screen.findByText('ABCD2345');

    await user.click(screen.getByRole('button', { name: 'Asignar' }));
    const heading = await screen.findByText('Asignar kit');
    const modal = heading.closest('form') as HTMLElement;

    expect(screen.queryByText('Recinto (CDA)')).not.toBeInTheDocument();
    expect(within(modal).getByText('Recinto:').parentElement).toHaveTextContent('28 — Escuela Central');

    patchMock.mockResolvedValueOnce({ data: kit({ operadorId }) });
    await user.click(within(modal).getByRole('button', { name: '— Selecciona un operador —' }));
    await user.click(screen.getByText(/Juan Pérez/));
    await user.click(within(modal).getByRole('button', { name: 'Asignar' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(`/kits/${kitId}/asignar`, {
        operadorId,
        justificacion: undefined,
      }),
    );
  });

  it('EditKitModal abre con el recinto e ítems actuales del kit, y permite cambiar el recinto', async () => {
    const user = userEvent.setup();
    renderKitsPage();
    await screen.findByText('ABCD2345');

    await user.click(screen.getByRole('button', { name: 'Editar' }));
    const heading = await screen.findByText('Editar kit');
    const modal = heading.closest('form') as HTMLElement;

    expect(within(modal).getByRole('button', { name: '28 — Escuela Central' })).toBeInTheDocument();
    expect(within(modal).getByLabelText('Computador')).toBeChecked();

    patchMock.mockResolvedValueOnce({ data: kit({ recintoId: otroRecintoId }) });
    await user.click(within(modal).getByRole('button', { name: '28 — Escuela Central' }));
    await user.click(screen.getByText('30 — Escuela Norte'));
    await user.click(within(modal).getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith(`/kits/${kitId}`, {
        recintoId: otroRecintoId,
        justificacion: undefined,
      }),
    );
  });

  it('muestra la tabla de resultados Fila/Error/Datos tras una carga masiva con filas fallidas', async () => {
    kitsActuales = [];
    renderKitsPage();
    await screen.findByText(/Evento:/);

    postMock.mockResolvedValueOnce({
      data: {
        creados: 1,
        errores: [{ fila: 3, error: 'Ítem de kit no encontrado o inactivo: XYZ', datos: { nombre: 'Kit X' } }],
      },
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['dummy'], 'kits.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await userEvent.upload(fileInput, file);

    await screen.findByText('Resultado de la última importación');
    expect(screen.getByText('Fila')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Datos')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/Ítem de kit no encontrado/)).toBeInTheDocument();
  });
});
