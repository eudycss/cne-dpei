import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Recinto } from '@cne/shared-types';

import { RecintosPage } from './RecintosPage';
import { api } from '../../lib/api';

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { roles: ['ADMINISTRADOR'] } }),
}));

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('sileo', () => ({ sileo: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

const apiGet = api.get as unknown as ReturnType<typeof vi.fn>;
const apiPatch = api.patch as unknown as ReturnType<typeof vi.fn>;

function recinto(over: Partial<Recinto> = {}): Recinto {
  return {
    id: 'r1',
    codigoRecinto: '1961',
    nombre: 'UE García Moreno',
    direccion: null,
    cantonId: 1,
    cantonNombre: 'Ibarra',
    parroquia: null,
    zona: null,
    tipo: 'CDA',
    latitud: 0.35,
    longitud: -78.11,
    tieneInternet: false,
    coberturaMovil: false,
    numeroElectores: null,
    juntasFemeninas: null,
    juntasMasculinas: null,
    esDificilAcceso: false,
    ...over,
  };
}

const cda = recinto();
const suelto = recinto({ id: 'r2', codigoRecinto: 'TEST-1', nombre: 'Recinto de prueba suelto', tipo: 'NO_CDA' });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <RecintosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RecintosPage — NO-CDA sin CDA asignado', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGet.mockImplementation((url: string) => {
      if (url === '/cantones') return Promise.resolve({ data: [{ id: 1, codigo: '10', nombre: 'Ibarra' }] });
      if (url.startsWith('/recintos?')) {
        const items = url.includes('sinCda=true') ? [suelto] : [cda];
        return Promise.resolve({ data: { items, total: items.length, page: 1, pageSize: 20 } });
      }
      return Promise.resolve({ data: { items: [], total: 0, page: 1, pageSize: 20 } });
    });
  });

  it('por defecto lista los CDA y el filtro muestra los NO-CDA que quedaron sueltos', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('UE García Moreno');
    expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('tipo=CDA'));

    await user.selectOptions(screen.getByLabelText('Mostrar'), 'sueltos');

    expect(await screen.findByText('Recinto de prueba suelto')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith(expect.stringContaining('sinCda=true'));
    expect(apiGet).not.toHaveBeenCalledWith(expect.stringMatching(/sinCda=true.*tipo=CDA|tipo=CDA.*sinCda=true/));
    expect(screen.getByText(/cámbialo de nuevo a tipo CDA/)).toBeInTheDocument();
  });

  it('desde el filtro se puede devolver el recinto a CDA', async () => {
    const user = userEvent.setup();
    apiPatch.mockResolvedValueOnce({ data: { ...suelto, tipo: 'CDA' } });
    renderPage();
    await screen.findByText('UE García Moreno');
    await user.selectOptions(screen.getByLabelText('Mostrar'), 'sueltos');
    const fila = (await screen.findByText('Recinto de prueba suelto')).closest('tr')!;

    await user.click(within(fila).getByText('Editar'));
    await user.selectOptions(screen.getByDisplayValue('No CDA'), 'CDA');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(apiPatch).toHaveBeenCalledWith('/recintos/r2', expect.objectContaining({ tipo: 'CDA' }));
  });

  it('si la API bloquea el cambio a NO-CDA, muestra el motivo como alerta', async () => {
    const user = userEvent.setup();
    const mensaje =
      'No se puede cambiar a NO-CDA: el recinto tiene 1 kit(s) asignado(s) en el evento activo (Diego Leon). Quita primero la asignación del kit.';
    apiPatch.mockRejectedValueOnce({ response: { status: 409, data: { message: mensaje } } });
    renderPage();
    const fila = (await screen.findByText('UE García Moreno')).closest('tr')!;

    await user.click(within(fila).getByText('Editar'));
    const formulario = screen.getByText('Editar recinto').closest('form')!;
    await user.selectOptions(within(formulario).getByDisplayValue('CDA'), 'NO_CDA');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(mensaje);
  });
});
