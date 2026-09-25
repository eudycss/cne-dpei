import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ConfigEnlacesResponse } from '@cne/shared-types';

import { CorreosAvisoModal } from './CorreosAvisoModal';
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
const sileoSuccessMock = sileo.success as unknown as ReturnType<typeof vi.fn>;

let correosActuales: string[];
const config = (): ConfigEnlacesResponse => ({ correos: correosActuales });

function renderModal(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { onClose, ...render(
    <QueryClientProvider client={client}>
      <CorreosAvisoModal onClose={onClose} />
    </QueryClientProvider>,
  ) };
}

describe('CorreosAvisoModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    correosActuales = ['admin@cne.gob.ec'];
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/enlaces/config') return Promise.resolve({ data: config() });
      return Promise.resolve({ data: [] });
    });
  });

  it('lista los correos configurados y permite agregar uno nuevo', async () => {
    const user = userEvent.setup();
    apiPostMock.mockImplementation((_url: string, body: { correo: string }) => {
      correosActuales = [...correosActuales, body.correo];
      return Promise.resolve({ data: config() });
    });
    renderModal();

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
    renderModal();

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
    renderModal();

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
    renderModal();

    await screen.findByText('admin@cne.gob.ec');
    await user.click(screen.getByLabelText('Quitar admin@cne.gob.ec'));

    await waitFor(() => {
      expect(sileoErrorMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'no se pudo quitar' }));
    });
  });

  it('reenvía la lista actual a Telegram y muestra cuántos enlaces caídos había', async () => {
    const user = userEvent.setup();
    apiPostMock.mockImplementation((url: string) => {
      if (url === '/enlaces/telegram/reenviar') return Promise.resolve({ data: { enviados: 3 } });
      return Promise.resolve({ data: config() });
    });
    renderModal();

    await screen.findByText('admin@cne.gob.ec');
    await user.click(screen.getByText('Reenviar lista a Telegram'));

    expect(apiPostMock).toHaveBeenCalledWith('/enlaces/telegram/reenviar');
    await waitFor(() => {
      expect(sileoSuccessMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining('3') }),
      );
    });
  });

  it('muestra un toast de error si el reenvío a Telegram falla', async () => {
    const user = userEvent.setup();
    apiPostMock.mockImplementation((url: string) => {
      if (url === '/enlaces/telegram/reenviar') {
        return Promise.reject({ response: { data: { message: 'Telegram no configurado' } } });
      }
      return Promise.resolve({ data: config() });
    });
    renderModal();

    await screen.findByText('admin@cne.gob.ec');
    await user.click(screen.getByText('Reenviar lista a Telegram'));

    await waitFor(() => {
      expect(sileoErrorMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Telegram no configurado' }));
    });
  });

  it('muestra un mensaje cuando no hay correos registrados', async () => {
    correosActuales = [];
    renderModal();

    expect(await screen.findByText('Ningún correo registrado todavía.')).toBeInTheDocument();
  });

  it('cierra al presionar Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await screen.findByText('admin@cne.gob.ec');
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });

  it('cierra al hacer clic en el botón Cerrar', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await screen.findByText('admin@cne.gob.ec');
    await user.click(screen.getByRole('button', { name: 'Cerrar' }));

    expect(onClose).toHaveBeenCalled();
  });

  it('cierra al hacer clic fuera del diálogo', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    await screen.findByText('admin@cne.gob.ec');
    await user.click(screen.getByRole('dialog').parentElement as HTMLElement);

    expect(onClose).toHaveBeenCalled();
  });
});
