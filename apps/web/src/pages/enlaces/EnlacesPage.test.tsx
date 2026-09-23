import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ConfigEnlacesResponse, EnlaceRecinto } from '@cne/shared-types';

import { EnlacesPage } from './EnlacesPage';
import { api } from '../../lib/api';
import { sileo } from 'sileo';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));

const apiGetMock = api.get as unknown as ReturnType<typeof vi.fn>;
const apiPostMock = api.post as unknown as ReturnType<typeof vi.fn>;
const apiDeleteMock = api.delete as unknown as ReturnType<typeof vi.fn>;
const sileoErrorMock = sileo.error as unknown as ReturnType<typeof vi.fn>;

const enlaces: EnlaceRecinto[] = [
  { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO', actualizadoEn: '2026-09-23T11:00:00.000Z' },
  { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide', estado: 'ACTIVO', actualizadoEn: '2026-09-23T11:00:00.000Z' },
];

let correosActuales: string[];
const config = (): ConfigEnlacesResponse => ({ correos: correosActuales });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EnlacesPage />
    </QueryClientProvider>,
  );
}

describe('EnlacesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    correosActuales = ['admin@cne.gob.ec'];
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/enlaces') return Promise.resolve({ data: enlaces });
      if (url === '/enlaces/config') return Promise.resolve({ data: config() });
      return Promise.resolve({ data: [] });
    });
  });

  it('lista los enlaces con su estado', async () => {
    renderPage();

    expect(await screen.findByText('Escuela Central')).toBeInTheDocument();
    expect(screen.getByText('Unidad Educativa Zaldumbide')).toBeInTheDocument();
    expect(screen.getByText('FALLO')).toBeInTheDocument();
    expect(screen.getByText('ACTIVO')).toBeInTheDocument();
  });

  it('lista los correos configurados y permite agregar uno nuevo', async () => {
    const user = userEvent.setup();
    apiPostMock.mockImplementation((_url: string, body: { correo: string }) => {
      correosActuales = [...correosActuales, body.correo];
      return Promise.resolve({ data: config() });
    });
    renderPage();

    expect(await screen.findByText('admin@cne.gob.ec')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Nuevo correo'), 'nuevo@cne.gob.ec');
    await user.click(screen.getByText('Agregar'));

    expect(apiPostMock).toHaveBeenCalledWith('/enlaces/config/correos', { correo: 'nuevo@cne.gob.ec' });
    expect(await screen.findByText('nuevo@cne.gob.ec')).toBeInTheDocument();
  });

  it('permite quitar un correo existente', async () => {
    const user = userEvent.setup();
    correosActuales = ['admin@cne.gob.ec', 'otro@cne.gob.ec'];
    apiDeleteMock.mockImplementation((_url: string, opts: { data: { correo: string } }) => {
      correosActuales = correosActuales.filter((c) => c !== opts.data.correo);
      return Promise.resolve({ data: config() });
    });
    renderPage();

    await screen.findByText('otro@cne.gob.ec');
    await user.click(screen.getByLabelText('Quitar otro@cne.gob.ec'));

    expect(apiDeleteMock).toHaveBeenCalledWith('/enlaces/config/correos', { data: { correo: 'otro@cne.gob.ec' } });
    await waitFor(() => {
      expect(screen.queryByText('otro@cne.gob.ec')).not.toBeInTheDocument();
    });
  });

  it('muestra un toast de error si agregar un correo falla', async () => {
    const user = userEvent.setup();
    apiPostMock.mockRejectedValue({ response: { data: { message: 'correo inválido' } } });
    renderPage();

    await screen.findByText('admin@cne.gob.ec');
    await user.type(screen.getByLabelText('Nuevo correo'), 'malo@cne.gob.ec');
    await user.click(screen.getByText('Agregar'));

    await waitFor(() => {
      expect(sileoErrorMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'correo inválido' }));
    });
  });

  it('muestra un toast de error si quitar un correo falla', async () => {
    const user = userEvent.setup();
    apiDeleteMock.mockRejectedValue({ response: { data: { message: 'no se pudo quitar' } } });
    renderPage();

    await screen.findByText('admin@cne.gob.ec');
    await user.click(screen.getByLabelText('Quitar admin@cne.gob.ec'));

    await waitFor(() => {
      expect(sileoErrorMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'no se pudo quitar' }));
    });
  });
});
