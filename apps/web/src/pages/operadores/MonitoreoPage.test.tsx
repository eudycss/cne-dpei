import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CdaEstadoDto, OperadorEnRetorno } from '@cne/shared-types';

import { MonitoreoPage } from './MonitoreoPage';
import { getEstadoCdas, getFotoMilitar, getOperadoresEnRetorno } from '../../lib/queries/monitoreo';

vi.mock('../../lib/queries/monitoreo', () => ({
  getOperadoresEnRetorno: vi.fn(),
  getEstadoCdas: vi.fn(),
  getFotoMilitar: vi.fn(),
}));

vi.mock('../../components/map', () => ({
  MapView: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Marker: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  FitBounds: () => null,
}));

vi.mock('slot-text/react', () => ({
  SlotText: ({ text }: { text: string }) => <>{text}</>,
}));

const getOperadoresMock = getOperadoresEnRetorno as unknown as ReturnType<typeof vi.fn>;
const getEstadoCdasMock = getEstadoCdas as unknown as ReturnType<typeof vi.fn>;
const getFotoMilitarMock = getFotoMilitar as unknown as ReturnType<typeof vi.fn>;

const operadorRetorno: OperadorEnRetorno = {
  operadorId: 'op1',
  operadorNombre: 'Juan Pérez',
  latitud: 0.35,
  longitud: -78.12,
  capturadoEn: '2026-07-01T10:00:00.000Z',
  kits: [{ id: 'k1', codigoUnico: 'KIT-001', nombre: 'Kit A' }],
};

const cdaConUbicacionYFoto: CdaEstadoDto = {
  recintoId: 'r1',
  codigoRecinto: 'C1',
  nombreRecinto: 'Escuela Manuela Cañizares',
  cantonId: 1,
  cantonNombre: 'Ibarra',
  operadorId: 'op1',
  operadorNombre: 'Juan Pérez',
  estado: 'EN_RETORNO',
  ubicacion: { latitud: 0.35, longitud: -78.12, capturadoEn: '2026-07-01T10:00:00.000Z' },
  tieneFotoMilitar: true,
};

const cdaSinUbicacionNiFoto: CdaEstadoDto = {
  recintoId: 'r2',
  codigoRecinto: 'C2',
  nombreRecinto: 'Colegio Otavalo',
  cantonId: 2,
  cantonNombre: 'Otavalo',
  operadorId: 'op2',
  operadorNombre: 'Ana Ruiz',
  estado: 'RETORNADO',
  ubicacion: null,
  tieneFotoMilitar: false,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MonitoreoPage />
    </QueryClientProvider>,
  );
}

describe('MonitoreoPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('muestra "Cargando…" mientras las queries están pendientes', () => {
    getOperadoresMock.mockReturnValue(new Promise(() => {}));
    getEstadoCdasMock.mockReturnValue(new Promise(() => {}));

    renderPage();

    expect(screen.getAllByText('Cargando…').length).toBeGreaterThan(0);
  });

  it('muestra error si las queries fallan', async () => {
    getOperadoresMock.mockRejectedValue(new Error('fail'));
    getEstadoCdasMock.mockRejectedValue(new Error('fail'));

    renderPage();

    expect(await screen.findByText('No se pudo cargar el monitoreo.')).toBeInTheDocument();
    expect(await screen.findByText('No se pudo cargar el estado de los CDAs.')).toBeInTheDocument();
  });

  it('muestra los estados vacíos cuando no hay operadores ni CDAs', async () => {
    getOperadoresMock.mockResolvedValue([]);
    getEstadoCdasMock.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText('No hay operadores en retorno en este momento.')).toBeInTheDocument();
    expect(
      await screen.findByText('No hay CDAs con operador asignado en el evento activo'),
    ).toBeInTheDocument();
  });

  it('lista operadores en retorno y CDAs, con filtro por cantón', async () => {
    getOperadoresMock.mockResolvedValue([operadorRetorno]);
    getEstadoCdasMock.mockResolvedValue([cdaConUbicacionYFoto, cdaSinUbicacionNiFoto]);
    const user = userEvent.setup();

    renderPage();

    expect((await screen.findAllByText('Juan Pérez')).length).toBeGreaterThan(0);
    expect(screen.getByText('Escuela Manuela Cañizares')).toBeInTheDocument();
    expect(screen.getByText('Colegio Otavalo')).toBeInTheDocument();

    const select = screen.getByRole('combobox');
    expect(within(select).getByText('Ibarra')).toBeInTheDocument();
    expect(within(select).getByText('Otavalo')).toBeInTheDocument();

    await user.selectOptions(select, '1');

    expect(screen.getByText('Escuela Manuela Cañizares')).toBeInTheDocument();
    expect(screen.queryByText('Colegio Otavalo')).not.toBeInTheDocument();
  });

  it('el botón "Ver ubicación" está deshabilitado si el CDA no tiene ubicación, y abre el modal si la tiene', async () => {
    getOperadoresMock.mockResolvedValue([]);
    getEstadoCdasMock.mockResolvedValue([cdaConUbicacionYFoto, cdaSinUbicacionNiFoto]);
    const user = userEvent.setup();

    renderPage();
    await screen.findByText('Escuela Manuela Cañizares');

    const botonesUbicacion = screen.getAllByRole('button', { name: 'Ver ubicación' });
    expect(botonesUbicacion[1]).toBeDisabled(); // fila sin ubicación (Colegio Otavalo)
    expect(botonesUbicacion[0]).toBeEnabled();

    await user.click(botonesUbicacion[0]);

    expect(screen.getByRole('heading', { name: 'Escuela Manuela Cañizares' })).toBeInTheDocument();
  });

  it('el botón "Ver foto" está deshabilitado sin foto de militar, y carga la imagen al abrir el modal', async () => {
    getOperadoresMock.mockResolvedValue([]);
    getEstadoCdasMock.mockResolvedValue([cdaConUbicacionYFoto, cdaSinUbicacionNiFoto]);
    getFotoMilitarMock.mockResolvedValue(new Blob(['fake'], { type: 'image/png' }));
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
    const user = userEvent.setup();

    renderPage();
    await screen.findByText('Escuela Manuela Cañizares');

    const botonesFoto = screen.getAllByRole('button', { name: 'Ver foto' });
    expect(botonesFoto[1]).toBeDisabled(); // Colegio Otavalo sin foto militar
    expect(botonesFoto[0]).toBeEnabled();

    await user.click(botonesFoto[0]);

    expect(await screen.findByAltText('Foto del militar')).toBeInTheDocument();
    expect(getFotoMilitarMock).toHaveBeenCalledWith('r1');
  });
});
