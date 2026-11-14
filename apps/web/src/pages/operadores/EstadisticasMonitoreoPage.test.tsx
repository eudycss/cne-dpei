import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { EstadisticasJornadaDto } from '@cne/shared-types';

const getMock = vi.fn();
vi.mock('../../lib/queries/monitoreo', () => ({
  getEstadisticasJornada: () => getMock(),
  getEstadoCdas: vi.fn(),
  getFotoMilitar: vi.fn(),
  getOperadoresEnRetorno: vi.fn(),
}));

import { EstadisticasMonitoreoPage } from './EstadisticasMonitoreoPage';

const unidad = (codigo: string, canton: string, tecnico: string, salida: string | null, llegada: string | null) => ({
  codigoRecinto: codigo,
  nombreRecinto: `Recinto ${codigo}`,
  cantonNombre: canton,
  tecnicoNombre: tecnico,
  operadorNombre: `Op ${codigo}`,
  asistenteNombre: `Asis ${codigo}`,
  salidaDpiEn: salida,
  llegadaRecintoEn: llegada,
  salidaRecintoEn: null,
  llegadaDpiEn: null,
});

const datos: EstadisticasJornadaDto = {
  evento: 'Simulacro',
  sinDistributivo: false,
  unidades: [
    unidad('C1', 'IBARRA', 'Isidro', '2026-11-15T12:00:00Z', '2026-11-15T13:00:00Z'),
    unidad('C2', 'IBARRA', 'Jairo', '2026-11-15T12:10:00Z', null),
    unidad('C3', 'OTAVALO', 'Isidro', null, null),
  ],
  noCdas: [
    { codigoRecinto: 'N1', nombreRecinto: 'N1', codigoCda: 'C1', nombreCda: 'R', cantonNombre: 'IBARRA', tecnicoNombre: 'Isidro', llegadaEn: '2026-11-15T14:00:00Z' },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <EstadisticasMonitoreoPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EstadisticasMonitoreoPage', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it('sin evento activo avisa', async () => {
    getMock.mockResolvedValue(null);
    renderPage();
    expect(await screen.findByText('No hay un evento activo.')).toBeInTheDocument();
  });

  it('muestra las tarjetas por etapa y las barras por cantón con su porcentaje', async () => {
    getMock.mockResolvedValue(datos);
    renderPage();

    expect(await screen.findByText(/Simulacro · 3 parejas/)).toBeInTheDocument();
    // Etapa elegida por defecto: llegada al recinto. IBARRA 1 de 2; OTAVALO 0 de 1.
    expect(screen.getByRole('img', { name: 'IBARRA: 1 de 2 parejas (50 %)' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'OTAVALO: 0 de 1 parejas (0 %)' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'IBARRA: 1 de 1 NO CDA visitados (100 %)' })).toBeInTheDocument();
  });

  it('cambia la etapa y la agrupación', async () => {
    getMock.mockResolvedValue(datos);
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/Simulacro/);

    const etapas = screen.getByRole('group', { name: 'Etapa del recorrido' });
    await user.click(within(etapas).getByRole('button', { name: /Salida del DPEI/ }));
    expect(screen.getByRole('img', { name: 'IBARRA: 2 de 2 parejas (100 %)' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Por técnico/ }));
    expect(screen.getByRole('img', { name: 'Isidro: 1 de 2 parejas (50 %)' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Jairo: 1 de 1 parejas (100 %)' })).toBeInTheDocument();
  });

  it('la tabla lista las horas de cada etapa por pareja', async () => {
    getMock.mockResolvedValue(datos);
    renderPage();
    const tabla = await screen.findByRole('region', { name: 'Horas de cada etapa por pareja' });
    expect(within(tabla).getByRole('columnheader', { name: 'Llegada al DPEI' })).toBeInTheDocument();
    expect(within(tabla).getByText('Op C2')).toBeInTheDocument();
    expect(within(tabla).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('un error de carga se avisa', async () => {
    getMock.mockImplementation(() => Promise.reject(new Error('x')));
    renderPage();
    expect(await screen.findByText('No se pudieron cargar las estadísticas.')).toBeInTheDocument();
  });
});
