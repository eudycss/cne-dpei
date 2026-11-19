import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { PlanPerimetroDetalle, PlanPerimetroResumen } from '@cne/shared-types';

import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));
// El mapa (WebGL) se prueba aparte; aquí basta con saber qué plan recibe.
// "Mover el mapa" simula un desplazamiento: informa una vista nueva (10 m más al norte cada vez).
vi.mock('./MapaPlan', () => {
  let paso = 0;
  return {
    CENTRO_DELEGACION: [0.35849, -78.11886],
    MAX_MANIJAS_VALLAS: 300,
    MapaPlan: ({ plan, onVista }: { plan: PlanPerimetroDetalle; onVista?: (v: unknown) => void }) => (
      <div data-testid="mapa">
        {plan.nombre}
        <button
          type="button"
          onClick={() => {
            paso += 1;
            onVista?.({ lat: 0.35849 + paso * 0.00009, lng: -78.11886 + (paso % 2) * 0.00009, zoom: 18, bearing: 0, pitch: 0 });
          }}
        >
          Mover el mapa
        </button>
      </div>
    ),
  };
});
const permiso = vi.hoisted(() => ({ editar: true }));
const { excel } = vi.hoisted(() => ({ excel: vi.fn() }));
vi.mock('./exportarPlan', async (original) => ({ ...(await original<typeof import('./exportarPlan')>()), descargarExcel: excel }));
vi.mock('../../lib/useModulos', () => ({ useModulos: () => ({ puede: () => permiso.editar }) }));

import { PlanPerimetroPage } from './PlanPerimetroPage';

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
const putMock = api.put as unknown as ReturnType<typeof vi.fn>;
const deleteMock = api.delete as unknown as ReturnType<typeof vi.fn>;

const OP1 = '22222222-2222-4222-8222-222222222222';
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
    { id: 'pu-1', orden: 1, lat: 0.35, lng: -78.11, etiqueta: null, persona: { id: OP1, nombre: 'PÉREZ JUAN', tieneFoto: true } },
    { id: 'pu-2', orden: 2, lat: 0.351, lng: -78.11, etiqueta: null, persona: null },
  ],
  version: 0,
  actualizadoEn: '2026-11-18T10:00:00.000Z',
  avisos: ['PÉREZ JUAN también está en el plan «Delegación»'],
};

let planes: PlanPerimetroResumen[] = [];
const ANA = '44444444-4444-4444-8444-444444444444';
const LUIS = '55555555-5555-4555-8555-555555555555';
const CANDIDATOS = [
  { id: ANA, nombre: 'RUIZ ANA', enOtroPlan: false },
  { id: LUIS, nombre: 'MORA LUIS', enOtroPlan: true },
];

function renderPagina() {
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <PlanPerimetroPage />
      </QueryClientProvider>
    </MemoryRouter>,
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
      if (url === `/perimetro/planes/pl-1/personas/${OP1}/foto`) return Promise.resolve({ data: new Blob(['x']) });
      if (url === '/perimetro/cargos') return Promise.resolve({ data: [{ clave: 'DIGITADOR', nombre: 'Digitadores', centro: 'CPE' }] });
      if (url === '/perimetro/planes/pl-1/candidatos') return Promise.resolve({ data: CANDIDATOS });
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

  describe('edición', () => {
    async function entrarAEditar() {
      renderPagina();
      await userEvent.click(await screen.findByRole('button', { name: 'Editar plan' }));
      return within(screen.getByRole('complementary', { name: 'Editor del plan' }));
    }

    it('sin permiso no se puede editar', async () => {
      permiso.editar = false;
      renderPagina();
      await screen.findByTestId('mapa');
      expect(screen.queryByRole('button', { name: 'Editar plan' })).toBeNull();
    });

    it('mientras edita no se puede cambiar de evento ni de plan', async () => {
      await entrarAEditar();
      expect(screen.getByLabelText('Evento')).toBeDisabled();
      expect(screen.getByLabelText('Plan')).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    });

    it('dibuja el perímetro con el teclado (punto en el centro) y guarda con la versión leída', async () => {
      putMock.mockResolvedValue({ data: { ...PLAN, version: 1 } });
      const panel = await entrarAEditar();
      await userEvent.click(panel.getByRole('button', { name: 'Dibujar perímetro' }));
      const centro = panel.getByRole('button', { name: 'Punto en el centro del mapa' });
      expect(panel.getByRole('button', { name: 'Terminar' })).toBeDisabled();
      for (let i = 0; i < 3; i++) {
        await userEvent.click(screen.getByRole('button', { name: 'Mover el mapa' }));
        await userEvent.click(centro);
      }
      expect(panel.getByRole('status')).toHaveTextContent('3 puntos');
      await userEvent.click(panel.getByRole('button', { name: 'Terminar' }));
      expect(screen.getByText('Cambios sin guardar')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
      await waitFor(() => expect(putMock).toHaveBeenCalled());
      const [url, cuerpo] = putMock.mock.calls[0];
      expect(url).toBe('/perimetro/planes/pl-1');
      expect(cuerpo.version).toBe(0);
      expect(cuerpo.perimetro).toHaveLength(3);
      // La persona viaja solo como id.
      expect(cuerpo.puestos[0]).toEqual({ lat: 0.35, lng: -78.11, operadorCdaId: OP1, etiqueta: null });
      await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Editor del plan' })).toBeNull());
    });

    it('si otra persona guardó antes, avisa y permite recargar', async () => {
      putMock.mockRejectedValue({ response: { status: 409, data: { message: 'cambió' } } });
      await entrarAEditar();
      await userEvent.type(screen.getByLabelText('Nombre del plan'), ' 2');
      await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
      const alerta = await screen.findByRole('alert');
      expect(alerta).toHaveTextContent('Otra persona guardó este plan');
      await userEvent.click(within(alerta).getByRole('button', { name: 'Recargar el plan' }));
      await waitFor(() => expect(screen.queryByText(/Otra persona guardó/)).toBeNull());
      expect(screen.getByLabelText('Nombre del plan')).toHaveValue('Coliseo');
    });

    it('descartar pide confirmación y vuelve a la vista sin guardar nada', async () => {
      await entrarAEditar();
      await userEvent.type(screen.getByLabelText('Nombre del plan'), ' 2');
      await userEvent.click(screen.getByRole('button', { name: 'Descartar cambios' }));
      // El foco va a "No": un Enter de más no descarta.
      expect(screen.getByRole('button', { name: 'No' })).toHaveFocus();
      await userEvent.click(screen.getByRole('button', { name: 'No' }));
      expect(screen.getByLabelText('Nombre del plan')).toHaveValue('Coliseo 2');
      await userEvent.click(screen.getByRole('button', { name: 'Descartar cambios' }));
      await userEvent.click(screen.getByRole('button', { name: 'Sí, descartar' }));
      expect(screen.getByRole('button', { name: 'Editar plan' })).toBeInTheDocument();
      expect(putMock).not.toHaveBeenCalled();
    });

    it('Deshacer (botón y Ctrl+Z) y anuncios para el lector de pantalla', async () => {
      const panel = await entrarAEditar();
      const deshacer = screen.getByRole('button', { name: 'Deshacer' });
      expect(deshacer).toBeDisabled();
      await userEvent.click(panel.getByRole('tab', { name: 'Puestos' }));
      await userEvent.click(panel.getByRole('button', { name: 'Quitar el puesto 1' }));
      const anuncios = within(screen.getByRole('region', { name: 'Edición del plan' })).getByRole('status');
      expect(anuncios).toHaveTextContent('Puesto 1 quitado. Ctrl+Z para deshacer');
      expect(panel.queryByText('PÉREZ JUAN')).toBeNull();

      await userEvent.click(document.body);
      await userEvent.keyboard('{Control>}z{/Control}');
      expect(panel.getByText('PÉREZ JUAN')).toBeInTheDocument();
      expect(anuncios).toHaveTextContent('Se deshizo el último cambio');
      expect(deshacer).toBeDisabled();
    });

    it('repartir no acepta un total vacío', async () => {
      const panel = await entrarAEditar();
      await userEvent.click(panel.getByRole('tab', { name: 'Vallas' }));
      await userEvent.clear(panel.getByLabelText('Total de vallas'));
      expect(panel.getByRole('button', { name: 'Repartir en el perímetro' })).toBeDisabled();
    });

    it('guardar después de un refetch usa la versión con la que entró a editar', async () => {
      putMock.mockRejectedValue({ response: { status: 409 } });
      await entrarAEditar();
      await userEvent.type(screen.getByLabelText('Nombre del plan'), ' 2');
      await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
      await screen.findByText(/Otra persona guardó/);
      expect(putMock.mock.calls[0][1].version).toBe(0);
      // Mientras haya conflicto no se vuelve a guardar a ciegas.
      expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    });

    it('borrar pide confirmación antes de llamar al API', async () => {
      deleteMock.mockResolvedValue({ data: { id: 'pl-1' } });
      await entrarAEditar();
      await userEvent.click(screen.getByRole('button', { name: 'Borrar plan' }));
      expect(deleteMock).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'Sí, borrar' }));
      await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/perimetro/planes/pl-1'));
    });

    it('en Puestos, quitar uno y poner nombre libre a uno vacío', async () => {
      putMock.mockResolvedValue({ data: PLAN });
      const panel = await entrarAEditar();
      await userEvent.click(panel.getByRole('tab', { name: 'Puestos' }));
      await userEvent.type(panel.getByLabelText('Nombre libre del puesto 2'), 'Policía 1');
      await userEvent.click(panel.getByRole('button', { name: 'Quitar el puesto 1' }));
      expect(panel.getByLabelText('Nombre libre del puesto 1')).toHaveValue('Policía 1');
      await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
      await waitFor(() => expect(putMock).toHaveBeenCalled());
      expect(putMock.mock.calls[0][1].puestos).toEqual([{ lat: 0.351, lng: -78.11, operadorCdaId: null, etiqueta: 'Policía 1' }]);
    });
  });

  describe('personal y exportación', () => {
    async function abrirPuestos() {
      renderPagina();
      await userEvent.click(await screen.findByRole('button', { name: 'Editar plan' }));
      const panel = within(screen.getByRole('complementary', { name: 'Editor del plan' }));
      await userEvent.click(panel.getByRole('tab', { name: 'Puestos' }));
      return panel;
    }

    it('asigna a mano desde el buscador: solo nombres, con aviso si ya está en otro plan', async () => {
      putMock.mockResolvedValue({ data: PLAN });
      const panel = await abrirPuestos();
      await userEvent.click(panel.getByRole('button', { name: 'Asignar persona al puesto 2' }));
      const selector = within(panel.getByRole('group', { name: 'Asignar persona al puesto 2' }));
      expect(await selector.findByRole('button', { name: /MORA LUIS · ya está en otro plan/ })).toBeInTheDocument();
      // El buscador consulta con los filtros elegidos.
      await userEvent.selectOptions(selector.getByLabelText('Centro'), 'CPE');
      await waitFor(() =>
        expect(getMock).toHaveBeenCalledWith('/perimetro/planes/pl-1/candidatos', { params: { centro: 'CPE' } }),
      );
      await userEvent.click(await selector.findByRole('button', { name: 'RUIZ ANA' }));
      expect(panel.getByText('RUIZ ANA')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
      await waitFor(() => expect(putMock).toHaveBeenCalled());
      expect(putMock.mock.calls[0][1].puestos.map((x: { operadorCdaId: string | null }) => x.operadorCdaId)).toEqual([OP1, ANA]);
    });

    it('Esc cierra el buscador y el foco vuelve al botón de ese puesto', async () => {
      const panel = await abrirPuestos();
      const boton = panel.getByRole('button', { name: 'Asignar persona al puesto 2' });
      await userEvent.click(boton);
      expect(boton).toHaveAttribute('aria-expanded', 'true');
      await userEvent.keyboard('{Escape}');
      expect(panel.queryByRole('group', { name: 'Asignar persona al puesto 2' })).toBeNull();
      await waitFor(() => expect(boton).toHaveFocus());
    });

    it('con más de 100 coincidencias pide afinar la búsqueda', async () => {
      const muchos = Array.from({ length: 101 }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        nombre: `PERSONA ${i}`,
        enOtroPlan: false,
      }));
      getMock.mockImplementation((url: string) => {
        if (url === '/perimetro/planes/pl-1/candidatos') return Promise.resolve({ data: muchos });
        if (url === '/eventos') return Promise.resolve({ data: [EV_ACTIVO] });
        if (url === '/perimetro/planes') return Promise.resolve({ data: [RESUMEN] });
        if (url === '/perimetro/planes/pl-1') return Promise.resolve({ data: PLAN });
        if (url === '/perimetro/cargos') return Promise.resolve({ data: [] });
        return Promise.reject(new Error(url));
      });
      const panel = await abrirPuestos();
      await userEvent.click(panel.getByRole('button', { name: 'Asignar persona al puesto 2' }));
      expect(await panel.findByText(/Mostrando las primeras 100/)).toBeInTheDocument();
      expect(panel.getAllByRole('button', { name: /^PERSONA \d+$/ })).toHaveLength(100);
    });

    it('completar puestos vacíos pide la propuesta con el % y los ya asignados, y la pone en el borrador', async () => {
      postMock.mockResolvedValue({ data: { personas: [{ id: LUIS, nombre: 'MORA LUIS', enOtroPlan: true }], faltan: 0 } });
      const panel = await abrirPuestos();
      await userEvent.clear(panel.getByLabelText('% de mujeres'));
      await userEvent.type(panel.getByLabelText('% de mujeres'), '40');
      await userEvent.click(panel.getByRole('button', { name: 'Completar 1 puesto vacío' }));
      await waitFor(() => expect(postMock).toHaveBeenCalled());
      expect(postMock).toHaveBeenCalledWith('/perimetro/planes/pl-1/propuesta', { total: 1, pctMujeres: 40, excluir: [OP1] });
      expect(await panel.findByText('MORA LUIS')).toBeInTheDocument();
      expect(panel.getByText(/1 ya están en otro plan de este evento/)).toBeInTheDocument();
    });

    it('Descargar Excel está fuera de la edición, también para quien solo consulta', async () => {
      permiso.editar = false;
      renderPagina();
      await userEvent.click(await screen.findByRole('button', { name: /Descargar Excel/ }));
      expect(excel).toHaveBeenCalledWith(expect.objectContaining({ id: 'pl-1' }));
      expect(screen.getByRole('button', { name: /Imprimir/ })).toBeInTheDocument();
    });
  });
});
