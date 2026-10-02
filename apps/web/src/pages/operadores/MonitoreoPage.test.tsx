import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CdaEstadoDto, OperadorEnRetorno } from '@cne/shared-types';

import { MonitoreoPage } from './MonitoreoPage';
import { getEstadoCdas, getFotoActa, getFotoMilitar, getOperadoresEnRetorno } from '../../lib/queries/monitoreo';

vi.mock('../../lib/queries/monitoreo', () => ({
  getOperadoresEnRetorno: vi.fn(),
  getEstadoCdas: vi.fn(),
  getFotoMilitar: vi.fn(),
  getFotoActa: vi.fn(),
}));

const flyToMock = vi.fn();
vi.mock('../../components/map', () => ({
  MapView: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Marker: ({
    children,
    color,
    pulse,
    offset,
  }: {
    children?: React.ReactNode;
    color?: string;
    pulse?: boolean;
    offset?: [number, number];
  }) => (
    <div
      data-testid="marker"
      data-color={color}
      data-pulse={String(!!pulse)}
      data-offset={JSON.stringify(offset ?? null)}
    >
      {children}
    </div>
  ),
  FitBounds: () => null,
  FlyTo: (props: { target: [number, number] | null; nonce: number }) => {
    flyToMock(props);
    return null;
  },
}));

vi.mock('slot-text/react', () => ({
  SlotText: ({ text }: { text: string }) => <>{text}</>,
}));

const getOperadoresMock = getOperadoresEnRetorno as unknown as ReturnType<typeof vi.fn>;
const getEstadoCdasMock = getEstadoCdas as unknown as ReturnType<typeof vi.fn>;
const getFotoMilitarMock = getFotoMilitar as unknown as ReturnType<typeof vi.fn>;
const getFotoActaMock = getFotoActa as unknown as ReturnType<typeof vi.fn>;

const operadorRetorno: OperadorEnRetorno = {
  operadorId: 'op1',
  operadorNombre: 'Juan Pérez',
  latitud: 0.35,
  longitud: -78.12,
  capturadoEn: '2026-07-01T10:00:00.000Z',
  kits: [{ id: 'k1', codigoUnico: 'KIT-001', nombre: 'Kit A' }],
  estado: 'EN_RETORNO',
};

const operadorTransito: OperadorEnRetorno = {
  operadorId: 'op3',
  operadorNombre: 'Carla Suárez',
  latitud: 0.36,
  longitud: -78.13,
  capturadoEn: '2026-07-01T09:30:00.000Z',
  kits: [],
  estado: 'EN_TRANSITO',
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
  tieneActaInstalacion: true,
  tieneActaEscrutinio: false,
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
  tieneActaInstalacion: false,
  tieneActaEscrutinio: false,
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

    expect(screen.getAllByText(/^Cargando/).length).toBeGreaterThan(0);
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

    expect(
      await screen.findByText('No hay operadores en tránsito ni en retorno en este momento.'),
    ).toBeInTheDocument();
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

  it('diferencia visualmente a un operador en tránsito de uno en retorno', async () => {
    getOperadoresMock.mockResolvedValue([operadorRetorno, operadorTransito]);
    getEstadoCdasMock.mockResolvedValue([]);

    renderPage();

    const filaRetorno = (await screen.findAllByText('Juan Pérez'))
      .map((el) => el.closest('li'))
      .find((li): li is HTMLLIElement => li !== null)!;
    const filaTransito = screen
      .getAllByText('Carla Suárez')
      .map((el) => el.closest('li'))
      .find((li): li is HTMLLIElement => li !== null)!;

    expect(within(filaRetorno).getByText(/En retorno/)).toBeInTheDocument();
    expect(within(filaTransito).getByText(/En tránsito/)).toBeInTheDocument();
  });

  describe('mapa en ruta', () => {
    const AHORA = new Date('2026-10-01T17:15:00.000Z');
    const jairo: OperadorEnRetorno = {
      operadorId: 'jairo',
      operadorNombre: 'Jairo Leal',
      latitud: 0.2315582,
      longitud: -78.6282684,
      capturadoEn: '2026-10-01T16:48:00.000Z', // 27 min antes
      kits: [],
      estado: 'EN_TRANSITO',
    };
    const willy: OperadorEnRetorno = {
      operadorId: 'willy',
      operadorNombre: 'Willy Paspuel',
      latitud: 0.2315933,
      longitud: -78.6283783,
      capturadoEn: '2026-10-01T17:14:30.000Z', // en vivo
      kits: [],
      estado: 'EN_RETORNO',
    };

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      vi.setSystemTime(AHORA);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('marca "sin señal" a quien dejó de enviar ubicación, en gris y sin pulso', async () => {
      getOperadoresMock.mockResolvedValue([jairo, willy]);
      getEstadoCdasMock.mockResolvedValue([]);

      renderPage();

      expect((await screen.findAllByText('Sin señal hace 27 min')).length).toBe(2); // lista + popup
      const [markerJairo, markerWilly] = screen.getAllByTestId('marker');
      expect(markerJairo).toHaveAttribute('data-color', '#6b7280');
      expect(markerJairo).toHaveAttribute('data-pulse', 'false');
      expect(markerWilly).toHaveAttribute('data-color', '#2563eb');
      expect(markerWilly).toHaveAttribute('data-pulse', 'true');
      expect(within(markerWilly).queryByText(/Sin señal/)).not.toBeInTheDocument();
    });

    it('pasa a "sin señal" con el paso del tiempo aunque los datos no cambien', async () => {
      getOperadoresMock.mockResolvedValue([willy]);
      getEstadoCdasMock.mockResolvedValue([]);

      renderPage();

      await screen.findAllByText('Willy Paspuel');
      expect(screen.queryByText(/Sin señal/)).not.toBeInTheDocument();

      // Willy envió su última posición 30 s antes; 10 min después sigue igual.
      act(() => {
        vi.advanceTimersByTime(10 * 60_000);
      });

      expect((await screen.findAllByText('Sin señal hace 10 min')).length).toBe(2);
    });

    it('separa los marcadores de dos operadores en el mismo punto', async () => {
      getOperadoresMock.mockResolvedValue([jairo, willy]);
      getEstadoCdasMock.mockResolvedValue([]);

      renderPage();

      await screen.findAllByText('Jairo Leal');
      const offsets = screen.getAllByTestId('marker').map((m) => m.getAttribute('data-offset'));
      expect(offsets[0]).not.toBe('[0,0]');
      expect(offsets[0]).not.toBe(offsets[1]);
    });

    it('al seleccionar un operador de la lista centra el mapa en su posición', async () => {
      getOperadoresMock.mockResolvedValue([jairo, willy]);
      getEstadoCdasMock.mockResolvedValue([]);
      const user = userEvent.setup();

      renderPage();

      const boton = (await screen.findAllByRole('button')).find((b) =>
        b.textContent?.includes('Jairo Leal'),
      )!;
      await user.click(boton);

      expect(flyToMock).toHaveBeenLastCalledWith({ target: [0.2315582, -78.6282684], nonce: 1 });
    });
  });

  it('el filtro por estado filtra la tabla; las tarjetas cuentan según el cantón', async () => {
    getOperadoresMock.mockResolvedValue([]);
    getEstadoCdasMock.mockResolvedValue([cdaConUbicacionYFoto, cdaSinUbicacionNiFoto]);
    const user = userEvent.setup();

    renderPage();
    await screen.findByText('Escuela Manuela Cañizares');

    expect(screen.getByRole('meter', { name: /^CDAs que llegaron al DPEI/ })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );

    await user.click(screen.getByRole('radio', { name: /Llegó al DPEI/ }));
    expect(screen.queryByText('Escuela Manuela Cañizares')).not.toBeInTheDocument();
    expect(screen.getByText('Colegio Otavalo')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /En tránsito/ }));
    expect(screen.getByText('Ningún CDA coincide con los filtros elegidos')).toBeInTheDocument();

    // Con el cantón Ibarra (solo el CDA en retorno), nadie llegó todavía.
    await user.click(screen.getByRole('radio', { name: /Todos/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filtrar CDAs por cantón' }), '1');
    expect(screen.getByRole('meter', { name: /^CDAs que llegaron al DPEI/ })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
  });

  it('tabla de CDAs accesible: estado legible, filtro con nombre y primera columna fija', async () => {
    getOperadoresMock.mockResolvedValue([]);
    getEstadoCdasMock.mockResolvedValue([cdaConUbicacionYFoto, cdaSinUbicacionNiFoto]);

    renderPage();

    const fila = (await screen.findByText('Escuela Manuela Cañizares')).closest('tr')!;
    // El texto completo para el lector de pantalla; la animación queda oculta.
    const estado = within(fila).getByText('En retorno', { selector: '.sr-only' });
    expect(estado.nextElementSibling).toHaveAttribute('aria-hidden', 'true');

    expect(screen.getByRole('combobox', { name: 'Filtrar CDAs por cantón' })).toBeInTheDocument();
    expect(fila.closest('table')).toHaveClass('table-sticky-first');
    expect(fila.closest('.table-scroll')).not.toBeNull();

    // El motivo de cada botón desactivado.
    const filaSin = screen.getByText('Colegio Otavalo').closest('tr')!;
    expect(
      within(filaSin).getByRole('button', {
        name: 'Ver foto',
        description: 'El operador aún no subió la foto del militar',
      }),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('region', { name: 'Tabla de estado de CDAs' })).toHaveAttribute('tabindex', '0');
  });

  it('el botón "Ver ubicación" está deshabilitado si el CDA no tiene ubicación, y abre el modal si la tiene', async () => {
    getOperadoresMock.mockResolvedValue([]);
    getEstadoCdasMock.mockResolvedValue([cdaConUbicacionYFoto, cdaSinUbicacionNiFoto]);
    const user = userEvent.setup();

    renderPage();
    await screen.findByText('Escuela Manuela Cañizares');

    const botonesUbicacion = screen.getAllByRole('button', { name: 'Ver ubicación' });
    expect(botonesUbicacion[1]).toHaveAttribute('aria-disabled', 'true'); // fila sin ubicación (Colegio Otavalo)
    expect(botonesUbicacion[0]).not.toHaveAttribute('aria-disabled');

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
    expect(botonesFoto[1]).toHaveAttribute('aria-disabled', 'true'); // Colegio Otavalo sin foto militar
    expect(botonesFoto[0]).not.toHaveAttribute('aria-disabled');

    await user.click(botonesFoto[0]);

    expect(await screen.findByAltText('Foto del militar')).toBeInTheDocument();
    expect(getFotoMilitarMock).toHaveBeenCalledWith('r1');
  });

  it('los botones "Ver acta" respetan tieneActaInstalacion/tieneActaEscrutinio, y cargan la imagen correcta', async () => {
    getOperadoresMock.mockResolvedValue([]);
    getEstadoCdasMock.mockResolvedValue([cdaConUbicacionYFoto, cdaSinUbicacionNiFoto]);
    getFotoActaMock.mockResolvedValue(new Blob(['fake'], { type: 'image/png' }));
    global.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = vi.fn();
    const user = userEvent.setup();

    renderPage();
    await screen.findByText('Escuela Manuela Cañizares');

    const filaConActas = screen.getByText('Escuela Manuela Cañizares').closest('tr')!;
    const filaSinActas = screen.getByText('Colegio Otavalo').closest('tr')!;

    // Escuela Manuela Cañizares: solo tiene acta de instalación (fixture).
    // Cada botón tiene un aria-label distinto para que sea identificable con lector de pantalla.
    const botonInstalacion1 = within(filaConActas).getByRole('button', {
      name: 'Ver acta de instalación — Escuela Manuela Cañizares',
    });
    const botonEscrutinio1 = within(filaConActas).getByRole('button', {
      name: 'Ver acta de escrutinio — Escuela Manuela Cañizares',
    });
    expect(botonInstalacion1).not.toHaveAttribute('aria-disabled');
    expect(botonEscrutinio1).toHaveAttribute('aria-disabled', 'true');

    // Colegio Otavalo: no tiene ninguna de las dos.
    expect(
      within(filaSinActas).getByRole('button', { name: 'Ver acta de instalación — Colegio Otavalo' }),
    ).toHaveAttribute('aria-disabled', 'true');
    expect(
      within(filaSinActas).getByRole('button', { name: 'Ver acta de escrutinio — Colegio Otavalo' }),
    ).toHaveAttribute('aria-disabled', 'true');

    await user.click(botonInstalacion1);

    expect(await screen.findByRole('heading', { name: 'Acta de instalación' })).toBeInTheDocument();
    expect(getFotoActaMock).toHaveBeenCalledWith('r1', 'instalacion');
  });
});
