import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ConfigEnlacesResponse } from '@cne/shared-types';

import { FrecuenciaAvisosTelegram, textoMinutos } from './FrecuenciaAvisosTelegram';
import { api } from '../../lib/api';
import { sileo } from 'sileo';

vi.mock('../../lib/api', () => ({ api: { put: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));

const apiPutMock = api.put as unknown as ReturnType<typeof vi.fn>;
const sileoSuccessMock = sileo.success as unknown as ReturnType<typeof vi.fn>;
const sileoErrorMock = sileo.error as unknown as ReturnType<typeof vi.fn>;

const config: ConfigEnlacesResponse = { correos: [], minutosPrimerAviso: 120, minutosRepetirAviso: 120 };

function renderFrecuencia(c: ConfigEnlacesResponse | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FrecuenciaAvisosTelegram config={c} />
    </QueryClientProvider>,
  );
}

describe('textoMinutos', () => {
  it.each([
    [10, '10 min'],
    [30, '30 min'],
    [60, '1 h'],
    [120, '2 h'],
    [240, '4 h'],
  ])('%i → %s', (m, texto) => {
    expect(textoMinutos(m)).toBe(texto);
  });
});

describe('FrecuenciaAvisosTelegram', () => {
  beforeEach(() => vi.clearAllMocks());

  it('muestra la frecuencia guardada en dos selectores con etiqueta, de 10 min a 4 h', () => {
    renderFrecuencia(config);

    const primer = screen.getByLabelText('Primer aviso a los') as HTMLSelectElement;
    expect(primer.value).toBe('120');
    expect((screen.getByLabelText('Repetir cada') as HTMLSelectElement).value).toBe('120');
    expect(Array.from(primer.options, (o) => o.text)).toEqual(['10 min', '15 min', '30 min', '1 h', '2 h', '4 h']);
  });

  it('Guardar se habilita solo si algo cambió', async () => {
    const user = userEvent.setup();
    renderFrecuencia(config);

    const guardar = screen.getByRole('button', { name: 'Guardar frecuencia' });
    expect(guardar).toBeDisabled();

    await user.selectOptions(screen.getByLabelText('Repetir cada'), '10');
    expect(guardar).toBeEnabled();

    await user.selectOptions(screen.getByLabelText('Repetir cada'), '120');
    expect(guardar).toBeDisabled();
  });

  it('guarda la frecuencia del día de votaciones (10 min) y lo confirma', async () => {
    const user = userEvent.setup();
    apiPutMock.mockResolvedValue({ data: { correos: [], minutosPrimerAviso: 10, minutosRepetirAviso: 10 } });
    renderFrecuencia(config);

    await user.selectOptions(screen.getByLabelText('Primer aviso a los'), '10');
    await user.selectOptions(screen.getByLabelText('Repetir cada'), '10');
    await user.click(screen.getByRole('button', { name: 'Guardar frecuencia' }));

    await waitFor(() =>
      expect(apiPutMock).toHaveBeenCalledWith('/enlaces/config/avisos', { minutosPrimerAviso: 10, minutosRepetirAviso: 10 }),
    );
    await waitFor(() =>
      expect(sileoSuccessMock).toHaveBeenCalledWith({ title: 'Avisos guardados: primero a 10 min, luego cada 10 min' }),
    );
  });

  it('si el servidor rechaza, muestra su mensaje', async () => {
    const user = userEvent.setup();
    apiPutMock.mockRejectedValue({ response: { data: { message: 'Elija uno de: 10, 15, 30, 60, 120, 240 minutos' } } });
    renderFrecuencia(config);

    await user.selectOptions(screen.getByLabelText('Repetir cada'), '30');
    await user.click(screen.getByRole('button', { name: 'Guardar frecuencia' }));

    await waitFor(() =>
      expect(sileoErrorMock).toHaveBeenCalledWith({ title: 'Elija uno de: 10, 15, 30, 60, 120, 240 minutos' }),
    );
  });

  it('mientras carga la configuración, los selectores quedan deshabilitados', () => {
    renderFrecuencia(undefined);

    expect(screen.getByLabelText('Primer aviso a los')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Guardar frecuencia' })).toBeDisabled();
  });
});
