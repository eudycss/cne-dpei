import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ConfigEnlacesResponse } from '@cne/shared-types';

import { FrecuenciaResumenJornada } from './FrecuenciaResumenJornada';
import { api } from '../../lib/api';
import { sileo } from 'sileo';

vi.mock('../../lib/api', () => ({ api: { put: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));

const apiPutMock = api.put as unknown as ReturnType<typeof vi.fn>;

const config: ConfigEnlacesResponse = {
  correos: [],
  minutosPrimerAviso: 120,
  minutosRepetirAviso: 120,
  minutosResumenJornada: 15,
};

function renderResumen(c: ConfigEnlacesResponse | undefined) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FrecuenciaResumenJornada config={c} />
    </QueryClientProvider>,
  );
}

describe('FrecuenciaResumenJornada', () => {
  beforeEach(() => vi.clearAllMocks());

  it('muestra la frecuencia guardada y no deja guardar sin cambios', () => {
    renderResumen(config);
    expect(screen.getByLabelText('Enviar el resumen cada')).toHaveValue('15');
    expect(screen.getByRole('button', { name: 'Guardar frecuencia del resumen' })).toBeDisabled();
  });

  it('mientras carga la configuración el selector está deshabilitado', () => {
    renderResumen(undefined);
    expect(screen.getByLabelText('Enviar el resumen cada')).toBeDisabled();
  });

  it('guarda la nueva frecuencia y lo confirma', async () => {
    apiPutMock.mockResolvedValue({ data: { ...config, minutosResumenJornada: 30 } });
    renderResumen(config);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText('Enviar el resumen cada'), '30');
    await user.click(screen.getByRole('button', { name: 'Guardar frecuencia del resumen' }));

    expect(apiPutMock).toHaveBeenCalledWith('/enlaces/config/resumen-jornada', { minutosResumenJornada: 30 });
    await waitFor(() => expect(sileo.success).toHaveBeenCalledWith({ title: 'Resumen de la Jornada: cada 30 min' }));
  });

  it('si el servidor la rechaza, muestra su mensaje', async () => {
    apiPutMock.mockRejectedValue({ response: { data: { message: 'Elija uno de: 5, 10 minutos' } } });
    renderResumen(config);
    const user = userEvent.setup();

    await user.selectOptions(screen.getByLabelText('Enviar el resumen cada'), '60');
    await user.click(screen.getByRole('button', { name: 'Guardar frecuencia del resumen' }));

    await waitFor(() => expect(sileo.error).toHaveBeenCalledWith({ title: 'Elija uno de: 5, 10 minutos' }));
  });
});
