import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PlanPerimetroDetalle, PlanPerimetroResumen } from '@cne/shared-types';

import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));
// El mapa (WebGL) se prueba aparte; aquí basta con saber qué plan recibe.
vi.mock('./MapaPlan', () => ({
  CENTRO_DELEGACION: [0.35849, -78.11886],
  MapaPlan: ({ plan }: { plan: PlanPerimetroDetalle }) => <div data-testid="mapa">{plan.nombre}</div>,
}));
const permiso = vi.hoisted(() => ({ editar: true }));
vi.mock('../../lib/useModulos', () => ({ useModulos: () => ({ puede: () => permiso.editar }) }));

import { PlanPerimetroPage } from './PlanPerimetroPage';

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

const EV_ACTIVO = { id: 'ev-1', nombre: 'Elecciones 2027', estado: 'ACTIVO' };
const EV_CERRADO = { id: 'ev-0', nombre: 'Consulta 2025', estado: 'CERRADO' };
const RESUMEN: PlanPerimetroResumen = {
  id: 'pl-1',
  eventoId: 'ev-1',
  nombre: 'Coliseo',
  lugar: null,
  puestos: 2,
  puestosConPersona: 1,
  actualizadoEn: '2026-11-18T10:00:00.000Z',
};
const PLAN: PlanPerimetroDetalle = {
  id: 'pl-1',
  eventoId: 'ev-1',
  nombre: 'Coliseo',
  lugar: null,
  perimetro: null,
  zonas: [],
  vallas: [],
  ajustes: { pctMujeres: 50, largoValla: 2.5, mostrarNombres: true, alinearVallas: true },
  vista: null,
  puestos: [
    { id: 'pu-1', orden: 1, lat: 0.35, lng: -78.11, etiqueta: null, persona: { id: 'op-1', nombre: 'PÉREZ JUAN', tieneFoto: true } },
    { id: 'pu-2', orden: 2, lat: 0.351, lng: -78.11, etiqueta: null, persona: null },
  ],
  version: 0,
  actualizadoEn: '2026-11-18T10:00:00.000Z',
  avisos: ['PÉREZ JUAN también está en el plan «Delegación»'],
};

let planes: PlanPerimetroResumen[] = [];

function renderPagina() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PlanPerimetroPage />
    </QueryClientProvider>,
  );
}

describe('PlanPerimetroPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permiso.editar = true;
    planes = [RESUMEN];
    URL.createObjectURL = vi.fn(() => 'blob:foto');
    URL.revokeObjectURL = vi.fn();
    getMock.mockImplementation((url: string) => {
      if (url === '/eventos') return Promise.resolve({ data: [EV_CERRADO, EV_ACTIVO] });
      if (url === '/perimetro/planes') return Promise.resolve({ data: planes });
      if (url === '/perimetro/planes/pl-1') return Promise.resolve({ data: PLAN });
      if (url === '/perimetro/planes/pl-1/personas/op-1/foto') return Promise.resolve({ data: new Blob(['x']) });
      return Promise.reject(new Error(url));
    });
  });

  it('abre el evento activo y su primer plan, con avisos y la lista de puestos', async () => {
    renderPagina();
    expect(await screen.findByTestId('mapa')).toHaveTextContent('Coliseo');
    expect(screen.getByLabelText('Evento')).toHaveValue('ev-1');
    expect(getMock).toHaveBeenCalledWith('/perimetro/planes', { params: { eventoId: 'ev-1' } });
    expect(screen.getByRole('status')).toHaveTextContent('también está en el plan «Delegación»');
    const lista = within(screen.getByRole('complementary', { name: 'Puestos del plan' }));
    expect(lista.getByRole('button', { name: /PÉREZ JUAN/ })).toBeInTheDocument();
    expect(lista.getByRole('button', { name: /Sin asignar/ })).toBeInTheDocument();
  });

  it('al elegir un puesto muestra solo el nombre y la foto de la persona', async () => {
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: /PÉREZ JUAN/ }));
    const tarjeta = screen.getByRole('region', { name: 'Puesto 1' });
    expect(tarjeta).toHaveTextContent('PÉREZ JUAN');
    expect(await within(tarjeta).findByRole('img', { name: 'Foto de PÉREZ JUAN' })).toHaveAttribute('src', 'blob:foto');
    await userEvent.click(within(tarjeta).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('region', { name: 'Puesto 1' })).toBeNull();
  });

  it('un puesto sin persona no pide foto', async () => {
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: /Sin asignar/ }));
    expect(screen.getByRole('region', { name: 'Puesto 2' })).toHaveTextContent('Sin asignar');
    expect(getMock.mock.calls.some(([url]) => String(url).endsWith('/foto'))).toBe(false);
  });

  it('evento sin planes: lo dice y no muestra el mapa', async () => {
    planes = [];
    renderPagina();
    expect(await screen.findByText('Este evento todavía no tiene planes de perímetro.')).toBeInTheDocument();
    expect(screen.queryByTestId('mapa')).toBeNull();
  });

  it('crea un plan centrado en la Delegación', async () => {
    planes = [];
    postMock.mockResolvedValue({ data: PLAN });
    renderPagina();
    await userEvent.type(await screen.findByLabelText('Nombre del plan nuevo'), '  Coliseo  ');
    await userEvent.click(screen.getByRole('button', { name: 'Crear plan' }));
    await waitFor(() => expect(postMock).toHaveBeenCalled());
    expect(postMock).toHaveBeenCalledWith('/perimetro/planes', {
      eventoId: 'ev-1',
      nombre: 'Coliseo',
      vista: { lat: 0.35849, lng: -78.11886, zoom: 17, bearing: 0, pitch: 60 },
    });
  });

  it('sin permiso de edición no ofrece crear', async () => {
    permiso.editar = false;
    renderPagina();
    await screen.findByTestId('mapa');
    expect(screen.queryByRole('button', { name: 'Crear plan' })).toBeNull();
  });

  it('en un evento cerrado no ofrece crear aunque tenga permiso', async () => {
    renderPagina();
    await screen.findByTestId('mapa');
    expect(screen.getByRole('button', { name: 'Crear plan' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Evento'), 'ev-0');
    expect(screen.queryByRole('button', { name: 'Crear plan' })).toBeNull();
  });

  it('al crear abre el plan nuevo aunque la lista tarde en refrescarse', async () => {
    const ZETA = { ...RESUMEN, id: 'pl-2', nombre: 'Zeta' };
    let llamadasLista = 0;
    getMock.mockImplementation((url: string) => {
      if (url === '/eventos') return Promise.resolve({ data: [EV_ACTIVO] });
      if (url === '/perimetro/planes') {
        llamadasLista += 1;
        if (llamadasLista === 1) return Promise.resolve({ data: [RESUMEN] });
        return new Promise((r) => setTimeout(() => r({ data: [RESUMEN, ZETA] }), 50));
      }
      if (url === '/perimetro/planes/pl-1') return Promise.resolve({ data: PLAN });
      if (url === '/perimetro/planes/pl-2') return Promise.resolve({ data: { ...PLAN, id: 'pl-2', nombre: 'Zeta' } });
      return Promise.reject(new Error(url));
    });
    postMock.mockResolvedValue({ data: { ...PLAN, id: 'pl-2', nombre: 'Zeta' } });
    renderPagina();
    expect(await screen.findByTestId('mapa')).toHaveTextContent('Coliseo');
    await userEvent.type(screen.getByLabelText('Nombre del plan nuevo'), 'Zeta');
    await userEvent.click(screen.getByRole('button', { name: 'Crear plan' }));
    await waitFor(() => expect(screen.getByTestId('mapa')).toHaveTextContent('Zeta'));
  });

  it('avisa si no se pudieron cargar los eventos o los planes', async () => {
    getMock.mockImplementation((url: string) => {
      if (url === '/eventos') return Promise.resolve({ data: [EV_ACTIVO] });
      return Promise.reject(new Error(url));
    });
    renderPagina();
    expect(await screen.findByText('No se pudieron cargar los planes de este evento.')).toBeInTheDocument();
  });

  it('sin eventos por error, lo dice', async () => {
    getMock.mockRejectedValue(new Error('500'));
    renderPagina();
    expect(await screen.findByText('No se pudieron cargar los eventos.')).toBeInTheDocument();
  });
});
