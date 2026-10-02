import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { EventoElectoral } from '@cne/shared-types';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), patch: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));

import { api } from '../../lib/api';
import { ConfigAlertasModal, configATexto, textoAConfig } from './EventosPage';

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const patchMock = api.patch as unknown as ReturnType<typeof vi.fn>;

const evento = { id: 'ev1', nombre: 'Evento de prueba' } as EventoElectoral;
const config = {
  umbralLlegadaRecintoMin: 120,
  umbralLlegadaDpiMin: 120,
  umbralSinSyncMin: 30,
  margenLlegadaMetros: 275,
};

function renderModal(onDone = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ConfigAlertasModal evento={evento} onClose={vi.fn()} onDone={onDone} />
    </QueryClientProvider>,
  );
  return onDone;
}

describe('configATexto / textoAConfig', () => {
  it('convierte ida y vuelta sin perder valores', () => {
    expect(textoAConfig(configATexto(config))).toEqual(config);
  });
});

describe('ConfigAlertasModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue({ data: { ...evento, configAlertas: config } });
    patchMock.mockResolvedValue({ data: {} });
  });

  it('permite borrar el margen y escribir uno nuevo de decenas de km', async () => {
    const user = userEvent.setup();
    const onDone = renderModal();

    const margen = screen.getByLabelText('Margen de llegada al recinto (m)');
    await screen.findByDisplayValue('275');

    await user.clear(margen);
    expect(margen).toHaveValue(null); // vacío, no "0"
    await user.type(margen, '60000');
    expect(margen).toHaveValue(60000);

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(patchMock).toHaveBeenCalledWith('/eventos/ev1/config-alertas', {
      ...config,
      margenLlegadaMetros: 60000,
    });
    expect(onDone).toHaveBeenCalled();
  });

  it('con un campo vacío avisa en español y no guarda', async () => {
    const user = userEvent.setup();
    renderModal();
    await screen.findByDisplayValue('275');

    await user.clear(screen.getByLabelText('Umbral sin sincronización (min)'));
    // Evita la validación nativa del navegador para probar la propia.
    screen.getByRole('button', { name: 'Guardar' }).closest('form')!.noValidate = true;
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(screen.getByText('Completa todos los campos.')).toBeInTheDocument();
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('fuera de rango indica el campo y su rango válido', async () => {
    const user = userEvent.setup();
    renderModal();
    const margen = screen.getByLabelText('Margen de llegada al recinto (m)');
    await screen.findByDisplayValue('275');

    await user.clear(margen);
    await user.type(margen, '250000');
    screen.getByRole('button', { name: 'Guardar' }).closest('form')!.noValidate = true;
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(screen.getByText(/Valor no válido en: Margen de llegada \(10 a 200/)).toBeInTheDocument();
    expect(patchMock).not.toHaveBeenCalled();
  });
});
