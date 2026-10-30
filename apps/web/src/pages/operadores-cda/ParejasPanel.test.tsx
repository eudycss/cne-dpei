import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { DisponiblesParejasCda, ImportParejasCdaResult, ParejaCdaFila, ParejasCdaDia } from '@cne/shared-types';

import { OperadoresCdaPage } from './OperadoresCdaPage';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
const auth = vi.hoisted(() => ({ roles: ['ADMINISTRADOR'] }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { roles: auth.roles } }) }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;

const DIA = '2026-10-30';
const ANA = { id: 'op1', apellidosNombres: 'PÉREZ ANA', cedula: '1710034065', telefono: null };
const JUAN = { id: 'as1', apellidosNombres: 'RUIZ JUAN', cedula: '1713175071', telefono: null };
const LUIS = { id: 'op2', apellidosNombres: 'MORA LUIS', cedula: '1712345675', telefono: null };
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
    recintoCompartido: false,
    articulos: null,
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
        fila({ id: 'p2', operador: LUIS, asistente: null, kitCodigo: null, estado: 'SOLO_REGISTRADA', recintoCompartido: true }),
      ],
    });
    renderPagina();

    const tabla = await screen.findByRole('region', { name: `Parejas del ${DIA}` });
    const filas = within(tabla).getAllByRole('row').slice(1);
    expect(filas[0]).toHaveTextContent('957 · UE ATAHUALPA');
    expect(filas[0]).toHaveTextContent('PÉREZ ANA');
    expect(filas[0]).toHaveTextContent('RUIZ JUAN');
    expect(filas[0]).toHaveTextContent('En la app');
    expect(filas[1]).toHaveTextContent('Sin asistente');
    expect(filas[1]).toHaveTextContent('Solo registrada');
    expect(filas[1]).toHaveTextContent('2 parejas');
    expect(screen.getByText('2 pareja(s) en 1 recinto(s)')).toBeInTheDocument();
    expect(screen.getByText(/Evento activo de este día: Prueba Técnica 2/)).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith(`/parejas-cda?fecha=${DIA}`);
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
    postMock.mockResolvedValueOnce({ data: { enApp: 1, kitsCreados: 0, sinKit: 0, soloRegistradas: 0, errores: [] } });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Aplicar a la app' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith(`/parejas-cda/aplicar?fecha=${DIA}`, {}));
  });

  it('los errores del paso a la app quedan a la vista hasta cerrarlos', async () => {
    mockApi();
    postMock.mockResolvedValueOnce({
      data: { enApp: 0, kitsCreados: 0, sinKit: 0, soloRegistradas: 0, errores: [{ pareja: 'PÉREZ ANA · 957', error: 'Este operador ya tiene kits asignados a otro recinto en este evento' }] },
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
    postMock.mockResolvedValueOnce({ data: { enApp: 1, kitsCreados: 0, sinKit: 0, soloRegistradas: 0, errores: [] } });
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
    postMock.mockResolvedValueOnce({ data: { enApp: 1, kitsCreados: 1, sinKit: 0, soloRegistradas: 0, errores: [] } });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar pareja' }));

    const dialogo = await screen.findByRole('dialog');
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(`/parejas-cda/disponibles?fecha=${DIA}`));
    await userEvent.click(within(dialogo).getByRole('checkbox', { name: /Usar todos/ }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(`/parejas-cda/disponibles?fecha=${DIA}&todos=true`));

    await userEvent.selectOptions(await within(dialogo).findByRole('combobox', { name: 'Operador CDA' }), 'op2');
    await userEvent.selectOptions(within(dialogo).getByRole('combobox', { name: 'Asistente CDA' }), 'as1');
    await userEvent.selectOptions(within(dialogo).getByRole('combobox', { name: 'Recinto CDA' }), 'r1');
    await userEvent.type(within(dialogo).getByRole('textbox', { name: /Artículos del kit/ }), 'LAP:123');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/parejas-cda', {
        fecha: DIA,
        operadorCdaId: 'op2',
        asistenteCdaId: 'as1',
        recintoId: 'r1',
        articulos: 'LAP:123',
      }),
    );
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
      .mockResolvedValueOnce({ data: { ...vista, guardado: true, guardadas: 1, app: { enApp: 1, kitsCreados: 0, sinKit: 0, soloRegistradas: 0, errores: [] } } });
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
    expect(cabeceras.slice(0, 3)).toEqual(['Operador CDA', 'Asistente CDA', 'Recinto']);
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
    const PEDRO = { id: 'as2', apellidosNombres: 'SOLÍS PEDRO', cedula: '1712345683', telefono: null };
    const OTRA = fila({ id: 'p2', operador: LUIS, asistente: PEDRO, recinto: { id: 'r2', codigo: '1126', nombre: 'UE B' } });
    mockApi({ parejas: [fila(), OTRA] });
    renderPagina();
    const tabla = await screen.findByRole('region', { name: `Parejas del ${DIA}` });
    const buscar = screen.getByRole('textbox', { name: 'Buscar por persona, código o nombre de recinto' });
    const filas = () => within(tabla).getAllByRole('row').slice(1);

    await userEvent.type(buscar, 'solis');
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
    const PEDRO = { id: 'as2', apellidosNombres: 'SOLÍS PEDRO', cedula: '1712345683', telefono: null };
    const OTRA = fila({ id: 'p2', operador: LUIS, asistente: PEDRO, recinto: R1126, kitCodigo: 'KIT-0002' });
    const OK = { data: { enApp: 2, kitsCreados: 0, sinKit: 0, soloRegistradas: 0, errores: [] } };

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
      postMock.mockResolvedValueOnce({ data: { enApp: 0, kitsCreados: 0, sinKit: 0, soloRegistradas: 0, errores: [] } });
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

    it('recinto con dos parejas: se intercambia con la que tiene el kit', async () => {
      const SOLO = fila({ id: 'p3', operador: { ...LUIS, id: 'op3', apellidosNombres: 'VEGA RITA' }, asistente: null, recinto: R1126, estado: 'SOLO_REGISTRADA', kitCodigo: null });
      mockApi({ parejas: [fila(), SOLO, OTRA] }, { operadores: [], asistentes: [], recintos: [R957, R1126] });
      postMock.mockResolvedValueOnce(OK);
      renderPagina();
      const dialogo = await abrir('recinto');
      const combo = within(dialogo).getByRole('combobox', { name: 'Nuevo recinto' });
      await waitFor(() => expect(within(combo).getByRole('option', { name: /1126 · UE B · lo tiene MORA LUIS/ })).toBeInTheDocument());
      await userEvent.selectOptions(combo, 'r2');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Intercambiar' }));
      await waitFor(() => expect(postMock).toHaveBeenCalledWith('/parejas-cda/p1/intercambiar', { conId: 'p2', campo: 'RECINTO' }));
    });

    it('el asistente se puede dejar vacío', async () => {
      mockApi({}, { operadores: [], asistentes: [PEDRO], recintos: [] });
      patchMock().mockResolvedValueOnce(OK);
      renderPagina();
      const dialogo = await abrir('asistente');
      await userEvent.selectOptions(within(dialogo).getByRole('combobox', { name: 'Nuevo asistente' }), '');
      await userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
      await waitFor(() => expect(patchMock()).toHaveBeenCalledWith('/parejas-cda/p1', { asistenteCdaId: null }));
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

    it('quien no es administrador no ve los botones de cambiar', async () => {
      auth.roles = ['TECNICO_SUPERVISOR'];
      mockApi();
      renderPagina();
      await screen.findByRole('region', { name: `Parejas del ${DIA}` });
      expect(screen.queryByRole('button', { name: /^Cambiar / })).not.toBeInTheDocument();
    });
  });
});
