import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { sileo } from 'sileo';

import { PermisosModulosPage } from './PermisosModulosPage';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), put: vi.fn() },
}));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const putMock = api.put as unknown as ReturnType<typeof vi.fn>;

const MATRIZ = {
  roles: [
    { rol: 'TECNICO_SUPERVISOR', modulos: ['kits', 'alertas'] },
    { rol: 'LECTOR', modulos: ['kits', 'reportes'] },
    { rol: 'ASISTENTE_TRANSVERSAL', modulos: ['cadena-custodia'] },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PermisosModulosPage />
    </QueryClientProvider>,
  );
}

const casilla = (nombre: string) => screen.getByRole('checkbox', { name: nombre });

describe('PermisosModulosPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue({ data: MATRIZ });
    putMock.mockImplementation((url: string, body: { modulos: string[] }) =>
      Promise.resolve({ data: { rol: url.split('/').pop(), modulos: body.modulos } }),
    );
  });

  it('marca los módulos que cada rol ve hoy', async () => {
    renderPage();
    expect(await screen.findByRole('checkbox', { name: 'Kits Electorales para Técnico supervisor' })).toBeChecked();
    expect(casilla('Incidencias para Técnico supervisor')).not.toBeChecked();
    expect(casilla('Cadena de custodia para Asistente Electoral Transversal')).toBeChecked();
  });

  it('deshabilita las casillas que el servidor no permite a ese rol y explica por qué', async () => {
    renderPage();
    const alertasLector = await screen.findByRole('checkbox', { name: 'Alertas para Lector' });
    expect(alertasLector).toBeDisabled();
    expect(alertasLector).toHaveAccessibleDescription(/no están disponibles para ese rol/);
    expect(casilla('Alertas para Técnico supervisor')).toBeEnabled();
  });

  it('guarda solo los roles que cambiaron', async () => {
    const user = userEvent.setup();
    renderPage();
    const guardar = await screen.findByRole('button', { name: 'Guardar cambios' });
    expect(guardar).toBeDisabled();

    await user.click(casilla('Incidencias para Técnico supervisor'));
    await user.click(casilla('Alertas para Técnico supervisor'));
    await user.click(guardar);

    await waitFor(() => expect(putMock).toHaveBeenCalledTimes(1));
    expect(putMock).toHaveBeenCalledWith('/permisos-modulos/TECNICO_SUPERVISOR', {
      modulos: ['kits', 'incidencias'],
    });
    expect(sileo.success).toHaveBeenCalled();
  });

  it('"Restaurar valores de fábrica" vuelve a la visibilidad original', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('checkbox', { name: 'Kits Electorales para Técnico supervisor' });
    await user.click(screen.getByRole('button', { name: 'Restaurar valores de fábrica' }));
    expect(casilla('Incidencias para Técnico supervisor')).toBeChecked();
    expect(casilla('Operadores CDA para Asistente Electoral Transversal')).toBeChecked();
  });

  it('avisa el error del servidor al guardar', async () => {
    putMock.mockRejectedValueOnce({ response: { data: { message: 'Módulos no disponibles para este rol: alertas' } } });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('checkbox', { name: 'Reportes para Lector' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() =>
      expect(sileo.error).toHaveBeenCalledWith({ title: 'Módulos no disponibles para este rol: alertas' }),
    );
  });
});
