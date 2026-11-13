import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DisponiblesParejasCda, ImportParejasCdaResult, ParejaCdaFila, ParejasCdaDia } from '@cne/shared-types';

import { OperadoresCdaPage } from './OperadoresCdaPage';
import { api } from '../../lib/api';
import { sileo } from 'sileo';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
const auth = vi.hoisted(() => ({ roles: ['ADMINISTRADOR'] }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { roles: auth.roles } }) }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
const deleteMock = api.delete as unknown as ReturnType<typeof vi.fn>;

const DIA = '2026-10-30';
const ANA = { id: 'op1', apellidosNombres: 'PÉREZ ANA', cedula: '1710034065', telefono: null, dispositivo: null, grupo: 'OPERADOR' };
const JUAN = { id: 'as1', apellidosNombres: 'RUIZ JUAN', cedula: '1713175071', telefono: null, dispositivo: null, grupo: 'ASISTENTE' };
const LUIS = { id: 'op2', apellidosNombres: 'MORA LUIS', cedula: '1712345675', telefono: null, dispositivo: null, grupo: 'OPERADOR' };
const R957 = { id: 'r1', codigo: '957', nombre: 'UE ATAHUALPA' };

function fila(over: Partial<ParejaCdaFila> = {}): ParejaCdaFila {
  return {
    id: 'p1',
    fecha: DIA,
    recinto: R957,
    operador: ANA,
    asistente: JUAN,
    kitCodigo: 'KIT-0001',
    estado: 'EN_APP',
    parejasEnRecinto: 1,
    articulos: null,
    portador: ANA,
    kitSalio: false,
    quienLleva: 'OPERADOR',
    ...over,
  };
}

function mockApi(dia: Partial<ParejasCdaDia> = {}, disponibles?: Partial<DisponiblesParejasCda>) {
  getMock.mockImplementation((url: string) => {
    if (url.startsWith('/parejas-cda/fechas')) return Promise.resolve({ data: ['2026-10-28', DIA] });
    if (url.startsWith('/parejas-cda/disponibles'))
      return Promise.resolve({ data: { operadores: [LUIS], asistentes: [], recintos: [], ...disponibles } });
    if (url.startsWith('/parejas-cda?')) {
      return Promise.resolve({
        data: { fecha: DIA, evento: { id: 'ev2', nombre: 'Prueba Técnica 2' }, congelado: false, parejas: [fila()], ...dia },
      });
    }
    if (url.startsWith('/operadores-cda/asistencia')) return Promise.resolve({ data: { fecha: DIA, esHoy: true, filas: [] } });
    return Promise.resolve({ data: [] });
  });
}

function renderPagina(ruta = `/operadores-cda?tab=parejas&dia=${DIA}`) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <OperadoresCdaPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Parejas Operador + Asistente CDA por día', () => {
  beforeEach(() => {
    // reset (no clear): una respuesta "Once" que un test no usó no debe pasar al siguiente.
    vi.resetAllMocks();
    auth.roles = ['ADMINISTRADOR'];
  });

  it('la pestaña Parejas solo existe en Operadores y Asistentes CDA', async () => {
    mockApi();
    renderPagina('/operadores-cda');
    expect(screen.getByRole('tab', { name: 'Parejas' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cargo' }), 'Asistentes CDA');
    expect(screen.getByRole('tab', { name: 'Parejas' })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Cargo' }), 'Digitadores');
    expect(screen.queryByRole('tab', { name: 'Parejas' })).not.toBeInTheDocument();
  });

  it('muestra la lista del día con recinto (código y nombre), la pareja y si ya está en la app', async () => {
    mockApi({
      parejas: [
        fila(),
        fila({ id: 'p2', operador: LUIS, asistente: null, kitCodigo: null, estado: 'SIN_KIT', portador: LUIS, parejasEnRecinto: 3 }),
        fila({ id: 'p3', operador: { ...LUIS, id: 'op3', apellidosNombres: 'VEGA RITA' }, parejasEnRecinto: 3 }),
      ],
    });
    renderPagina();

    const tabla = await screen.findByRole('region', { name: `Parejas del ${DIA}` });
    const filas = within(tabla).getAllByRole('row').slice(1);
    expect(filas[0]).toHaveTextContent('957 · UE ATAHUALPA');
    expect(filas[0]).toHaveTextContent('PÉREZ ANA');
    expect(filas[0]).toHaveTextContent('RUIZ JUAN');
    expect(filas[0]).toHaveTextContent('En la app');
    expect(filas[0]).not.toHaveTextContent('parejas');
    expect(filas[1]).toHaveTextContent('Sin asistente');
    // Cada pareja del recinto lleva su propio kit: la 2.ª no queda "solo registrada".
    expect(filas[1]).toHaveTextContent('Sin kit');
    expect(filas[1]).toHaveTextContent('se asignará a MORA LUIS');
    expect(filas[1]).not.toHaveTextContent('Solo registrada');
    // El número real de parejas del recinto, no un "2" fijo.
    expect(within(filas[1]).getByText(/^3 parejas/)).toHaveAttribute('title', 'Cada pareja lleva su propio kit');
    expect(screen.getByText('3 pareja(s) en 1 recinto(s)')).toBeInTheDocument();
    expect(screen.getByText(/Evento activo de este día: Prueba Técnica 2/)).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith(`/parejas-cda?fecha=${DIA}`);
  });

  describe('cambiar la fecha o borrar la lista del día', () => {
    const sinKit = () => [fila({ kitCodigo: null, estado: 'SIN_KIT' })];

    it('cambia la fecha de la lista y lleva al día nuevo', async () => {
      mockApi({ parejas: sinKit() });
      postMock.mockResolvedValueOnce({ data: { movidas: 1 } });
      renderPagina();

      await userEvent.click(await screen.findByRole('button', { name: 'Cambiar fecha' }));
      const dialogo = await screen.findByRole('dialog');
      fireEvent.change(within(dialogo).getByLabelText('Nueva fecha'), { target: { value: '2026-11-20' } });
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Cambiar fecha' }));

      await waitFor(() => expect(postMock).toHaveBeenCalledWith('/parejas-cda/dia/mover', { desde: DIA, hacia: '2026-11-20' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(getMock).toHaveBeenCalledWith('/parejas-cda?fecha=2026-11-20');
    });

    it('no deja mover al mismo día', async () => {
      mockApi({ parejas: sinKit() });
      renderPagina();

      await userEvent.click(await screen.findByRole('button', { name: 'Cambiar fecha' }));
      const dialogo = await screen.findByRole('dialog');
      fireEvent.change(within(dialogo).getByLabelText('Nueva fecha'), { target: { value: DIA } });

      expect(within(dialogo).getByRole('button', { name: 'Cambiar fecha' })).toBeDisabled();
      expect(within(dialogo).getByText(`Elija un día distinto del ${DIA}.`)).toBeInTheDocument();
    });

    it('para borrar exige escribir la fecha', async () => {
      mockApi({ parejas: sinKit() });
      deleteMock.mockResolvedValueOnce({});
      renderPagina();

      await userEvent.click(await screen.findByRole('button', { name: 'Borrar lista' }));
      const dialogo = await screen.findByRole('dialog');
      const borrar = within(dialogo).getByRole('button', { name: 'Borrar lista' });
      expect(borrar).toBeDisabled();

      await userEvent.type(within(dialogo).getByLabelText(`Para confirmar, escriba ${DIA}`), DIA);
      await userEvent.click(borrar);

      await waitFor(() => expect(deleteMock).toHaveBeenCalledWith(`/parejas-cda/dia?fecha=${DIA}`));
    });

    it('muestra el motivo si el servidor protege la lista', async () => {
      mockApi({ parejas: sinKit() });
      deleteMock.mockRejectedValueOnce({ response: { data: { message: 'El 2026-10-30 tiene una jornada iniciada o cerrada' } } });
      renderPagina();

      await userEvent.click(await screen.findByRole('button', { name: 'Borrar lista' }));
      const dialogo = await screen.findByRole('dialog');
      await userEvent.type(within(dialogo).getByLabelText(`Para confirmar, escriba ${DIA}`), DIA);
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Borrar lista' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent('jornada iniciada o cerrada');
    });

    it('una lista con kits no ofrece las acciones y explica por qué', async () => {
      mockApi();
      renderPagina();

      expect(await screen.findByText(/ya tiene kits asignados: no se puede cambiar de fecha ni borrar/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Borrar lista' })).not.toBeInTheDocument();
    });

    it('quien no es administrador no las ve', async () => {
      auth.roles = ['TECNICO_SUPERVISOR'];
      mockApi({ parejas: sinKit() });
      renderPagina();

      await screen.findByRole('region', { name: `Parejas del ${DIA}` });
      expect(screen.queryByRole('button', { name: 'Cambiar fecha' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Borrar lista' })).not.toBeInTheDocument();
    });
  });

  describe('Personal sin recinto (pestaña Reserva)', () => {
    const rutaReserva = `/operadores-cda?tab=parejas&dia=${DIA}&vista=reserva`;
    const region = () => screen.findByRole('region', { name: `Personal sin recinto del ${DIA}` });

    it('lista a cada persona con su cédula y cargo, aunque no haya reservas', async () => {
      mockApi({ reserva: [] }, { operadores: [LUIS], asistentes: [JUAN] });
      renderPagina(rutaReserva);

      const filas = within(await region()).getAllByRole('row').slice(1);
      expect(filas).toHaveLength(2);
      expect(filas[0]).toHaveTextContent('MORA LUIS');
      expect(filas[0]).toHaveTextContent('1712345675');
      expect(filas[0]).toHaveTextContent('Operador CDA');
      expect(filas[1]).toHaveTextContent('RUIZ JUAN');
      expect(filas[1]).toHaveTextContent('Asistente CDA');
      expect(screen.getByText('2 persona(s): 1 operador(es) · 1 asistente(s)')).toBeInTheDocument();
      expect(getMock).toHaveBeenCalledWith(`/parejas-cda/disponibles?fecha=${DIA}&todos=true`);
    });

    it('el buscador filtra por cargo', async () => {
      mockApi({ reserva: [] }, { operadores: [LUIS], asistentes: [JUAN] });
      renderPagina(rutaReserva);
      await region();

      await userEvent.type(screen.getByRole('textbox', { name: /Buscar personal sin recinto/ }), 'asistente');

      const filas = within(await region()).getAllByRole('row').slice(1);
      expect(filas).toHaveLength(1);
      expect(filas[0]).toHaveTextContent('RUIZ JUAN');
      expect(screen.getByText('1 de 2 persona(s)')).toBeInTheDocument();
    });

    it('pasa a reserva a las personas elegidas y limpia la selección', async () => {
      mockApi({ reserva: [] }, { operadores: [LUIS], asistentes: [JUAN] });
      postMock.mockResolvedValueOnce({ data: { creadas: 2 } });
      renderPagina(rutaReserva);
      await region();

      const boton = screen.getByRole('button', { name: 'Pasar a reserva (0)' });
      expect(boton).toBeDisabled();
      await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar MORA LUIS' }));
      await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar RUIZ JUAN' }));
      await userEvent.click(screen.getByRole('button', { name: 'Pasar a reserva (2)' }));

      await waitFor(() => expect(postMock).toHaveBeenCalledWith('/parejas-cda/reserva', { fecha: DIA, operadores: ['op2'], asistentes: ['as1'] }));
      await waitFor(() => expect(sileo.success).toHaveBeenCalledWith({ title: '2 persona(s) pasaron a reserva' }));
      expect(await screen.findByRole('button', { name: 'Pasar a reserva (0)' })).toBeDisabled();
    });

    it('"seleccionar todas" toma solo a las personas que deja ver el buscador', async () => {
      mockApi({ reserva: [] }, { operadores: [LUIS], asistentes: [JUAN] });
      postMock.mockResolvedValueOnce({ data: { creadas: 1 } });
      renderPagina(rutaReserva);
      await region();

      await userEvent.type(screen.getByRole('textbox', { name: /Buscar personal sin recinto/ }), 'asistente');
      await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todas las personas visibles' }));
      await userEvent.click(screen.getByRole('button', { name: 'Pasar a reserva (1)' }));

      await waitFor(() => expect(postMock).toHaveBeenCalledWith('/parejas-cda/reserva', { fecha: DIA, operadores: [], asistentes: ['as1'] }));
    });

    it('avisa si hay personas elegidas que el buscador oculta', async () => {
      mockApi({ reserva: [] }, { operadores: [LUIS], asistentes: [JUAN] });
      renderPagina(rutaReserva);
      await region();

      await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar MORA LUIS' }));
      await userEvent.type(screen.getByRole('textbox', { name: /Buscar personal sin recinto/ }), 'asistente');

      expect(screen.getByText('1 de 2 persona(s) · 1 elegida(s) oculta(s) por el buscador')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Pasar a reserva (1)' })).toBeEnabled();
    });

    it('tras un rechazo limpia la selección y vuelve a pedir la lista', async () => {
      mockApi({ reserva: [] }, { operadores: [LUIS], asistentes: [] });
      postMock.mockRejectedValueOnce({ response: { data: { message: 'Alguna persona elegida ya tiene pareja o reserva' } } });
      renderPagina(rutaReserva);
      await region();
      const pedidas = () => getMock.mock.calls.filter(([url]) => String(url).startsWith('/parejas-cda/disponibles')).length;
      const antes = pedidas();

      await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar MORA LUIS' }));
      await userEvent.click(screen.getByRole('button', { name: 'Pasar a reserva (1)' }));

      await waitFor(() => expect(pedidas()).toBeGreaterThan(antes));
      expect(await screen.findByRole('button', { name: 'Pasar a reserva (0)' })).toBeDisabled();
    });

    it('muestra el motivo si el servidor rechaza', async () => {
      mockApi({ reserva: [] }, { operadores: [LUIS], asistentes: [] });
      postMock.mockRejectedValueOnce({ response: { data: { message: 'Alguna persona elegida ya tiene pareja o reserva' } } });
      renderPagina(rutaReserva);
      await region();

      await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar MORA LUIS' }));
      await userEvent.click(screen.getByRole('button', { name: 'Pasar a reserva (1)' }));

      expect(await screen.findByRole('alert')).toHaveTextContent('ya tiene pareja o reserva');
    });

    it('avisa cuando no sobra nadie', async () => {
      mockApi({ reserva: [] }, { operadores: [], asistentes: [] });
      renderPagina(rutaReserva);

      expect(await screen.findByText('Todo el personal activo ya tiene pareja o reserva este día.')).toBeInTheDocument();
    });

    it('muestra el error si no se puede cargar', async () => {
      mockApi({ reserva: [] });
      const base = getMock.getMockImplementation()!;
      getMock.mockImplementation((url: string) =>
        url.startsWith('/parejas-cda/disponibles') ? Promise.reject(new Error('caída')) : base(url),
      );
      renderPagina(rutaReserva);

      expect(await screen.findByText('No se pudo cargar el personal sin recinto')).toBeInTheDocument();
    });

    it('quien no es administrador no lo ve ni lo consulta', async () => {
      auth.roles = ['TECNICO_SUPERVISOR'];
      mockApi({ reserva: [] });
      renderPagina(rutaReserva);

      await screen.findByText(/No hay parejas de reserva este día/);
      expect(screen.queryByText('Personal sin recinto este día')).not.toBeInTheDocument();
      expect(getMock).not.toHaveBeenCalledWith(`/parejas-cda/disponibles?fecha=${DIA}&todos=true`);
    });
  });

  describe('recintos con más de una pareja (QR a imprimir)', () => {
    const R1126 = { id: 'r2', codigo: '1126', nombre: 'UE SIN GENTE' };
    const filasDeTabla = async () => within(await screen.findByRole('region', { name: `Parejas del ${DIA}` })).getAllByRole('row').slice(1);
    const MORA = { ...LUIS, id: 'op3', apellidosNombres: 'VEGA RITA' };
    const conVarias = () =>
      mockApi({
        parejas: [
          fila({ id: 'p1', parejasEnRecinto: 2 }),
          fila({ id: 'p2', operador: LUIS, kitCodigo: 'KIT-0002', parejasEnRecinto: 2 }),
          fila({ id: 'p3', recinto: R1126, operador: MORA, asistente: null, kitCodigo: 'KIT-0003', parejasEnRecinto: 1 }),
        ],
        recintosSinPareja: [{ id: 'r9', codigo: '8320', nombre: 'UE LEJANA' }],
      });

    it('sin recintos con 2+ parejas no aparece el filtro', async () => {
      mockApi();
      renderPagina();
      await filasDeTabla();
      expect(screen.queryByRole('checkbox', { name: 'Solo recintos con +1 pareja' })).not.toBeInTheDocument();
    });

    it('el filtro deja solo esos recintos, sin los vacíos, y cuenta los QR elegidos', async () => {
      conVarias();
      renderPagina();
      expect(await filasDeTabla()).toHaveLength(4);

      await userEvent.click(screen.getByRole('checkbox', { name: 'Solo recintos con +1 pareja' }));
      const filas = await filasDeTabla();
      expect(filas).toHaveLength(2);
      expect(screen.getByText('1 recinto(s) con más de una pareja · 2 pareja(s) · 0 QR elegido(s)')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Descargar QR elegidos (0)' })).toBeDisabled();
    });

    it('marca las adicionales y descarga solo el QR de las parejas elegidas', async () => {
      conVarias();
      renderPagina();
      await filasDeTabla();
      await userEvent.click(screen.getByRole('checkbox', { name: 'Solo recintos con +1 pareja' }));

      await userEvent.click(screen.getByRole('button', { name: 'Marcar las parejas adicionales' }));
      expect(screen.getByRole('checkbox', { name: /Elegir el QR de PÉREZ ANA/ })).not.toBeChecked();
      expect(screen.getByRole('checkbox', { name: /Elegir el QR de MORA LUIS/ })).toBeChecked();

      await userEvent.click(screen.getByRole('button', { name: 'Descargar QR elegidos (1)' }));
      await waitFor(() => expect(getMock).toHaveBeenCalledWith(`/parejas-cda/qr?fecha=${DIA}&parejas=p2`, { responseType: 'blob' }));
    });

    it('desactivar el filtro vuelve a mostrar todo; "QR de esta lista" sigue sin pedir parejas', async () => {
      conVarias();
      renderPagina();
      await filasDeTabla();
      await userEvent.click(screen.getByRole('checkbox', { name: 'Solo recintos con +1 pareja' }));
      expect(await filasDeTabla()).toHaveLength(2);
      await userEvent.click(screen.getByRole('checkbox', { name: 'Solo recintos con +1 pareja' }));
      expect(await filasDeTabla()).toHaveLength(4);

      await userEvent.click(screen.getByRole('button', { name: 'Descargar QR de esta lista' }));
      await waitFor(() => expect(getMock).toHaveBeenCalledWith(`/parejas-cda/qr?fecha=${DIA}`, { responseType: 'blob' }));
    });

    it('elige y desmarca a mano; con varias elegidas repite ?parejas=', async () => {
      conVarias();
      renderPagina();
      await filasDeTabla();
      await userEvent.click(screen.getByRole('checkbox', { name: 'Solo recintos con +1 pareja' }));

      const ana = screen.getByRole('checkbox', { name: /Elegir el QR de PÉREZ ANA/ });
      const luis = screen.getByRole('checkbox', { name: /Elegir el QR de MORA LUIS/ });
      await userEvent.click(ana);
      await userEvent.click(luis);
      await userEvent.click(luis);
      expect(luis).not.toBeChecked();
      await userEvent.click(luis);
      await userEvent.click(screen.getByRole('button', { name: 'Descargar QR elegidos (2)' }));
      await waitFor(() => expect(getMock).toHaveBeenCalledWith(`/parejas-cda/qr?fecha=${DIA}&parejas=p1&parejas=p2`, { responseType: 'blob' }));
    });

    it('con el buscador ocultando la primera pareja, "marcar adicionales" no marca a la que queda', async () => {
      conVarias();
      renderPagina();
      await filasDeTabla();
      await userEvent.click(screen.getByRole('checkbox', { name: 'Solo recintos con +1 pareja' }));
      await userEvent.type(screen.getByRole('textbox', { name: /Buscar por persona/ }), 'MORA');

      await userEvent.click(screen.getByRole('button', { name: 'Marcar las parejas adicionales' }));
      expect(screen.getByRole('checkbox', { name: /Elegir el QR de MORA LUIS/ })).toBeChecked();
      await userEvent.clear(screen.getByRole('textbox', { name: /Buscar por persona/ }));
      expect(screen.getByRole('checkbox', { name: /Elegir el QR de PÉREZ ANA/ })).not.toBeChecked();
    });

    it('los dos filtros se excluyen entre sí', async () => {
      conVarias();
      renderPagina();
      await filasDeTabla();
      await userEvent.click(screen.getByRole('checkbox', { name: 'Solo sin pareja' }));
      await userEvent.click(screen.getByRole('checkbox', { name: 'Solo recintos con +1 pareja' }));
      expect(screen.getByRole('checkbox', { name: 'Solo sin pareja' })).not.toBeChecked();
    });

    it('la pareja sin kit no se puede elegir', async () => {
      mockApi({
        parejas: [fila({ id: 'p1', parejasEnRecinto: 2 }), fila({ id: 'p2', operador: LUIS, kitCodigo: null, estado: 'SIN_KIT', parejasEnRecinto: 2 })],
      });
      renderPagina();
      await filasDeTabla();
      await userEvent.click(screen.getByRole('checkbox', { name: 'Solo recintos con +1 pareja' }));

      expect(screen.queryByRole('checkbox', { name: /Elegir el QR de MORA LUIS/ })).not.toBeInTheDocument();
      const filas = await filasDeTabla();
      expect(within(filas[1]).getAllByText('Sin kit').length).toBeGreaterThan(0);
    });
  });

  describe('CDA sin pareja', () => {
    const R1126 = { id: 'r2', codigo: '1126', nombre: 'UE SIN GENTE' };
    const R8320 = { id: 'r3', codigo: '8320', nombre: 'UE LEJANA' };
    const filasDeTabla = async () => within(await screen.findByRole('region', { name: `Parejas del ${DIA}` })).getAllByRole('row').slice(1);

    it('salen al final de la tabla, numerados, con el total de recintos', async () => {
      mockApi({ recintosSinPareja: [R1126, R8320] });
      renderPagina();

      const filas = await filasDeTabla();
      expect(filas).toHaveLength(3);
      expect(filas[1]).toHaveTextContent('2');
      expect(filas[1]).toHaveTextContent('1126 · UE SIN GENTE');
      expect(filas[1]).toHaveTextContent('Sin pareja');
      expect(filas[2]).toHaveTextContent('8320 · UE LEJANA');
      expect(screen.getByText('1 pareja(s) en 1 de 3 recinto(s) · 2 sin pareja')).toBeInTheDocument();
    });

    it('un día sin ninguna pareja igual lista los CDA para completarlos', async () => {
      mockApi({ parejas: [], reserva: [], recintosSinPareja: [R1126] });
      renderPagina();

      const filas = await filasDeTabla();
      expect(filas).toHaveLength(1);
      expect(filas[0]).toHaveTextContent('1126 · UE SIN GENTE');
      expect(screen.queryByText(/Aún no hay parejas este día/)).not.toBeInTheDocument();
    });

    it('el filtro deja solo los vacíos y el buscador los encuentra por código', async () => {
      mockApi({ recintosSinPareja: [R1126, R8320] });
      renderPagina();
      await filasDeTabla();

      await userEvent.click(screen.getByRole('checkbox', { name: 'Solo sin pareja' }));
      expect(await filasDeTabla()).toHaveLength(2);
      expect(screen.getByText('2 recinto(s) sin pareja')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('checkbox', { name: 'Solo sin pareja' }));
      await userEvent.type(screen.getByRole('textbox', { name: /Buscar por persona/ }), '8320');
      const filas = await filasDeTabla();
      expect(filas).toHaveLength(1);
      // Conserva su número aunque el buscador oculte los anteriores.
      expect(filas[0]).toHaveTextContent('3');
      expect(screen.getByText('0 de 1 pareja(s) · 1 sin pareja')).toBeInTheDocument();
    });

    it('con el filtro y el buscador a la vez, el resumen cuenta solo los vacíos que se ven', async () => {
      mockApi({ recintosSinPareja: [R1126, R8320] });
      renderPagina();
      await filasDeTabla();

      await userEvent.click(screen.getByRole('checkbox', { name: 'Solo sin pareja' }));
      await userEvent.type(screen.getByRole('textbox', { name: /Buscar por persona/ }), 'LEJANA');
      expect(await filasDeTabla()).toHaveLength(1);
      expect(screen.getByText('1 de 2 recinto(s) sin pareja')).toBeInTheDocument();
    });

    it('administrador: ve cuántos sobran y asigna la pareja con el recinto ya elegido', async () => {
      mockApi({ recintosSinPareja: [R1126] }, { recintos: [R957, R1126], asistentes: [{ ...JUAN, id: 'as9' }] });
      postMock.mockResolvedValueOnce({ data: { enApp: 1, kitsCreados: 1, sinKit: 0, errores: [] } });
      renderPagina();

      expect(await screen.findByText('Disponibles este día: 1 operador(es) · 1 asistente(s)')).toBeInTheDocument();
      expect(getMock).toHaveBeenCalledWith(`/parejas-cda/disponibles?fecha=${DIA}&todos=true`);

      await userEvent.click(screen.getByRole('button', { name: 'Asignar pareja a 1126 UE SIN GENTE' }));
      const dialogo = await screen.findByRole('dialog');
      expect(within(dialogo).getByRole('checkbox', { name: /Usar todos/ })).toBeChecked();
      expect(await within(dialogo).findByRole('combobox', { name: 'Recinto CDA' })).toHaveValue('r2');

      await userEvent.selectOptions(within(dialogo).getByRole('combobox', { name: 'Operador CDA' }), 'op2');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
      await waitFor(() =>
        expect(postMock).toHaveBeenCalledWith('/parejas-cda', { fecha: DIA, operadorCdaId: 'op2', asistenteCdaId: null, recintoId: 'r2' }),
      );
    });

    it('sin ser administrador los ve, pero sin asignar ni pedir disponibles', async () => {
      auth.roles = ['TECNICO_SUPERVISOR'];
      mockApi({ recintosSinPareja: [R1126] });
      renderPagina();

      const filas = await filasDeTabla();
      expect(filas[1]).toHaveTextContent('Sin pareja');
      expect(screen.queryByRole('button', { name: /Asignar pareja/ })).not.toBeInTheDocument();
      expect(screen.queryByText(/Disponibles este día/)).not.toBeInTheDocument();
      expect(getMock).not.toHaveBeenCalledWith(`/parejas-cda/disponibles?fecha=${DIA}&todos=true`);
    });
  });

  it('sin evento activo de ese día lo explica y no deja "Aplicar a la app"', async () => {
    mockApi({ evento: null, parejas: [fila({ estado: 'PENDIENTE_EVENTO', kitCodigo: null })] });
    renderPagina();
    expect(await screen.findByText(/No hay un evento ACTIVO con jornada este día/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aplicar a la app' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Descargar QR de esta lista' })).toBeDisabled();
  });

  it('"Aplicar a la app" pasa la lista del día y resume el resultado', async () => {
    mockApi();
    postMock.mockResolvedValueOnce({ data: { enApp: 1, kitsCreados: 0, sinKit: 0, errores: [] } });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Aplicar a la app' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith(`/parejas-cda/aplicar?fecha=${DIA}`, {}));
  });

  it('los errores del paso a la app quedan a la vista hasta cerrarlos', async () => {
    mockApi();
    postMock.mockResolvedValueOnce({
      data: { enApp: 0, kitsCreados: 0, sinKit: 0, errores: [{ pareja: 'PÉREZ ANA · 957', error: 'Este operador ya tiene kits asignados a otro recinto en este evento' }] },
    });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Aplicar a la app' }));
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent('PÉREZ ANA · 957: Este operador ya tiene kits asignados a otro recinto');
    await userEvent.click(within(alerta).getByRole('button', { name: 'Cerrar resumen' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('jornada iniciada: pide justificación para aplicar y la envía', async () => {
    mockApi({ congelado: true });
    postMock.mockResolvedValueOnce({ data: { enApp: 1, kitsCreados: 0, sinKit: 0, errores: [] } });
    renderPagina();
    const boton = await screen.findByRole('button', { name: 'Aplicar a la app' });
    expect(await screen.findByText(/las asignaciones están congeladas/)).toBeInTheDocument();
    expect(boton).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Justificación' }), 'Cambio de última hora');
    await userEvent.click(boton);
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith(`/parejas-cda/aplicar?fecha=${DIA}`, { justificacion: 'Cambio de última hora' }),
    );
  });

  it('los días con lista se eligen con un botón', async () => {
    mockApi();
    renderPagina();
    const dias = await screen.findByRole('group', { name: 'Días con lista' });
    expect(within(dias).getByRole('button', { name: DIA })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(within(dias).getByRole('button', { name: '2026-10-28' }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/parejas-cda?fecha=2026-10-28'));
  });

  it('agregar pareja: por defecto solo los disponibles; "Usar todos" vuelve a pedirlos; guarda los 3 datos', async () => {
    mockApi({ parejas: [] }, { operadores: [LUIS], asistentes: [JUAN], recintos: [R957] });
    postMock.mockResolvedValueOnce({ data: { enApp: 1, kitsCreados: 1, sinKit: 0, errores: [] } });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar pareja' }));

    const dialogo = await screen.findByRole('dialog');
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(`/parejas-cda/disponibles?fecha=${DIA}`));
    await userEvent.click(within(dialogo).getByRole('checkbox', { name: /Usar todos/ }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(`/parejas-cda/disponibles?fecha=${DIA}&todos=true`));

    await userEvent.selectOptions(await within(dialogo).findByRole('combobox', { name: 'Operador CDA' }), 'op2');
    await userEvent.selectOptions(within(dialogo).getByRole('combobox', { name: 'Asistente CDA' }), 'as1');
    await userEvent.selectOptions(within(dialogo).getByRole('combobox', { name: 'Recinto CDA' }), 'r1');
    // El kit lleva los artículos activos del catálogo: no se escriben a mano.
    expect(within(dialogo).queryByRole('textbox', { name: /Artículos/ })).not.toBeInTheDocument();
    expect(dialogo).toHaveTextContent('todos los artículos activos del catálogo');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/parejas-cda', {
        fecha: DIA,
        operadorCdaId: 'op2',
        asistenteCdaId: 'as1',
        recintoId: 'r1',
      }),
    );
  });

  describe('regla: cada pareja es un Operador y un Asistente CDA', () => {
    it('cada combo ofrece solo su cargo: el de operador a los operadores y el de asistente a los asistentes', async () => {
      mockApi({ parejas: [] }, { operadores: [LUIS, ANA], asistentes: [JUAN], recintos: [R957] });
      renderPagina();
      await userEvent.click(await screen.findByRole('button', { name: 'Agregar pareja' }));
      const dialogo = await screen.findByRole('dialog');

      const operador = await within(dialogo).findByRole('combobox', { name: 'Operador CDA' });
      await waitFor(() => expect(within(operador).getAllByRole('option')).toHaveLength(3));
      expect(within(operador).queryByRole('option', { name: /RUIZ JUAN/ })).not.toBeInTheDocument();
      expect(within(operador).queryByRole('group')).not.toBeInTheDocument();

      const asistente = within(dialogo).getByRole('combobox', { name: 'Asistente CDA' });
      expect(within(asistente).getAllByRole('option').map((o) => o.textContent)).toEqual(['Sin asistente', 'RUIZ JUAN · 1713175071']);
    });

    it('en la tabla, una pareja anterior a la regla avisa que no la cumple', async () => {
      mockApi({ parejas: [fila({ asistente: LUIS })] });
      renderPagina();
      const celda = (await screen.findByText('MORA LUIS')).closest('td') as HTMLElement;
      expect(within(celda).getByText('Operador CDA · no cumple la regla')).toBeInTheDocument();
      const celdaOperador = screen.getByText('PÉREZ ANA').closest('td') as HTMLElement;
      expect(within(celdaOperador).queryByText(/no cumple la regla/)).not.toBeInTheDocument();
    });

    it('cambiar el asistente no ofrece operadores', async () => {
      mockApi({}, { operadores: [LUIS], asistentes: [], recintos: [] });
      renderPagina();
      await userEvent.click(await screen.findByRole('button', { name: 'Cambiar asistente de PÉREZ ANA' }));
      const dialogo = await screen.findByRole('dialog', { name: 'Cambiar asistente' });
      const combo = within(dialogo).getByRole('combobox', { name: 'Nuevo asistente' });
      await waitFor(() => expect(within(combo).queryByRole('option', { name: /MORA LUIS/ })).not.toBeInTheDocument());
      expect(within(combo).queryByRole('option', { name: /PÉREZ ANA/ })).not.toBeInTheDocument();
    });
  });

  it('el filtro del combo busca por nombre o cédula', async () => {
    mockApi({ parejas: [] }, { operadores: [LUIS, ANA] });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar pareja' }));
    const combo = await screen.findByRole('combobox', { name: 'Operador CDA' });
    await waitFor(() => expect(within(combo).getAllByRole('option')).toHaveLength(3));
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filtrar operador cda' }), 'perez');
    expect(within(combo).getAllByRole('option').map((o) => o.textContent)).toEqual(['Elija un operador', 'PÉREZ ANA · 1710034065']);
  });

  it('cargar plantilla: vista previa con recinto, parejas, errores y avisos; guarda solo las filas válidas', async () => {
    mockApi({ parejas: [] });
    const vista: ImportParejasCdaResult = {
      fecha: DIA,
      guardado: false,
      guardadas: 0,
      app: null,
      filas: [
        {
          fila: 2,
          operador: { cedula: '1710034065', nombre: 'PÉREZ ANA', nuevo: false },
          asistente: { cedula: '1713175071', nombre: 'RUIZ JUAN', nuevo: true },
          recinto: R957,
          articulos: null,
          errores: [],
          avisos: ['Segunda pareja en el recinto 957: solo queda registrada (el kit y la app son de la primera)'],
        },
        {
          fila: 3,
          operador: { cedula: '1002003000', nombre: 'DIGITADOR X', nuevo: false },
          asistente: null,
          recinto: null,
          articulos: null,
          errores: ['La cédula 1002003000 es de Digitadores, no de Operadores CDA'],
          avisos: [],
        },
      ],
    };
    postMock
      .mockResolvedValueOnce({ data: vista })
      .mockResolvedValueOnce({ data: { ...vista, guardado: true, guardadas: 1, app: { enApp: 1, kitsCreados: 0, sinKit: 0, errores: [] } } });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Cargar plantilla' }));

    const archivo = new File(['x'], 'parejas.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await userEvent.upload(screen.getByLabelText('Plantilla (.xlsx)'), archivo);

    const previa = await screen.findByRole('region', { name: 'Vista previa de las parejas' });
    expect(postMock.mock.calls[0][0]).toBe(`/parejas-cda/importar?fecha=${DIA}`);
    expect(previa).toHaveTextContent('957 · UE ATAHUALPA');
    expect(previa).toHaveTextContent('Nuevo');
    expect(within(previa).getByRole('list', { name: 'Avisos de la fila 2' })).toHaveTextContent('Segunda pareja en el recinto 957');
    expect(within(previa).getByRole('list', { name: 'Errores de la fila 3' })).toHaveTextContent('es de Digitadores');

    await userEvent.click(screen.getByRole('button', { name: 'Guardar 1 pareja(s)' }));
    await waitFor(() => expect(postMock.mock.calls[1][0]).toBe(`/parejas-cda/importar?fecha=${DIA}&guardar=true`));
    // La fila 3 no se guardó: el modal sigue abierto y lo dice.
    expect(await screen.findByText(/Las filas con error de abajo no se guardaron/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument();
  });

  it('una lista pasada se puede guardar sin pasar a la app', async () => {
    mockApi({ parejas: [] });
    const vista: ImportParejasCdaResult = {
      fecha: DIA,
      guardado: false,
      guardadas: 0,
      app: null,
      filas: [
        {
          fila: 2,
          operador: { cedula: '1710034065', nombre: 'PÉREZ ANA', nuevo: false },
          asistente: null,
          recinto: R957,
          articulos: null,
          errores: [],
          avisos: [],
        },
      ],
    };
    postMock.mockResolvedValueOnce({ data: vista }).mockResolvedValueOnce({ data: { ...vista, guardado: true, guardadas: 1 } });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Cargar plantilla' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Pasar a la app al guardar/ }));
    await userEvent.upload(screen.getByLabelText('Plantilla (.xlsx)'), new File(['x'], 'p.xlsx'));
    await userEvent.click(await screen.findByRole('button', { name: 'Guardar 1 pareja(s)' }));
    await waitFor(() => expect(postMock.mock.calls[1][0]).toBe(`/parejas-cda/importar?fecha=${DIA}&guardar=true&app=false`));
  });

  it('quien no es administrador ve la lista y el QR, pero no agrega, carga ni quita', async () => {
    auth.roles = ['TECNICO_SUPERVISOR'];
    mockApi();
    renderPagina();
    await screen.findByRole('region', { name: `Parejas del ${DIA}` });
    expect(screen.queryByRole('button', { name: 'Agregar pareja' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cargar plantilla' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Quitar la pareja/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar QR de esta lista' })).toBeEnabled();
  });

  describe('reporte de la lista para imprimir', () => {
    function mockDescarga() {
      mockApi();
      const base = getMock.getMockImplementation()!;
      getMock.mockImplementation((url: string, opts?: unknown) =>
        url.startsWith('/parejas-cda/reporte.')
          ? Promise.resolve({ data: new Blob(['x']), headers: {} })
          : base(url, opts),
      );
      URL.createObjectURL = vi.fn(() => 'blob:x');
      URL.revokeObjectURL = vi.fn();
      const descargas: string[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        descargas.push(this.download);
      });
      return descargas;
    }

    it.each([
      ['Reporte PDF', 'pdf'],
      ['Reporte Excel', 'xlsx'],
    ])('"%s" descarga el reporte del día elegido', async (boton, formato) => {
      const descargas = mockDescarga();
      renderPagina();
      await userEvent.click(await screen.findByRole('button', { name: boton }));
      await waitFor(() => expect(descargas).toEqual([`parejas_cda_${DIA}.${formato}`]));
      expect(getMock).toHaveBeenCalledWith(`/parejas-cda/reporte.${formato}?fecha=${DIA}`, { responseType: 'blob' });
    });

    it('"Reporte por técnico" abre la ventana de técnicos del día (también para quien no es administrador)', async () => {
      auth.roles = ['TECNICO_SUPERVISOR'];
      mockApi();
      renderPagina();
      await userEvent.click(await screen.findByRole('button', { name: 'Reporte por técnico' }));
      expect(screen.getByRole('dialog', { name: 'Reporte por técnico' })).toBeInTheDocument();
      await waitFor(() => expect(getMock).toHaveBeenCalledWith(`/parejas-cda/tecnicos?fecha=${DIA}`));
    });

    it('también lo descarga quien no es administrador', async () => {
      auth.roles = ['TECNICO_SUPERVISOR'];
      mockDescarga();
      renderPagina();
      await screen.findByRole('region', { name: `Parejas del ${DIA}` });
      expect(screen.getByRole('button', { name: 'Reporte PDF' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Reporte Excel' })).toBeEnabled();
    });

    it('sin parejas ese día no hay nada que imprimir', async () => {
      mockApi({ parejas: [] });
      renderPagina();
      expect(await screen.findByRole('button', { name: 'Reporte PDF' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Reporte Excel' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Reporte por técnico' })).toBeDisabled();
    });

    it('si falla, avisa con el mensaje de la API', async () => {
      mockApi();
      const base = getMock.getMockImplementation()!;
      getMock.mockImplementation((url: string, opts?: unknown) =>
        url.startsWith('/parejas-cda/reporte.')
          ? Promise.reject({ response: { data: new Blob([JSON.stringify({ message: 'El 30/10/2026 no tiene parejas' })]) } })
          : base(url, opts),
      );
      renderPagina();
      await userEvent.click(await screen.findByRole('button', { name: 'Reporte PDF' }));
      await waitFor(() => expect(sileo.error).toHaveBeenCalledWith({ title: 'El 30/10/2026 no tiene parejas' }));
    });
  });

  it('quitar pide confirmación y luego llama a la API', async () => {
    mockApi();
    const deleteMock = api.delete as unknown as ReturnType<typeof vi.fn>;
    deleteMock.mockResolvedValueOnce({});
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Quitar la pareja de PÉREZ ANA' }));
    const dialogo = screen.getByRole('dialog', { name: 'Quitar pareja' });
    expect(dialogo).toHaveTextContent('el kit sigue en su recinto pero sin operador');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, quitar' }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/parejas-cda/p1'));
  });

  it('si no se puede quitar (kit ya salió), el error se ve en el diálogo', async () => {
    mockApi();
    const deleteMock = api.delete as unknown as ReturnType<typeof vi.fn>;
    deleteMock.mockRejectedValueOnce({ response: { data: { message: 'El kit KIT-0001 ya salió de la Delegación' } } });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Quitar la pareja de PÉREZ ANA' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sí, quitar' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('ya salió de la Delegación');
  });

  it('la tabla muestra Operador, Asistente y Recinto (código y nombre), en ese orden', async () => {
    mockApi();
    renderPagina();
    const tabla = await screen.findByRole('region', { name: `Parejas del ${DIA}` });
    const cabeceras = within(tabla).getAllByRole('columnheader').map((c) => c.textContent);
    expect(cabeceras).toEqual(['N°', 'Operador CDA', 'Asistente CDA', 'Recinto', 'Dispositivo', 'App', 'Acciones']);
  });

  it('sin día en la dirección abre el día más reciente que tiene lista', async () => {
    mockApi();
    const base = getMock.getMockImplementation() as (url: string) => Promise<unknown>;
    // La única lista es de otro día (no la de hoy).
    getMock.mockImplementation((url: string) =>
      url.startsWith('/parejas-cda/fechas') ? Promise.resolve({ data: ['2026-10-28'] }) : base(url),
    );
    renderPagina('/operadores-cda?tab=parejas');
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/parejas-cda?fecha=2026-10-28'));
    const otrosDias = getMock.mock.calls.filter(([url]) => /^\/parejas-cda\?fecha=/.test(url) && url !== '/parejas-cda?fecha=2026-10-28');
    expect(otrosDias).toEqual([]);
  });

  it('busca por nombre de la persona (sin importar tildes), código o nombre del recinto', async () => {
    const PEDRO = { id: 'as2', apellidosNombres: 'SOLÍS PEDRO', cedula: '1712345683', telefono: null, dispositivo: null, grupo: 'ASISTENTE' };
    const OTRA = fila({ id: 'p2', operador: LUIS, asistente: PEDRO, recinto: { id: 'r2', codigo: '1126', nombre: 'UE B' } });
    mockApi({ parejas: [fila(), OTRA] });
    renderPagina();
    const tabla = await screen.findByRole('region', { name: `Parejas del ${DIA}` });
    const buscar = screen.getByRole('textbox', { name: 'Buscar por persona, código o nombre de recinto' });
    const filas = () => within(tabla).getAllByRole('row').slice(1);

    await userEvent.type(buscar, 'solis');
    expect(filas()).toHaveLength(1);
    expect(filas()[0]).toHaveTextContent('MORA LUIS');

    // Nombre y apellido en otro orden.
    await userEvent.clear(buscar);
    await userEvent.type(buscar, 'pedro solís');
    expect(filas()).toHaveLength(1);
    expect(filas()[0]).toHaveTextContent('MORA LUIS');
    expect(screen.getByText('1 de 2 pareja(s)')).toBeInTheDocument();

    await userEvent.clear(buscar);
    await userEvent.type(buscar, '957');
    expect(filas()).toHaveLength(1);
    expect(filas()[0]).toHaveTextContent('PÉREZ ANA');

    await userEvent.clear(buscar);
    await userEvent.type(buscar, 'atahualpa');
    expect(filas()[0]).toHaveTextContent('957 · UE ATAHUALPA');

    await userEvent.clear(buscar);
    await userEvent.type(buscar, '1712345683');
    expect(filas()).toHaveLength(1);
    expect(filas()[0]).toHaveTextContent('SOLÍS PEDRO');

    await userEvent.clear(buscar);
    await userEvent.type(buscar, 'zzz');
    expect(screen.getByText('Ninguna pareja coincide con "zzz".')).toHaveAttribute('role', 'status');
  });

  it('agrupa por recinto con N°, como el Excel: un recinto con dos parejas es un solo bloque', async () => {
    const R1126 = { id: 'r2', codigo: '1126', nombre: 'UE B' };
    mockApi({
      parejas: [
        fila(),
        fila({ id: 'p2', operador: LUIS, asistente: null, parejasEnRecinto: 2, kitCodigo: 'KIT-0002' }),
        fila({ id: 'p3', operador: { ...LUIS, id: 'op3', apellidosNombres: 'VEGA RITA' }, recinto: R1126 }),
      ],
    });
    renderPagina();
    const tabla = await screen.findByRole('region', { name: `Parejas del ${DIA}` });
    const filas = within(tabla).getAllByRole('row').slice(1) as HTMLTableRowElement[];
    expect(filas[0].cells[0]).toHaveTextContent('1');
    expect(filas[0].cells[0]).toHaveAttribute('rowspan', '2');
    expect(filas[1].cells[0]).not.toHaveTextContent(/^\d+$/);
    expect(filas[2].cells[0]).toHaveTextContent('2');
    expect(filas[2].cells[0]).toHaveAttribute('rowspan', '1');
  });

  describe('dispositivo de cada persona', () => {
    it('se ve y se cambia en la tabla; avisa si quien lleva el kit tiene iPhone', async () => {
      // Nadie con Android: el kit queda con el operador (iPhone) y se avisa.
      mockApi({ parejas: [fila({ operador: { ...ANA, dispositivo: 'IPHONE' }, asistente: { ...JUAN, dispositivo: 'IPHONE' }, portador: { ...ANA, dispositivo: 'IPHONE' } })] });
      const patchMock = api.patch as unknown as ReturnType<typeof vi.fn>;
      patchMock.mockResolvedValueOnce({ data: { id: 'op1', dispositivo: 'ANDROID' } });
      renderPagina();
      const operador = await screen.findByRole('combobox', { name: 'Operador: dispositivo de PÉREZ ANA' });
      expect(operador).toHaveValue('IPHONE');
      expect(screen.getByRole('combobox', { name: 'Asistente: dispositivo de RUIZ JUAN' })).toHaveValue('IPHONE');
      expect(screen.getByText('iPhone: la APK no se instala (sin rastreo)')).toBeInTheDocument();

      await userEvent.selectOptions(operador, 'ANDROID');
      await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/operadores-cda/op1/dispositivo', { dispositivo: 'ANDROID' }));
      // "—" = no se sabe: se guarda null.
      patchMock.mockResolvedValueOnce({ data: { id: 'as1', dispositivo: null } });
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Asistente: dispositivo de RUIZ JUAN' }), '');
      await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/operadores-cda/as1/dispositivo', { dispositivo: null }));
    });

    it('sin quien lleve el kit todavía (sin evento) no avisa de iPhone', async () => {
      mockApi({ evento: null, parejas: [fila({ operador: { ...ANA, dispositivo: 'IPHONE' }, estado: 'PENDIENTE_EVENTO', kitCodigo: null, portador: null })] });
      renderPagina();
      await screen.findByRole('combobox', { name: 'Operador: dispositivo de PÉREZ ANA' });
      expect(screen.queryByText(/iPhone: la APK no se instala/)).not.toBeInTheDocument();
    });

    it('dice quién lleva el kit (el de Android) y no avisa si lo tiene', async () => {
      const JUAN_ANDROID = { ...JUAN, dispositivo: 'ANDROID' as const };
      mockApi({ parejas: [fila({ operador: { ...ANA, dispositivo: 'IPHONE' }, asistente: JUAN_ANDROID, portador: JUAN_ANDROID })] });
      renderPagina();
      const tabla = await screen.findByRole('region', { name: `Parejas del ${DIA}` });
      expect(within(tabla).getAllByRole('row')[1]).toHaveTextContent('Lleva el kit: RUIZ JUAN');
      expect(screen.queryByText(/iPhone: la APK no se instala/)).not.toBeInTheDocument();
    });

    it('quien no es administrador lo ve como texto', async () => {
      auth.roles = ['TECNICO_SUPERVISOR'];
      mockApi({ parejas: [fila({ operador: { ...ANA, dispositivo: 'IPHONE' }, asistente: null })] });
      renderPagina();
      const tabla = await screen.findByRole('region', { name: `Parejas del ${DIA}` });
      expect(within(tabla).queryByRole('combobox')).not.toBeInTheDocument();
      expect(within(tabla).getAllByRole('row')[1]).toHaveTextContent('Operador: iPhone');
      expect(within(tabla).getAllByRole('row')[1]).toHaveTextContent('Asistente: —');
    });
  });

  describe('asignar kit desde la fila', () => {
    const SIN_KIT = fila({ estado: 'SIN_KIT', kitCodigo: null });

    it('solo en las filas "Sin kit"; confirma y asigna el kit de esa pareja', async () => {
      mockApi({ parejas: [SIN_KIT, fila({ id: 'p2', operador: LUIS, recinto: { id: 'r2', codigo: '1126', nombre: 'UE B' } })] });
      postMock.mockResolvedValueOnce({ data: { enApp: 1, kitsCreados: 1, sinKit: 0, errores: [] } });
      renderPagina();
      await userEvent.click(await screen.findByRole('button', { name: 'Asignar kit a PÉREZ ANA' }));
      expect(screen.queryByRole('button', { name: 'Asignar kit a MORA LUIS' })).not.toBeInTheDocument();
      const dialogo = screen.getByRole('dialog', { name: 'Asignar kit' });
      expect(dialogo).toHaveTextContent('957 · UE ATAHUALPA');
      expect(dialogo).toHaveTextContent('PÉREZ ANA');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Asignar' }));
      await waitFor(() => expect(postMock).toHaveBeenCalledWith('/parejas-cda/p1/asignar-kit', {}));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('la 2.ª pareja del recinto también recibe su kit con "Asignar kit" (ya no hay "Darle su propio kit")', async () => {
      mockApi({
        parejas: [
          fila({ parejasEnRecinto: 2 }),
          fila({ id: 'p2', operador: LUIS, estado: 'SIN_KIT', kitCodigo: null, portador: LUIS, parejasEnRecinto: 2, quienLleva: null }),
        ],
      });
      postMock.mockResolvedValueOnce({ data: { enApp: 1, kitsCreados: 1, sinKit: 0, errores: [] } });
      renderPagina();
      await userEvent.click(await screen.findByRole('button', { name: 'Asignar kit a MORA LUIS' }));
      expect(screen.queryByRole('button', { name: /Darle su propio kit/ })).not.toBeInTheDocument();
      const dialogo = screen.getByRole('dialog', { name: 'Asignar kit' });
      expect(dialogo).toHaveTextContent('cada pareja del recinto lleva el suyo');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Asignar' }));
      await waitFor(() => expect(postMock).toHaveBeenCalledWith('/parejas-cda/p2/asignar-kit', {}));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('una pareja sin nadie con Android avisa en el diálogo que no se podrá rastrear', async () => {
      const IPH = { ...LUIS, dispositivo: 'IPHONE' as const };
      mockApi({ parejas: [fila({ id: 'p2', operador: IPH, asistente: null, estado: 'SIN_KIT', kitCodigo: null, portador: IPH })] });
      renderPagina();
      await userEvent.click(await screen.findByRole('button', { name: 'Asignar kit a MORA LUIS' }));
      expect(screen.getByRole('dialog', { name: 'Asignar kit' })).toHaveTextContent('esta pareja no se podrá rastrear');
    });

    it('"Sin kit": no dice que alguien lo lleva, sino a quién se le asignará', async () => {
      mockApi({ parejas: [fila({ estado: 'SIN_KIT' })] });
      renderPagina();
      const tabla = await screen.findByRole('region', { name: `Parejas del ${DIA}` });
      const fila1 = within(tabla).getAllByRole('row')[1];
      expect(fila1).toHaveTextContent('Nadie lleva el kit');
      expect(fila1).not.toHaveTextContent('Lleva el kit:');
    });

    it('si el kit no se pudo asignar, el motivo queda en el diálogo', async () => {
      mockApi({ parejas: [SIN_KIT] });
      postMock.mockResolvedValueOnce({
        data: { enApp: 0, kitsCreados: 0, sinKit: 0, errores: [{ pareja: 'PÉREZ ANA · 957', error: 'El usuario no es un OPERADOR_CDA activo' }] },
      });
      renderPagina();
      await userEvent.click(await screen.findByRole('button', { name: 'Asignar kit a PÉREZ ANA' }));
      const dialogo = screen.getByRole('dialog', { name: 'Asignar kit' });
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Asignar' }));
      expect(await within(dialogo).findByRole('alert')).toHaveTextContent('El usuario no es un OPERADOR_CDA activo');
    });

    it('avisa si el operador tiene iPhone y pide justificación si la jornada inició', async () => {
      mockApi({
        congelado: true,
        parejas: [fila({ estado: 'SIN_KIT', kitCodigo: null, operador: { ...ANA, dispositivo: 'IPHONE' }, portador: { ...ANA, dispositivo: 'IPHONE' } })],
      });
      postMock.mockResolvedValueOnce({ data: { enApp: 1, kitsCreados: 0, sinKit: 0, errores: [] } });
      renderPagina();
      await userEvent.click(await screen.findByRole('button', { name: 'Asignar kit a PÉREZ ANA' }));
      const dialogo = screen.getByRole('dialog', { name: 'Asignar kit' });
      expect(dialogo).toHaveTextContent('usa iPhone');
      const boton = within(dialogo).getByRole('button', { name: 'Asignar' });
      expect(boton).toBeDisabled();
      await userEvent.type(within(dialogo).getByRole('textbox', { name: /Justificación/ }), 'Cambio de última hora');
      await userEvent.click(boton);
      await waitFor(() => expect(postMock).toHaveBeenCalledWith('/parejas-cda/p1/asignar-kit', { justificacion: 'Cambio de última hora' }));
    });
  });

  it('Asignar kit: el diálogo nombra a quien lo va a llevar (el de Android)', async () => {
    const JUAN_ANDROID = { ...JUAN, dispositivo: 'ANDROID' as const };
    mockApi({ parejas: [fila({ estado: 'SIN_KIT', kitCodigo: null, asistente: JUAN_ANDROID, portador: JUAN_ANDROID })] });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Asignar kit a PÉREZ ANA' }));
    const dialogo = screen.getByRole('dialog', { name: 'Asignar kit' });
    expect(dialogo).toHaveTextContent('quedará en la app de RUIZ JUAN');
    expect(dialogo).toHaveTextContent('tiene Android');
  });

  describe('copiar la lista a otro día', () => {
    it('copia las parejas del día mostrado, dice cuáles no se copiaron y lleva al día nuevo', async () => {
      mockApi();
      postMock.mockResolvedValueOnce({
        data: { copiadas: 30, omitidas: [{ pareja: 'MORA LUIS · 1126', motivo: 'El operador ya tiene pareja ese día' }] },
      });
      renderPagina();
      await userEvent.click(await screen.findByRole('button', { name: 'Copiar a otro día' }));
      const dialogo = await screen.findByRole('dialog', { name: 'Copiar la lista a otro día' });
      expect(dialogo).toHaveTextContent('Aplicar a la app');
      const boton = within(dialogo).getByRole('button', { name: 'Copiar' });
      expect(boton).toBeDisabled();
      fireEvent.change(within(dialogo).getByLabelText('Copiar al día'), { target: { value: DIA } });
      expect(boton).toBeDisabled();
      fireEvent.change(within(dialogo).getByLabelText('Copiar al día'), { target: { value: '2026-11-04' } });
      await userEvent.click(boton);

      await waitFor(() => expect(postMock).toHaveBeenCalledWith('/parejas-cda/copiar', { desde: DIA, hacia: '2026-11-04' }));
      const resumen = await within(dialogo).findByRole('status');
      expect(resumen).toHaveTextContent('Se copiaron 30 pareja(s) al 2026-11-04');
      expect(resumen).toHaveTextContent('MORA LUIS · 1126: El operador ya tiene pareja ese día');
      expect(within(dialogo).getByRole('button', { name: 'Ver la lista del 2026-11-04' })).toHaveFocus();
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Ver la lista del 2026-11-04' }));
      await waitFor(() => expect(getMock).toHaveBeenCalledWith('/parejas-cda?fecha=2026-11-04'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('si falla, el motivo se ve en el diálogo', async () => {
      mockApi();
      postMock.mockRejectedValueOnce({ response: { data: { message: 'El 2026-10-30 no tiene parejas para copiar' } } });
      renderPagina();
      await userEvent.click(await screen.findByRole('button', { name: 'Copiar a otro día' }));
      const dialogo = await screen.findByRole('dialog', { name: 'Copiar la lista a otro día' });
      fireEvent.change(within(dialogo).getByLabelText('Copiar al día'), { target: { value: '2026-11-04' } });
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Copiar' }));
      expect(await within(dialogo).findByRole('alert')).toHaveTextContent('no tiene parejas para copiar');
    });

    it('sin parejas o sin ser administrador no aparece el botón', async () => {
      mockApi({ parejas: [] });
      const { unmount } = renderPagina();
      await screen.findByText(/Aún no hay parejas este día/);
      expect(screen.queryByRole('button', { name: 'Copiar a otro día' })).not.toBeInTheDocument();
      unmount();
      auth.roles = ['TECNICO_SUPERVISOR'];
      mockApi();
      renderPagina();
      await screen.findByRole('region', { name: `Parejas del ${DIA}` });
      expect(screen.queryByRole('button', { name: 'Copiar a otro día' })).not.toBeInTheDocument();
    });
  });

  describe('cambiar operador, asistente o recinto', () => {
    const patchMock = () => api.patch as unknown as ReturnType<typeof vi.fn>;
    const R1126 = { id: 'r2', codigo: '1126', nombre: 'UE B' };
    const PEDRO = { id: 'as2', apellidosNombres: 'SOLÍS PEDRO', cedula: '1712345683', telefono: null, dispositivo: null, grupo: 'ASISTENTE' };
    const OTRA = fila({ id: 'p2', operador: LUIS, asistente: PEDRO, recinto: R1126, kitCodigo: 'KIT-0002' });
    const OK = { data: { enApp: 2, kitsCreados: 0, sinKit: 0, errores: [] } };

    async function abrir(campo: 'operador' | 'asistente' | 'recinto') {
      await userEvent.click(await screen.findByRole('button', { name: `Cambiar ${campo} de PÉREZ ANA` }));
      return screen.findByRole('dialog', { name: `Cambiar ${campo}` });
    }

    it('elegir un recinto libre lo cambia sin intercambiar', async () => {
      mockApi({}, { operadores: [], asistentes: [], recintos: [R957, R1126] });
      patchMock().mockResolvedValueOnce(OK);
      renderPagina();
      const dialogo = await abrir('recinto');
      const combo = within(dialogo).getByRole('combobox', { name: 'Nuevo recinto' });
      await waitFor(() => expect(within(combo).getByRole('option', { name: '1126 · UE B' })).toBeInTheDocument());
      await userEvent.selectOptions(combo, 'r2');
      expect(within(dialogo).getByRole('status')).toHaveTextContent('PÉREZ ANA – RUIZ JUAN pasa a 1126 · UE B');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
      await waitFor(() => expect(patchMock()).toHaveBeenCalledWith('/parejas-cda/p1', { recintoId: 'r2' }));
    });

    it('elegir el recinto de otra pareja muestra el intercambio y lo envía', async () => {
      mockApi({ parejas: [fila(), OTRA] }, { operadores: [], asistentes: [], recintos: [R957, R1126] });
      postMock.mockResolvedValueOnce(OK);
      renderPagina();
      const dialogo = await abrir('recinto');
      const combo = within(dialogo).getByRole('combobox', { name: 'Nuevo recinto' });
      await waitFor(() => expect(within(combo).getByRole('option', { name: /1126 · UE B · lo tiene MORA LUIS/ })).toBeInTheDocument());
      await userEvent.selectOptions(combo, 'r2');
      const resumen = within(dialogo).getByRole('status');
      expect(resumen).toHaveTextContent('Se intercambian');
      expect(resumen).toHaveTextContent('PÉREZ ANA – RUIZ JUAN pasa a 1126 · UE B');
      expect(resumen).toHaveTextContent('MORA LUIS – SOLÍS PEDRO pasa a 957 · UE ATAHUALPA');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Intercambiar' }));
      await waitFor(() => expect(postMock).toHaveBeenCalledWith('/parejas-cda/p1/intercambiar', { conId: 'p2', campo: 'RECINTO' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('elegir un operador que ya tiene pareja intercambia los operadores', async () => {
      mockApi({ parejas: [fila(), OTRA] }, { operadores: [], asistentes: [], recintos: [] });
      postMock.mockResolvedValueOnce(OK);
      renderPagina();
      const dialogo = await abrir('operador');
      await userEvent.selectOptions(within(dialogo).getByRole('combobox', { name: 'Nuevo operador' }), 'op2');
      const resumen = within(dialogo).getByRole('status');
      expect(resumen).toHaveTextContent('MORA LUIS – RUIZ JUAN pasa a 957 · UE ATAHUALPA');
      expect(resumen).toHaveTextContent('PÉREZ ANA – SOLÍS PEDRO pasa a 1126 · UE B');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Intercambiar' }));
      await waitFor(() => expect(postMock).toHaveBeenCalledWith('/parejas-cda/p1/intercambiar', { conId: 'p2', campo: 'OPERADOR' }));
    });

    it('elegir el asistente de otra pareja intercambia los asistentes', async () => {
      mockApi({ parejas: [fila(), OTRA] }, { operadores: [], asistentes: [], recintos: [] });
      postMock.mockResolvedValueOnce({ data: { enApp: 0, kitsCreados: 0, sinKit: 0, errores: [] } });
      renderPagina();
      const dialogo = await abrir('asistente');
      await userEvent.selectOptions(within(dialogo).getByRole('combobox', { name: 'Nuevo asistente' }), 'as2');
      const resumen = within(dialogo).getByRole('status');
      expect(resumen).toHaveTextContent('PÉREZ ANA – SOLÍS PEDRO pasa a 957 · UE ATAHUALPA');
      expect(resumen).toHaveTextContent('MORA LUIS – RUIZ JUAN pasa a 1126 · UE B');
      expect(resumen).not.toHaveTextContent('En la app, cada kit');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Intercambiar' }));
      await waitFor(() => expect(postMock).toHaveBeenCalledWith('/parejas-cda/p1/intercambiar', { conId: 'p2', campo: 'ASISTENTE' }));
    });

    it('recinto con varias parejas: se intercambia con la primera de la lista (la misma que elige la API)', async () => {
      const SEGUNDA = fila({ id: 'p3', operador: { ...LUIS, id: 'op3', apellidosNombres: 'VEGA RITA' }, asistente: null, recinto: R1126, parejasEnRecinto: 2 });
      // La API la manda ordenada por recinto y por operador: MORA LUIS antes que VEGA RITA.
      mockApi({ parejas: [fila(), OTRA, SEGUNDA] }, { operadores: [], asistentes: [], recintos: [R957, R1126] });
      postMock.mockResolvedValueOnce(OK);
      renderPagina();
      const dialogo = await abrir('recinto');
      const combo = within(dialogo).getByRole('combobox', { name: 'Nuevo recinto' });
      await waitFor(() => expect(within(combo).getByRole('option', { name: /1126 · UE B · lo tiene MORA LUIS/ })).toBeInTheDocument());
      await userEvent.selectOptions(combo, 'r2');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Intercambiar' }));
      await waitFor(() => expect(postMock).toHaveBeenCalledWith('/parejas-cda/p1/intercambiar', { conId: 'p2', campo: 'RECINTO' }));
    });

    it('el asistente se puede dejar vacío (por defecto, quien sale pasa a reserva)', async () => {
      mockApi({}, { operadores: [], asistentes: [PEDRO], recintos: [] });
      patchMock().mockResolvedValueOnce(OK);
      renderPagina();
      const dialogo = await abrir('asistente');
      await userEvent.selectOptions(within(dialogo).getByRole('combobox', { name: 'Nuevo asistente' }), '');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
      await waitFor(() => expect(patchMock()).toHaveBeenCalledWith('/parejas-cda/p1', { asistenteCdaId: null, saleAReserva: true }));
    });

    it('jornada iniciada: pide justificación antes de guardar y la envía', async () => {
      mockApi({ congelado: true, parejas: [fila(), OTRA] }, { operadores: [], asistentes: [], recintos: [R957, R1126] });
      postMock.mockResolvedValueOnce(OK);
      renderPagina();
      const dialogo = await abrir('recinto');
      const combo = within(dialogo).getByRole('combobox', { name: 'Nuevo recinto' });
      await waitFor(() => expect(within(combo).getByRole('option', { name: /1126/ })).toBeInTheDocument());
      await userEvent.selectOptions(combo, 'r2');
      const boton = within(dialogo).getByRole('button', { name: 'Intercambiar' });
      expect(boton).toBeDisabled();
      await userEvent.type(within(dialogo).getByRole('textbox', { name: /Justificación/ }), 'Cambio de última hora');
      await userEvent.click(boton);
      await waitFor(() =>
        expect(postMock).toHaveBeenCalledWith('/parejas-cda/p1/intercambiar', {
          conId: 'p2',
          campo: 'RECINTO',
          justificacion: 'Cambio de última hora',
        }),
      );
    });

    it('si el kit ya salió, el motivo se ve en el diálogo', async () => {
      mockApi({ parejas: [fila(), OTRA] }, { operadores: [], asistentes: [], recintos: [R957, R1126] });
      postMock.mockRejectedValueOnce({ response: { data: { message: 'El kit KIT-0002 ya salió de la Delegación: no se puede cambiar su pareja' } } });
      renderPagina();
      const dialogo = await abrir('recinto');
      const combo = within(dialogo).getByRole('combobox', { name: 'Nuevo recinto' });
      await waitFor(() => expect(within(combo).getByRole('option', { name: /1126/ })).toBeInTheDocument());
      await userEvent.selectOptions(combo, 'r2');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Intercambiar' }));
      expect(await within(dialogo).findByRole('alert')).toHaveTextContent('ya salió de la Delegación');
    });

    it('kit que ya salió: no se cambia a quien lo lleva ni el recinto, y lo dice; al otro integrante sí', async () => {
      mockApi({ congelado: true, parejas: [fila({ kitSalio: true, quienLleva: 'OPERADOR' })] });
      renderPagina();
      const tabla = await screen.findByRole('region', { name: `Parejas del ${DIA}` });
      expect(within(tabla).queryByRole('button', { name: 'Cambiar operador de PÉREZ ANA' })).not.toBeInTheDocument();
      expect(within(tabla).queryByRole('button', { name: 'Cambiar recinto de PÉREZ ANA' })).not.toBeInTheDocument();
      expect(within(tabla).getByText('Lleva el kit que ya salió: no se cambia')).toBeInTheDocument();
      expect(within(tabla).getByText('El kit ya salió: no se cambia')).toBeInTheDocument();
      expect(within(tabla).getByRole('button', { name: 'Cambiar asistente de PÉREZ ANA' })).toBeInTheDocument();
    });

    it('si el kit que salió lo lleva el asistente, es el asistente quien no se cambia', async () => {
      mockApi({ parejas: [fila({ kitSalio: true, quienLleva: 'ASISTENTE', portador: JUAN })] });
      renderPagina();
      const tabla = await screen.findByRole('region', { name: `Parejas del ${DIA}` });
      expect(within(tabla).getByRole('button', { name: 'Cambiar operador de PÉREZ ANA' })).toBeInTheDocument();
      expect(within(tabla).queryByRole('button', { name: 'Cambiar asistente de PÉREZ ANA' })).not.toBeInTheDocument();
    });

    it('jornada iniciada: el aviso explica qué se puede cambiar y qué no', async () => {
      mockApi({ congelado: true });
      renderPagina();
      const aviso = await screen.findByText(/La jornada ya inició/);
      const banner = aviso.closest('.banner') as HTMLElement;
      expect(banner).toHaveTextContent('Se puede cambiar');
      expect(banner).toHaveTextContent('con justificación');
      expect(banner).toHaveTextContent('No se puede cambiar a quien lleva un kit que ya salió de la Delegación, ni el recinto de ese kit');
    });

    it('quien no es administrador no ve los botones de cambiar', async () => {
      auth.roles = ['TECNICO_SUPERVISOR'];
      mockApi();
      renderPagina();
      await screen.findByRole('region', { name: `Parejas del ${DIA}` });
      expect(screen.queryByRole('button', { name: /^Cambiar / })).not.toBeInTheDocument();
    });
  });

  describe('parejas de reserva', () => {
    const SOLANO = { id: 'op7', apellidosNombres: 'SOLANO PEDRO', cedula: '1003003003', telefono: null, dispositivo: null, grupo: 'OPERADOR' as const };
    const RESERVA = { id: 'pR', fecha: DIA, operador: SOLANO, asistente: null };
    const R228 = { id: 'r2', codigo: '228', nombre: 'UE ALFREDO PÉREZ' };

    it('dos pestañas con el total de cada una; la de reserva muestra cada pareja en una tarjeta', async () => {
      mockApi({ reserva: [RESERVA] });
      renderPagina();

      expect(await screen.findByRole('tab', { name: 'En recintos (1)' })).toHaveAttribute('aria-selected', 'true');
      await userEvent.click(screen.getByRole('tab', { name: 'Reserva (1)' }));

      const lista = screen.getByRole('list', { name: `Parejas de reserva del ${DIA}` });
      expect(lista).toHaveTextContent('SOLANO PEDRO');
      expect(lista).toHaveTextContent('Sin asistente');
      expect(within(lista).getByRole('button', { name: 'Asignar a recinto la pareja de reserva de SOLANO PEDRO' })).toBeInTheDocument();
    });

    it('reserva sin operador: muestra el espacio vacío, no deja asignar recinto y se completa con un operador libre', async () => {
      const VEGA = { id: 'as9', apellidosNombres: 'VEGA SAMAEL', cedula: '1004424790', telefono: null, dispositivo: null, grupo: 'ASISTENTE' as const };
      mockApi({ reserva: [{ id: 'pR2', fecha: DIA, operador: null, asistente: VEGA }] });
      const patchMock = api.patch as unknown as ReturnType<typeof vi.fn>;
      patchMock.mockResolvedValueOnce({ data: { enApp: 0, kitsCreados: 0, sinKit: 0, errores: [] } });
      renderPagina(`/operadores-cda?tab=parejas&dia=${DIA}&vista=reserva`);

      const lista = await screen.findByRole('list', { name: `Parejas de reserva del ${DIA}` });
      expect(lista).toHaveTextContent('Sin operador');
      expect(lista).toHaveTextContent('VEGA SAMAEL');
      const asignar = within(lista).getByRole('button', { name: 'Asignar a recinto la pareja de reserva de VEGA SAMAEL' });
      expect(asignar).toHaveAttribute('aria-disabled', 'true');
      await userEvent.click(asignar);
      expect(screen.queryByRole('dialog', { name: 'Asignar a recinto' })).not.toBeInTheDocument();
      expect(asignar).toHaveAccessibleDescription('Complete el operador antes de asignarle un recinto: el kit va a su nombre.');

      await userEvent.click(within(lista).getByRole('button', { name: 'Completar el operador de la reserva de VEGA SAMAEL' }));
      const dialogo = screen.getByRole('dialog', { name: 'Completar el operador' });
      const combo = await within(dialogo).findByRole('combobox', { name: 'Operador CDA' });
      expect(within(dialogo).getByRole('button', { name: 'Completar' })).toBeDisabled();
      await userEvent.selectOptions(combo, 'op2');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Completar' }));

      await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/parejas-cda/pR2', { operadorCdaId: 'op2' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Completar el operador' })).not.toBeInTheDocument());
      expect(sileo.success).toHaveBeenCalledWith({ title: 'Reserva completada', description: 'VEGA SAMAEL' });
    });

    it('completar el asistente envía su id; quien no es admin no ve "Completar"', async () => {
      mockApi({ reserva: [RESERVA] }, { asistentes: [JUAN] });
      const patchMock = api.patch as unknown as ReturnType<typeof vi.fn>;
      patchMock.mockResolvedValueOnce({ data: { enApp: 0, kitsCreados: 0, sinKit: 0, errores: [] } });
      const { unmount } = renderPagina(`/operadores-cda?tab=parejas&dia=${DIA}&vista=reserva`);

      await userEvent.click(await screen.findByRole('button', { name: 'Completar el asistente de la reserva de SOLANO PEDRO' }));
      const dialogo = screen.getByRole('dialog', { name: 'Completar el asistente' });
      await userEvent.selectOptions(await within(dialogo).findByRole('combobox', { name: 'Asistente CDA' }), 'as1');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Completar' }));
      await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/parejas-cda/pR', { asistenteCdaId: 'as1' }));
      unmount();

      auth.roles = ['TECNICO_SUPERVISOR'];
      renderPagina(`/operadores-cda?tab=parejas&dia=${DIA}&vista=reserva`);
      await screen.findByRole('list', { name: `Parejas de reserva del ${DIA}` });
      expect(screen.queryByRole('button', { name: /^Completar / })).not.toBeInTheDocument();
    });

    it('completar el asistente sin asistentes libres lo dice y no deja guardar', async () => {
      mockApi({ reserva: [RESERVA] }, { asistentes: [] });
      renderPagina(`/operadores-cda?tab=parejas&dia=${DIA}&vista=reserva`);

      await userEvent.click(await screen.findByRole('button', { name: 'Completar el asistente de la reserva de SOLANO PEDRO' }));
      const dialogo = screen.getByRole('dialog', { name: 'Completar el asistente' });
      expect(await within(dialogo).findByRole('status')).toHaveTextContent('No hay ningún Asistente CDA libre este día.');
      expect(within(dialogo).getByRole('button', { name: 'Completar' })).toBeDisabled();
    });

    it('sin parejas de reserva, la pestaña explica cómo cargarlas', async () => {
      mockApi({ reserva: [] });
      renderPagina(`/operadores-cda?tab=parejas&dia=${DIA}&vista=reserva`);
      expect(await screen.findByText('No hay parejas de reserva este día.')).toBeInTheDocument();
    });

    it('un día con solo parejas de reserva deja descargar el reporte', async () => {
      mockApi({ parejas: [], reserva: [RESERVA] });
      renderPagina();
      expect(await screen.findByRole('tab', { name: 'Reserva (1)' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Reporte Excel' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Aplicar a la app' })).toBeDisabled();
    });

    it('asignar a un recinto ocupado avisa quién pasa a reserva antes de intercambiar', async () => {
      mockApi({ reserva: [RESERVA] }, { recintos: [R957, R228] });
      postMock.mockResolvedValueOnce({ data: { enApp: 1, kitsCreados: 0, sinKit: 0, errores: [] } });
      renderPagina(`/operadores-cda?tab=parejas&dia=${DIA}&vista=reserva`);

      await userEvent.click(await screen.findByRole('button', { name: 'Asignar a recinto la pareja de reserva de SOLANO PEDRO' }));
      const dialogo = screen.getByRole('dialog', { name: 'Asignar a recinto' });
      const combo = await within(dialogo).findByRole('combobox', { name: 'Recinto CDA' });
      // Libres primero.
      expect(within(combo).getAllByRole('option').map((o) => o.textContent)).toEqual([
        'Elija un recinto',
        '228 · UE ALFREDO PÉREZ — libre',
        '957 · UE ATAHUALPA — ocupado por PÉREZ ANA',
      ]);

      await userEvent.selectOptions(combo, 'r1');
      expect(dialogo).toHaveTextContent('PÉREZ ANA y RUIZ JUAN pasan a reserva y su kit KIT-0001 pasa a esta pareja');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, intercambiar' }));

      await waitFor(() => expect(postMock).toHaveBeenCalledWith('/parejas-cda/pR/recinto', { recintoId: 'r1' }));
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Asignar a recinto' })).not.toBeInTheDocument());
    });

    it('pasar a reserva avisa que el kit sale de la app y llama a la API', async () => {
      mockApi();
      postMock.mockResolvedValueOnce({ data: { enApp: 0, kitsCreados: 0, sinKit: 0, errores: [] } });
      renderPagina();

      await userEvent.click(await screen.findByRole('button', { name: 'Pasar a reserva la pareja de PÉREZ ANA' }));
      const dialogo = screen.getByRole('dialog', { name: 'Pasar a reserva' });
      expect(dialogo).toHaveTextContent('El kit KIT-0001 se quitará de la app de PÉREZ ANA');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, pasar a reserva' }));

      await waitFor(() => expect(postMock).toHaveBeenCalledWith('/parejas-cda/p1/reserva', {}));
      await waitFor(() => expect(sileo.success).toHaveBeenCalledWith({ title: 'Pareja pasada a reserva', description: 'PÉREZ ANA' }));
    });

    it('la pareja cuyo kit ya salió no ofrece "Pasar a reserva"', async () => {
      mockApi({ parejas: [fila({ kitSalio: true })] });
      renderPagina();
      await screen.findByRole('region', { name: `Parejas del ${DIA}` });
      expect(screen.queryByRole('button', { name: 'Pasar a reserva la pareja de PÉREZ ANA' })).not.toBeInTheDocument();
    });

    const abrirAsignar = async () => {
      await userEvent.click(await screen.findByRole('button', { name: 'Asignar a recinto la pareja de reserva de SOLANO PEDRO' }));
      const dialogo = screen.getByRole('dialog', { name: 'Asignar a recinto' });
      return { dialogo, combo: await within(dialogo).findByRole('combobox', { name: 'Recinto CDA' }) };
    };
    const SIN_ERRORES = { enApp: 1, kitsCreados: 1, sinKit: 0, errores: [] };

    it('asignar a un recinto libre lo explica y asigna (sin intercambio)', async () => {
      mockApi({ reserva: [RESERVA] }, { recintos: [R957, R228] });
      postMock.mockResolvedValueOnce({ data: SIN_ERRORES });
      renderPagina(`/operadores-cda?tab=parejas&dia=${DIA}&vista=reserva`);
      const { dialogo, combo } = await abrirAsignar();

      await userEvent.selectOptions(combo, 'r2');
      expect(dialogo).toHaveTextContent('El recinto está libre');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Asignar' }));
      await waitFor(() => expect(postMock).toHaveBeenCalledWith('/parejas-cda/pR/recinto', { recintoId: 'r2' }));
    });

    it('si el kit de la pareja del recinto ya salió, no deja intercambiar', async () => {
      mockApi({ parejas: [fila({ kitSalio: true })], reserva: [RESERVA] }, { recintos: [R957] });
      renderPagina(`/operadores-cda?tab=parejas&dia=${DIA}&vista=reserva`);
      const { dialogo, combo } = await abrirAsignar();

      await userEvent.selectOptions(combo, 'r1');
      expect(dialogo).toHaveTextContent('ya salió de la Delegación');
      expect(within(dialogo).getByRole('button', { name: 'Sí, intercambiar' })).toBeDisabled();
    });

    it('guardado pero sin pasar a la app: muestra el motivo y solo deja cerrar', async () => {
      mockApi({ reserva: [RESERVA] }, { recintos: [R228] });
      postMock.mockResolvedValueOnce({ data: { ...SIN_ERRORES, enApp: 0, errores: [{ pareja: 'SOLANO PEDRO · 228', error: 'Faltan artículos' }] } });
      renderPagina(`/operadores-cda?tab=parejas&dia=${DIA}&vista=reserva`);
      const { dialogo, combo } = await abrirAsignar();

      await userEvent.selectOptions(combo, 'r2');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Asignar' }));

      expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Faltan artículos');
      expect(within(dialogo).getByRole('button', { name: 'Asignar' })).toBeDisabled();
      expect(within(dialogo).getByRole('button', { name: 'Cerrar' })).toBeEnabled();
    });

    it('jornada iniciada: asignar pide justificación y la envía', async () => {
      mockApi({ congelado: true, reserva: [RESERVA] }, { recintos: [R228] });
      postMock.mockResolvedValueOnce({ data: SIN_ERRORES });
      renderPagina(`/operadores-cda?tab=parejas&dia=${DIA}&vista=reserva`);
      const { dialogo, combo } = await abrirAsignar();

      await userEvent.selectOptions(combo, 'r2');
      expect(within(dialogo).getByRole('button', { name: 'Asignar' })).toBeDisabled();
      await userEvent.type(within(dialogo).getByLabelText('Justificación (la jornada ya inició)'), 'Se enfermó el titular');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Asignar' }));
      await waitFor(() =>
        expect(postMock).toHaveBeenCalledWith('/parejas-cda/pR/recinto', { recintoId: 'r2', justificacion: 'Se enfermó el titular' }),
      );
    });

    it('jornada iniciada: pasar a reserva una pareja con kit pide justificación; sin kit, no', async () => {
      mockApi({ congelado: true, parejas: [fila(), fila({ id: 'p2', operador: LUIS, recinto: R228, estado: 'SIN_KIT', kitCodigo: null })] });
      renderPagina();

      await userEvent.click(await screen.findByRole('button', { name: 'Pasar a reserva la pareja de PÉREZ ANA' }));
      let dialogo = screen.getByRole('dialog', { name: 'Pasar a reserva' });
      expect(within(dialogo).getByRole('button', { name: 'Sí, pasar a reserva' })).toBeDisabled();
      expect(within(dialogo).getByLabelText('Justificación (la jornada ya inició)')).toBeRequired();
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));

      await userEvent.click(screen.getByRole('button', { name: 'Pasar a reserva la pareja de MORA LUIS' }));
      dialogo = screen.getByRole('dialog', { name: 'Pasar a reserva' });
      expect(within(dialogo).queryByLabelText('Justificación (la jornada ya inició)')).not.toBeInTheDocument();
      expect(within(dialogo).getByRole('button', { name: 'Sí, pasar a reserva' })).toBeEnabled();
    });

    it('si la API rechaza pasar a reserva, el error se ve en el diálogo', async () => {
      mockApi();
      postMock.mockRejectedValueOnce({ isAxiosError: true, response: { data: { message: 'El kit KIT-0001 ya salió de la Delegación' } } });
      renderPagina();
      await userEvent.click(await screen.findByRole('button', { name: 'Pasar a reserva la pareja de PÉREZ ANA' }));
      const dialogo = screen.getByRole('dialog', { name: 'Pasar a reserva' });
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, pasar a reserva' }));
      expect(await within(dialogo).findByRole('alert')).toBeInTheDocument();
    });

    it('quitar una pareja de reserva pide confirmación y la borra', async () => {
      mockApi({ reserva: [RESERVA] });
      const deleteMock = api.delete as unknown as ReturnType<typeof vi.fn>;
      deleteMock.mockResolvedValueOnce({});
      renderPagina(`/operadores-cda?tab=parejas&dia=${DIA}&vista=reserva`);

      await userEvent.click(await screen.findByRole('button', { name: 'Quitar la pareja de reserva de SOLANO PEDRO' }));
      const dialogo = screen.getByRole('dialog', { name: 'Quitar pareja de reserva' });
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, quitar' }));
      await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/parejas-cda/pR'));
      await waitFor(() => expect(sileo.success).toHaveBeenCalledWith({ title: 'Pareja de reserva quitada', description: 'SOLANO PEDRO' }));
    });

    it('quien no es administrador ve las parejas de reserva pero no puede moverlas', async () => {
      auth.roles = ['TECNICO_SUPERVISOR'];
      mockApi({ reserva: [RESERVA] });
      renderPagina(`/operadores-cda?tab=parejas&dia=${DIA}&vista=reserva`);
      expect(await screen.findByRole('list', { name: `Parejas de reserva del ${DIA}` })).toHaveTextContent('SOLANO PEDRO');
      expect(screen.queryByRole('button', { name: /Asignar a recinto/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Quitar la pareja de reserva/ })).not.toBeInTheDocument();
    });

    it('con solo parejas de reserva, la pestaña En recintos lo explica', async () => {
      mockApi({ parejas: [], reserva: [RESERVA] });
      renderPagina();
      expect(await screen.findByText(/Ninguna pareja tiene recinto este día/)).toBeInTheDocument();
    });

    it('la vista previa de la plantilla marca las filas de reserva', async () => {
      mockApi({ parejas: [] });
      const vista: ImportParejasCdaResult = {
        fecha: DIA,
        guardado: false,
        guardadas: 0,
        app: null,
        filas: [
          { fila: 2, operador: { cedula: SOLANO.cedula, nombre: SOLANO.apellidosNombres, nuevo: false }, asistente: null, recinto: null, reserva: true, articulos: null, errores: [], avisos: [] },
        ],
      };
      postMock.mockResolvedValueOnce({ data: vista });
      renderPagina();
      await userEvent.click(await screen.findByRole('button', { name: 'Cargar plantilla' }));
      const archivo = new File(['x'], 'parejas.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      await userEvent.upload(screen.getByLabelText('Plantilla (.xlsx)'), archivo);

      const previa = await screen.findByRole('region', { name: 'Vista previa de las parejas' });
      expect(within(previa).getAllByRole('row')[1]).toHaveTextContent('Reserva');
      expect(screen.getByText(/\(1 de reserva\)/)).toBeInTheDocument();
    });
  });
});
