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
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Completa todos los campos.');
    expect(screen.getByLabelText('Umbral sin sincronización (min)')).toHaveAttribute('aria-invalid', 'true');
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('fuera de rango indica el campo y su rango válido', async () => {
    const user = userEvent.setup();
    renderModal();
    const margen = screen.getByLabelText('Margen de llegada al recinto (m)');
    await screen.findByDisplayValue('275');

    await user.clear(margen);
    await user.type(margen, '250000');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/Valor no válido en: Margen de llegada \(10 a 200/);
    expect(margen).toHaveAttribute('aria-invalid', 'true');
    expect(patchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['9', 'por debajo del mínimo'],
    ['150.5', 'decimal'],
  ])('rechaza el margen %s (%s)', async (valor) => {
    const user = userEvent.setup();
    renderModal();
    const margen = screen.getByLabelText('Margen de llegada al recinto (m)');
    await screen.findByDisplayValue('275');

    await user.clear(margen);
    await user.type(margen, valor);
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/Margen de llegada/);
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('advierte cuando el margen supera 5 km (la geocerca casi no valida)', async () => {
    const user = userEvent.setup();
    renderModal();
    const margen = screen.getByLabelText('Margen de llegada al recinto (m)');
    await screen.findByDisplayValue('275');
    expect(screen.queryByText(/prácticamente no se\s+valida/)).not.toBeInTheDocument();

    await user.clear(margen);
    await user.type(margen, '5001');

    expect(screen.getByText(/prácticamente no se\s+valida/)).toBeInTheDocument();
  });

  it('si el servidor falla muestra su mensaje y vuelve a habilitar "Guardar"', async () => {
    patchMock.mockRejectedValueOnce({ response: { data: { message: 'No autorizado' } } });
    const user = userEvent.setup();
    const onDone = renderModal();
    await screen.findByDisplayValue('275');

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('No autorizado');
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
