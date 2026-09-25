import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ItemKitCatalog } from '@cne/shared-types';

import { ItemsKitPage } from './ItemsKitPage';
import { api } from '../../lib/api';
import { sileo } from 'sileo';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));

const apiGetMock = api.get as unknown as ReturnType<typeof vi.fn>;
const apiPostMock = api.post as unknown as ReturnType<typeof vi.fn>;
const apiPatchMock = api.patch as unknown as ReturnType<typeof vi.fn>;
const apiDeleteMock = api.delete as unknown as ReturnType<typeof vi.fn>;
const sileoErrorMock = sileo.error as unknown as ReturnType<typeof vi.fn>;

let items: ItemKitCatalog[];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ItemsKitPage />
    </QueryClientProvider>,
  );
}

describe('ItemsKitPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    items = [
      { id: 'i1', codigo: 'COMPUTADOR', etiqueta: 'Computador', activo: true },
      { id: 'i2', codigo: 'CARGADOR', etiqueta: 'Cargador', activo: false },
    ];
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/items-kit/admin') return Promise.resolve({ data: items });
      return Promise.resolve({ data: [] });
    });
  });

  it('lista los ítems con su estado (activo/inactivo)', async () => {
    renderPage();

    expect(await screen.findByText('Computador')).toBeInTheDocument();
    expect(screen.getByText('Cargador')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByText('Inactivo')).toBeInTheDocument();
  });

  it('crea un ítem nuevo: código se normaliza a mayúsculas sin espacios', async () => {
    const user = userEvent.setup();
    apiPostMock.mockResolvedValueOnce({
      data: { id: 'i3', codigo: 'LINTERNA', etiqueta: 'Linterna', activo: true },
    });
    renderPage();

    await screen.findByText('Computador');
    await user.click(screen.getByText('+ Nuevo ítem'));

    await user.type(screen.getByPlaceholderText('Ej.: LINTERNA'), 'linterna roja');
    await user.type(screen.getByPlaceholderText('Ej.: Linterna'), 'Linterna roja');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(apiPostMock).toHaveBeenCalledWith('/items-kit', {
        codigo: 'LINTERNA_ROJA',
        etiqueta: 'Linterna roja',
      }),
    );
  });

  it('no permite guardar con etiqueta en blanco (solo espacios)', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Computador');
    await user.click(screen.getByText('+ Nuevo ítem'));
    await user.type(screen.getByPlaceholderText('Ej.: LINTERNA'), 'LINTERNA');
    // Espacio en vez de vacío: pasa la validación nativa `required` del input
    // pero debe seguir bloqueada por el `.trim()` del propio formulario.
    await user.type(screen.getByPlaceholderText('Ej.: Linterna'), ' ');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(screen.getByText('La etiqueta es requerida')).toBeInTheDocument();
    expect(apiPostMock).not.toHaveBeenCalled();
  });

  it('activa/desactiva un ítem existente', async () => {
    const user = userEvent.setup();
    apiPatchMock.mockResolvedValueOnce({ data: { ...items[0], activo: false } });
    renderPage();

    await screen.findByText('Computador');
    const row = screen.getByText('Computador').closest('tr')!;
    await user.click(within(row).getByText('Desactivar'));

    await waitFor(() => expect(apiPatchMock).toHaveBeenCalledWith('/items-kit/i1', { activo: false }));
  });

  it('elimina un ítem tras confirmar, y muestra el mensaje del backend si falla', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    apiDeleteMock.mockRejectedValueOnce({ response: { data: { message: '2 kit(s) usan este ítem' } } });
    renderPage();

    await screen.findByText('Computador');
    const row = screen.getByText('Computador').closest('tr')!;
    await user.click(within(row).getByText('Eliminar'));

    await waitFor(() => expect(apiDeleteMock).toHaveBeenCalledWith('/items-kit/i1'));
    await waitFor(() => expect(sileoErrorMock).toHaveBeenCalledWith({ title: '2 kit(s) usan este ítem' }));
  });

  it('cancelar la confirmación no elimina el ítem', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();

    await screen.findByText('Computador');
    const row = screen.getByText('Computador').closest('tr')!;
    await user.click(within(row).getByText('Eliminar'));

    expect(apiDeleteMock).not.toHaveBeenCalled();
  });
});
