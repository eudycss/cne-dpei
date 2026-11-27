import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import type { KitCustodiaResponse, MilitarResumen } from '@cne/shared-types';

import { EntregaMilitarPage } from './EntregaMilitarPage';
import * as q from '../../lib/queries/custodia';

vi.mock('../../lib/queries/custodia', () => ({
  getResumenCustodia: vi.fn(),
  validarKitCustodia: vi.fn(),
  registrarEntrega: vi.fn(),
  corregirMilitar: vi.fn(),
  cambiarOperador: vi.fn(),
  buscarMilitares: vi.fn(),
  buscarOperadores: vi.fn(),
}));
// La cámara real no existe en jsdom: botones simulan leer un QR o que falle.
vi.mock('../operadores-cda/CamaraQr', () => ({
  CamaraQr: ({ onLeido, onError, pausado }: { onLeido: (c: string) => void; onError: (m: string) => void; pausado?: boolean }) => (
    <div>
      <span>{pausado ? 'cámara en pausa' : 'cámara leyendo'}</span>
      <button type="button" onClick={() => onLeido('p2zcerv4')}>
        leer QR
      </button>
      <button type="button" onClick={() => onLeido('https://otra-cosa.com')}>
        leer otro QR
      </button>
      <button type="button" onClick={() => onError('El navegador no dio permiso para usar la cámara')}>
        fallar cámara
      </button>
    </div>
  ),
}));

const m = vi.mocked(q);

const militar = (id: string, recintoId = 'r1', extra: Partial<MilitarResumen> = {}): MilitarResumen => ({
  id,
  cedula: `100000000${id.slice(-1)}`,
  nombres: `Juan ${id}`,
  apellidos: 'Pérez',
  grado: 'SGOP',
  recintoId,
  recintoNombre: recintoId === 'r1' ? 'UE Atahualpa' : 'UE Otra',
  ...extra,
});

const kit = (extra: Partial<KitCustodiaResponse> = {}): KitCustodiaResponse => ({
  kitId: 'kit-1',
  codigoUnico: 'P2ZCERV4',
  nombre: 'Kit Recinto 1440',
  estado: 'ASIGNADO',
  recinto: { id: 'r1', codigo: '1440', nombre: 'UE Atahualpa' },
  operador: { id: 'o1', cedula: '1002003004', nombres: 'Ana', apellidos: 'Ruiz' },
  militaresRecinto: [militar('m1')],
  entrega: null,
  editable: true,
  ...extra,
});

const entregado = (militarId = 'm1') =>
  kit({
    entrega: {
      militar: militar(militarId),
      entregadoEn: '2026-11-28T13:00:00Z',
      entregadoPorNombre: 'Asistente Uno',
      militarDeOtroRecinto: false,
    },
  });

function renderPagina() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <EntregaMilitarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('EntregaMilitarPage (entrega a militares desde el celular)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.getResumenCustodia.mockResolvedValue({ entregados: 3, total: 10 });
  });

  it('muestra el avance del evento', async () => {
    renderPagina();
    expect(await screen.findByLabelText('Kits entregados a militares: 3 de 10')).toHaveTextContent('3 / 10kits entregados a militares');
  });

  it('escanear → el único militar del recinto queda propuesto → registrar entrega', async () => {
    m.validarKitCustodia.mockResolvedValueOnce(kit()).mockResolvedValueOnce(entregado());
    m.registrarEntrega.mockResolvedValue(entregado().entrega!);
    renderPagina();

    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    expect(m.validarKitCustodia).toHaveBeenCalledWith('P2ZCERV4');
    expect(await screen.findByRole('heading', { name: 'Kit P2ZCERV4' })).toHaveFocus();
    expect(screen.getByText('cámara en pausa')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Pérez Juan m1/ })).toBeChecked();

    await userEvent.click(screen.getByRole('button', { name: 'Registrar entrega' }));
    expect(m.registrarEntrega).toHaveBeenCalledWith({ kitId: 'kit-1', militarId: 'm1' });
    expect(await screen.findByText('Entrega registrada: kit P2ZCERV4 a Pérez Juan m1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cambiar militar' })).toBeInTheDocument();
    expect(m.getResumenCustodia).toHaveBeenCalledTimes(2);

    await userEvent.click(screen.getByRole('button', { name: 'Escanear otro kit' }));
    expect(screen.getByRole('heading', { name: 'Entregar kit a militar' })).toHaveFocus();
    expect(screen.getByText('cámara leyendo')).toBeInTheDocument();
  });

  it('con varios militares no propone ninguno: hay que elegir antes de registrar', async () => {
    m.validarKitCustodia.mockResolvedValue(kit({ militaresRecinto: [militar('m1'), militar('m2')] }));
    renderPagina();
    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    const boton = await screen.findByRole('button', { name: 'Registrar entrega' });
    expect(boton).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: /Pérez Juan m2/ }));
    expect(boton).toBeEnabled();
  });

  it('busca un militar de otro recinto y lo marca con aviso', async () => {
    m.validarKitCustodia.mockResolvedValue(kit({ militaresRecinto: [] }));
    m.buscarMilitares.mockResolvedValue([militar('m9', 'r2')]);
    m.registrarEntrega.mockResolvedValue(entregado('m9').entrega!);
    renderPagina();
    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    await userEvent.type(await screen.findByRole('searchbox', { name: /Otro militar/ }), 'Pér');
    const opcion = await screen.findByRole('radio', { name: /Pérez Juan m9.*De otro recinto/ });
    expect(m.buscarMilitares).toHaveBeenCalledWith('Pér');
    await userEvent.click(opcion);
    await userEvent.click(screen.getByRole('button', { name: 'Registrar entrega' }));
    expect(m.registrarEntrega).toHaveBeenCalledWith({ kitId: 'kit-1', militarId: 'm9' });
  });

  it('cambiar el militar exige un motivo de al menos 5 caracteres', async () => {
    m.validarKitCustodia.mockResolvedValue(entregado());
    m.corregirMilitar.mockResolvedValue(entregado('m2').entrega!);
    renderPagina();
    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cambiar militar' }));
    // El militar que ya tiene el kit no se ofrece.
    expect(screen.queryByRole('radio', { name: /Pérez Juan m1/ })).not.toBeInTheDocument();
    m.buscarMilitares.mockResolvedValue([militar('m1'), militar('m2')]);
    await userEvent.type(screen.getByRole('searchbox', { name: /Otro militar/ }), 'Pérez');
    await userEvent.click(await screen.findByRole('radio', { name: /Pérez Juan m2/ }));
    expect(screen.queryByRole('radio', { name: /Pérez Juan m1/ })).not.toBeInTheDocument();
    const guardar = screen.getByRole('button', { name: 'Guardar cambio de militar' });
    await userEvent.type(screen.getByRole('textbox', { name: /Motivo del cambio/ }), 'cam');
    expect(guardar).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: /Motivo del cambio/ }), 'bio');
    expect(guardar).toBeEnabled();
    await userEvent.click(guardar);
    expect(m.corregirMilitar).toHaveBeenCalledWith('kit-1', { militarId: 'm2', motivo: 'cambio' });
  });

  it('cambia el operador CDA buscándolo, con motivo', async () => {
    m.validarKitCustodia.mockResolvedValue(kit());
    m.buscarOperadores.mockResolvedValue([{ id: 'o2', cedula: '1009998887', nombres: 'Luis', apellidos: 'Mora' }]);
    m.cambiarOperador.mockResolvedValue({ id: 'o2', cedula: '1009998887', nombres: 'Luis', apellidos: 'Mora' });
    renderPagina();
    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cambiar operador' }));
    await userEvent.type(screen.getByRole('searchbox', { name: /Buscar operador/ }), 'Mora');
    await userEvent.click(await screen.findByRole('radio', { name: /Mora Luis/ }));
    // Aunque se cambie la búsqueda, quien está elegido sigue a la vista.
    m.buscarOperadores.mockResolvedValue([]);
    await userEvent.clear(screen.getByRole('searchbox', { name: /Buscar operador/ }));
    expect(screen.getByRole('radio', { name: /Mora Luis/ })).toBeChecked();
    await userEvent.type(screen.getByRole('textbox', { name: /Motivo del cambio/ }), 'Reemplazo');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambio de operador' }));
    expect(m.cambiarOperador).toHaveBeenCalledWith('kit-1', { operadorId: 'o2', motivo: 'Reemplazo' });
    expect(await screen.findByText('Operador cambiado a Mora Luis')).toBeInTheDocument();
  });

  it('un kit ya recibido por el CDA no se puede corregir', async () => {
    m.validarKitCustodia.mockResolvedValue({ ...entregado(), editable: false });
    renderPagina();
    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    expect(await screen.findByText(/ya recibió este kit/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cambiar militar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cambiar operador' })).not.toBeInTheDocument();
  });

  it('un QR que no es de kit, o un kit inválido, avisa sin texto técnico', async () => {
    m.validarKitCustodia.mockRejectedValue({ response: { status: 404, data: { message: 'Kit no encontrado' } } });
    renderPagina();
    await userEvent.click(screen.getByRole('button', { name: 'leer otro QR' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Ese código no es de un kit');
    expect(m.validarKitCustodia).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Kit no encontrado'));
    // La cámara no repite enseguida el mismo kit que no existe.
    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    expect(m.validarKitCustodia).toHaveBeenCalledTimes(1);
  });

  it('con un error de red la cámara tampoco repite enseguida, pero a mano sí se reintenta', async () => {
    m.validarKitCustodia.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValueOnce(kit());
    renderPagina();
    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Revise la conexión');
    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    expect(m.validarKitCustodia).toHaveBeenCalledTimes(1);
    await userEvent.type(screen.getByRole('textbox', { name: 'O escriba el código del kit' }), 'P2ZCERV4');
    await userEvent.click(screen.getByRole('button', { name: 'Validar' }));
    expect(await screen.findByRole('heading', { name: 'Kit P2ZCERV4' })).toBeInTheDocument();
  });

  it('lecturas seguidas del mismo QR validan una sola vez, y tras "Escanear otro kit" no lo reabre enseguida', async () => {
    let resolver!: (k: KitCustodiaResponse) => void;
    m.validarKitCustodia.mockReturnValueOnce(new Promise((ok) => (resolver = ok)));
    renderPagina();
    const leer = screen.getByRole('button', { name: 'leer QR' });
    await userEvent.click(leer);
    await userEvent.click(leer);
    expect(m.validarKitCustodia).toHaveBeenCalledTimes(1);
    resolver(entregado());
    await userEvent.click(await screen.findByRole('button', { name: 'Escanear otro kit' }));
    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    expect(m.validarKitCustodia).toHaveBeenCalledTimes(1);
  });

  it('el buscador pide al menos 2 letras y no repite a quien ya está sugerido', async () => {
    m.validarKitCustodia.mockResolvedValue(kit());
    m.buscarMilitares.mockResolvedValue([militar('m1'), militar('m5', 'r2')]);
    renderPagina();
    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    const buscador = await screen.findByRole('searchbox', { name: /Otro militar/ });
    await userEvent.type(buscador, 'P');
    await new Promise((ok) => setTimeout(ok, 450));
    expect(m.buscarMilitares).not.toHaveBeenCalled();
    await userEvent.type(buscador, 'é');
    await screen.findByRole('radio', { name: /Pérez Juan m5/ });
    expect(screen.getAllByRole('radio', { name: /Pérez Juan m1/ })).toHaveLength(1);
  });

  it('si falla la cámara, se puede escribir el código a mano', async () => {
    m.validarKitCustodia.mockResolvedValue(kit());
    renderPagina();
    await userEvent.click(screen.getByRole('button', { name: 'fallar cámara' }));
    expect(screen.getByRole('alert')).toHaveTextContent('El navegador no dio permiso para usar la cámara. Puede escribir el código a mano.');
    expect(screen.queryByText('cámara leyendo')).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'O escriba el código del kit' }), 'p2zcerv4');
    await userEvent.click(screen.getByRole('button', { name: 'Validar' }));
    expect(m.validarKitCustodia).toHaveBeenCalledWith('P2ZCERV4');
    const ficha = await screen.findByRole('region', { name: 'Kit P2ZCERV4' });
    expect(within(ficha).getByText('Ruiz Ana')).toBeInTheDocument();
  });

  it('un error al guardar se muestra y deja reintentar', async () => {
    m.validarKitCustodia.mockResolvedValue(kit());
    m.registrarEntrega.mockRejectedValueOnce({ response: { data: { message: 'No hay evento activo' } } });
    renderPagina();
    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar entrega' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No hay evento activo');
    expect(screen.getByRole('button', { name: 'Registrar entrega' })).toBeEnabled();
  });
});
