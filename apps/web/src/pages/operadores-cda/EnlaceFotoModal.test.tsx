import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OperadorCda } from '@cne/shared-types';

import { EnlaceFotoModal } from './EnlaceFotoModal';
import { numeroWhatsApp } from './utils';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

const TOKEN_1 = 'A'.repeat(43);
const TOKEN_2 = 'B'.repeat(43);

const operador = (over: Partial<OperadorCda> = {}): OperadorCda => ({
  id: 'o1',
  numero: 1,
  apellidosNombres: 'CHÁVEZ MORA LUCÍA ESTEFANÍA',
  cedula: '1710034065',
  telefono: '0968333444',
  cargo: 'OPERADOR CDA',
  unidad: null,
  fechaInicio: null,
  tieneFoto: false,
  activo: true,
  creadoEn: '2026-10-22T10:00:00.000Z',
  ...over,
});

async function generar() {
  await userEvent.click(screen.getByRole('button', { name: 'Generar enlace' }));
}

function renderModal(o = operador(), onClose = vi.fn()) {
  render(
    <StrictMode>
      <QueryClientProvider client={new QueryClient()}>
        <EnlaceFotoModal operador={o} onClose={onClose} />
      </QueryClientProvider>
    </StrictMode>,
  );
  return { onClose };
}

describe('EnlaceFotoModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    postMock
      .mockReset()
      .mockResolvedValueOnce({ data: { token: TOKEN_1, expiraEn: '2026-10-24T19:00:00.000Z' } })
      .mockResolvedValueOnce({ data: { token: TOKEN_2, expiraEn: '2026-10-24T20:00:00.000Z' } });
  });

  it('abrir la ventana no genera ni anula nada; "Generar enlace" crea uno con el token en el #', async () => {
    renderModal();
    expect(screen.getByText(/ese deja de funcionar/)).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
    await generar();
    expect(await screen.findByLabelText('Enlace personal')).toBeInTheDocument();
    expect((screen.getByLabelText('Enlace personal') as HTMLInputElement).value).toContain(`/foto-cda#${TOKEN_1}`);
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith('/operadores-cda/o1/enlace-foto');
    expect(screen.getByRole('dialog', { name: 'Enlace para subir foto' })).toBeInTheDocument();
  });

  it('WhatsApp: al celular del operador (593…) con el enlace en el mensaje', async () => {
    renderModal();
    await generar();
    const enlace = await screen.findByRole('link', { name: 'Enviar por WhatsApp' });
    const href = enlace.getAttribute('href')!;
    expect(href.startsWith('https://wa.me/593968333444?text=')).toBe(true);
    const texto = decodeURIComponent(href.split('?text=')[1]);
    expect(texto).toContain('Hola LUCÍA');
    expect(texto).toContain(`/foto-cda#${TOKEN_1}`);
    expect(enlace).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('sin celular válido, WhatsApp abre para elegir el contacto y se avisa', async () => {
    renderModal(operador({ telefono: null }));
    await generar();
    const enlace = await screen.findByRole('link', { name: 'Enviar por WhatsApp' });
    expect(enlace.getAttribute('href')!.startsWith('https://wa.me/?text=')).toBe(true);
    expect(screen.getByText(/no tiene un celular válido/)).toBeInTheDocument();
  });

  it('"Generar otro" pide un enlace nuevo y muestra el nuevo', async () => {
    renderModal();
    await generar();
    await screen.findByDisplayValue(new RegExp(TOKEN_1));
    await userEvent.click(screen.getByRole('button', { name: 'Generar otro' }));
    expect(await screen.findByDisplayValue(new RegExp(TOKEN_2))).toBeInTheDocument();
    expect(postMock).toHaveBeenCalledTimes(2);
  });

  it('Copiar deja el enlace en el portapapeles', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: 'Generar enlace' }));
    await screen.findByDisplayValue(new RegExp(TOKEN_1));
    await user.click(screen.getByRole('button', { name: 'Copiar' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copiado' })).toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('Enlace copiado.');
    await expect(navigator.clipboard.readText()).resolves.toContain(`/foto-cda#${TOKEN_1}`);
  });

  it('si falla, muestra el mensaje de la API', async () => {
    postMock.mockReset().mockRejectedValue({ response: { data: { message: 'Operador no encontrado' } } });
    renderModal();
    await generar();
    expect(await screen.findByRole('alert')).toHaveTextContent('Operador no encontrado');
    expect(screen.queryByRole('link', { name: 'Enviar por WhatsApp' })).not.toBeInTheDocument();
  });

  it('Cerrar llama a onClose', async () => {
    const { onClose } = renderModal();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('numeroWhatsApp', () => {
  it('convierte celulares de Ecuador al formato internacional', () => {
    expect(numeroWhatsApp('0968333444')).toBe('593968333444');
    expect(numeroWhatsApp('096 833 3444')).toBe('593968333444');
    expect(numeroWhatsApp('+593 96 833 3444')).toBe('593968333444');
  });

  it('null si no es un celular (fijo, corto o vacío)', () => {
    expect(numeroWhatsApp('062612345')).toBeNull();
    expect(numeroWhatsApp('12345')).toBeNull();
    expect(numeroWhatsApp(null)).toBeNull();
  });
});
