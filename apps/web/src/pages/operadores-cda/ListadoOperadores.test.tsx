import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { PERMISO_IDS } from '@cne/shared-validation';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OperadorCda, RoleName } from '@cne/shared-types';

import { ListadoOperadores } from './ListadoOperadores';
import { hoyEcuador, iniciales, normalizar } from './utils';
import { api } from '../../lib/api';
import { sileo } from 'sileo';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

// Las acciones por rol se prueban en useModulos.test; aquí se fijan a mano.
const permisos = { actuales: new Set<string>(PERMISO_IDS) };
vi.mock('../../lib/useModulos', () => ({
  useModulos: () => ({ cargando: false, visibles: new Set(), puedeVer: () => true, puede: (id: string) => permisos.actuales.has(id) }),
}));
let roles: RoleName[] = ['ADMINISTRADOR'];
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { roles } }) }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
const patchMock = (api as unknown as { patch: ReturnType<typeof vi.fn> }).patch;

const operador = (over: Partial<OperadorCda>): OperadorCda => ({
  id: 'o1',
  numero: 1,
  apellidosNombres: 'CHÁVEZ MORA LUCÍA ESTEFANÍA',
  cedula: '1710034065',
  telefono: '0968333444',
  cargo: 'OPERADOR CDA',
  unidad: null,
  fechaInicio: '2026-10-20',
  tieneFoto: false,
  activo: true,
  creadoEn: '2026-10-22T10:00:00.000Z',
  ...over,
});

/** Muestra la URL actual para comprobar que los filtros quedan en ella. */
function Url() {
  const { search } = useLocation();
  return <span data-testid="url">{search}</span>;
}

function renderPagina(ruta = '/operadores-cda') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <ListadoOperadores />
        <Url />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ListadoOperadores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permisos.actuales = new Set(PERMISO_IDS);
    roles = ['ADMINISTRADOR'];
  });

  it('muestra nombre, cédula, teléfono, cargo y el estado de la foto', async () => {
    getMock.mockResolvedValueOnce({
      data: [operador({}), operador({ id: 'o2', apellidosNombres: 'ANDRADE LÓPEZ MARÍA JOSÉ', cedula: '1002003000', tieneFoto: true })],
    });
    renderPagina();

    const lista = await screen.findByRole('list', { name: 'Operadores CDA' });
    const tarjetas = within(lista).getAllByRole('listitem');
    expect(tarjetas).toHaveLength(2);
    expect(within(tarjetas[0]).getByRole('heading', { name: 'CHÁVEZ MORA LUCÍA ESTEFANÍA' })).toBeInTheDocument();
    expect(within(tarjetas[0]).getByText('0968333444')).toBeInTheDocument();
    expect(within(tarjetas[0]).getByText('Sin foto')).toBeInTheDocument();
    expect(within(tarjetas[1]).getByText('Foto cargada')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('2 de 2 operadores · 1 con foto');
  });

  it('filtra sin importar tildes ni mayúsculas, y por cédula', async () => {
    getMock.mockResolvedValueOnce({
      data: [operador({}), operador({ id: 'o2', apellidosNombres: 'ANDRADE LÓPEZ MARÍA JOSÉ', cedula: '1002003000' })],
    });
    renderPagina();
    const buscador = await screen.findByRole('textbox', { name: 'Buscar operador por nombre o cédula' });

    await userEvent.type(buscador, 'chavez');
    expect(screen.getAllByRole('listitem')).toHaveLength(1);

    await userEvent.clear(buscador);
    await userEvent.type(buscador, '100200');
    expect(screen.getByRole('heading', { name: 'ANDRADE LÓPEZ MARÍA JOSÉ' })).toBeInTheDocument();

    await userEvent.clear(buscador);
    await userEvent.type(buscador, 'zzz');
    expect(screen.getByText('Ningún operador coincide con “zzz”.')).toBeInTheDocument();
  });

  it('sin operadores guía al administrador a importar el Excel', async () => {
    getMock.mockResolvedValueOnce({ data: [] });
    renderPagina();
    expect(await screen.findByText('Aún no hay operadores registrados.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importar Excel' })).toBeInTheDocument();
  });

  it('solo el administrador ve el botón de importar', async () => {
    roles = ['ASISTENTE_TRANSVERSAL'];
    getMock.mockResolvedValueOnce({ data: [operador({})] });
    renderPagina();
    await screen.findByRole('list', { name: 'Operadores CDA' });
    expect(screen.queryByRole('button', { name: 'Importar Excel' })).not.toBeInTheDocument();
  });

  it('un asistente con la acción de emitir ve "Carnets QR" pero no importar ni agregar', async () => {
    roles = ['ASISTENTE_TRANSVERSAL'];
    getMock.mockResolvedValueOnce({ data: [operador({})] });
    renderPagina();
    await screen.findByRole('list', { name: 'Operadores CDA' });
    expect(screen.getByRole('button', { name: 'Carnets QR' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Importar Excel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Agregar/ })).not.toBeInTheDocument();
  });

  it('sin la acción de emitir no ve "Carnets QR"; sin la de fotos, no ve el enlace de foto', async () => {
    roles = ['ASISTENTE_TRANSVERSAL'];
    permisos.actuales = new Set(['cda.asistencia.marcar']);
    getMock.mockResolvedValueOnce({ data: [operador({})] });
    renderPagina();
    await screen.findByRole('list', { name: 'Operadores CDA' });
    expect(screen.queryByRole('button', { name: 'Carnets QR' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Enlace de foto/ })).not.toBeInTheDocument();
  });
});

describe('ListadoOperadores — agregar, editar y ocultar (administrador)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permisos.actuales = new Set(PERMISO_IDS);
    roles = ['ADMINISTRADOR'];
  });

  it('otros roles no ven agregar, editar, ocultar ni "Mostrar ocultos"', async () => {
    roles = ['TECNICO_SUPERVISOR'];
    getMock.mockResolvedValueOnce({ data: [operador({})] });
    renderPagina();
    await screen.findByRole('list', { name: 'Operadores CDA' });
    for (const nombre of [/Agregar operador/, /^Editar/, /^Ocultar/, /Mostrar ocultos/]) {
      expect(screen.queryByRole('button', { name: nombre })).not.toBeInTheDocument();
    }
  });

  it('agregar: valida en el navegador, lleva el foco al primer error y no llama a la API', async () => {
    getMock.mockResolvedValueOnce({ data: [operador({})] });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar operador' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Agregar operador' });

    await userEvent.type(within(dialogo).getByLabelText('Cédula'), '1710034066');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Agregar operador' }));

    expect(within(dialogo).getByRole('alert')).toHaveTextContent('Revise los 3 campos marcados.');
    expect(within(dialogo).getByLabelText('Apellidos y nombres')).toHaveFocus();
    expect(within(dialogo).getByLabelText('Cédula')).toHaveAttribute('aria-invalid', 'true');
    // La fecha de ingreso es obligatoria al agregar.
    expect(within(dialogo).getByLabelText('Fecha de ingreso')).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialogo).getByText('Fecha de ingreso requerida')).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('agregar: manda solo los campos llenos y cierra al guardar', async () => {
    getMock.mockResolvedValue({ data: [operador({})] });
    postMock.mockResolvedValueOnce({ data: operador({ id: 'nuevo', apellidosNombres: 'RUIZ MORA JUAN' }) });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar operador' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Agregar operador' });

    await userEvent.type(within(dialogo).getByLabelText('Apellidos y nombres'), 'RUIZ MORA JUAN');
    await userEvent.type(within(dialogo).getByLabelText('Cédula'), '1002003000');
    await userEvent.type(within(dialogo).getByLabelText('Teléfono (opcional)'), '0987 111 222');
    fireEvent.change(within(dialogo).getByLabelText('Fecha de ingreso'), { target: { value: '2026-10-21' } });
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Agregar operador' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/operadores-cda', {
        apellidosNombres: 'RUIZ MORA JUAN',
        cedula: '1002003000',
        telefono: '0987111222',
        cargo: 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - OPERADORES CDA',
        fechaInicio: '2026-10-21',
        grupo: 'OPERADOR',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('agregar: si la API responde 409 muestra su mensaje y no cierra', async () => {
    getMock.mockResolvedValue({ data: [operador({})] });
    postMock.mockRejectedValueOnce({ response: { data: { message: 'Ya existe un operador con esa cédula' } } });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Agregar operador' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Agregar operador' });
    await userEvent.type(within(dialogo).getByLabelText('Apellidos y nombres'), 'RUIZ MORA JUAN');
    await userEvent.type(within(dialogo).getByLabelText('Cédula'), '1710034065');
    fireEvent.change(within(dialogo).getByLabelText('Fecha de ingreso'), { target: { value: '2026-10-21' } });
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Agregar operador' }));

    await waitFor(() => expect(sileo.error).toHaveBeenCalledWith({ title: 'Ya existe un operador con esa cédula' }));
    expect(screen.getByRole('dialog', { name: 'Agregar operador' })).toBeInTheDocument();
  });

  it('editar: pasar a otro cargo avisa desde cuándo, guarda los datos y luego el cargo', async () => {
    const asistente = operador({ grupo: 'ASISTENTE', cargo: 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - ASISTENTES CDA' });
    getMock.mockResolvedValue({ data: [asistente] });
    patchMock
      .mockResolvedValueOnce({ data: asistente })
      .mockResolvedValueOnce({
        data: {
          operador: { ...asistente, grupo: 'OPERADOR' },
          grupoAnterior: 'ASISTENTE',
          desde: hoyEcuador(),
          carnetVigente: true,
          actaVigente: true,
        },
      });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Editar: CHÁVEZ MORA LUCÍA ESTEFANÍA' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Editar operador' });

    const cargoCda = within(dialogo).getByRole('combobox', { name: 'Cargo CDA' });
    expect(cargoCda).toHaveDisplayValue('Asistentes CDA');
    await userEvent.selectOptions(cargoCda, 'Operadores CDA');
    expect(cargoCda).toHaveAccessibleDescription(
      'Pasará a Operadores CDA desde hoy (desde mañana si ya marcó entrada hoy). Su asistencia anterior queda en Asistentes CDA.',
    );
    // El cargo por defecto sigue al cargo CDA elegido.
    expect(within(dialogo).getByLabelText('Cargo')).toHaveValue('ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - OPERADORES CDA');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar y pasar a Operadores CDA' }));

    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(2));
    expect(patchMock.mock.calls[0][0]).toBe('/operadores-cda/o1');
    expect(patchMock.mock.calls[0][1]).toMatchObject({ cargo: 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - OPERADORES CDA' });
    expect(patchMock).toHaveBeenLastCalledWith('/operadores-cda/o1/cargo', { grupo: 'OPERADOR' });
    expect(sileo.success).toHaveBeenCalledWith(expect.objectContaining({ title: 'Pasó a Operadores CDA' }));
    expect(sileo.warning).toHaveBeenCalledWith({
      title: 'Pasó a Operadores CDA: falta un paso',
      description:
        'Ahora reemita su carnet QR (el impreso dice el cargo de Asistentes CDA) y genere una nueva acta de entrega en Operadores CDA.',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('editar: un cargo escrito a mano no se reemplaza al cambiar de cargo CDA; sin carnet ni acta no hay aviso', async () => {
    getMock.mockResolvedValue({ data: [operador({})] });
    patchMock
      .mockResolvedValueOnce({ data: operador({}) })
      .mockResolvedValueOnce({
        data: {
          operador: operador({ grupo: 'SUPERVISOR' }),
          grupoAnterior: 'OPERADOR',
          desde: '2999-01-01',
          carnetVigente: false,
          actaVigente: false,
        },
      });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Editar: CHÁVEZ MORA LUCÍA ESTEFANÍA' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Editar operador' });
    await userEvent.selectOptions(within(dialogo).getByRole('combobox', { name: 'Cargo CDA' }), 'Supervisores');
    expect(within(dialogo).getByLabelText('Cargo')).toHaveValue('OPERADOR CDA');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar y pasar a Supervisores' }));
    await waitFor(() => expect(patchMock).toHaveBeenLastCalledWith('/operadores-cda/o1/cargo', { grupo: 'SUPERVISOR' }));
    expect(sileo.warning).not.toHaveBeenCalled();
    // Rige desde otro día (ya marcó entrada hoy): se dice en el aviso.
    expect(sileo.success).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'CHÁVEZ MORA LUCÍA ESTEFANÍA · desde mañana (hoy ya marcó entrada)' }),
    );
  });

  it('editar: si falla el cambio de cargo después de guardar los datos, avisa y refresca la lista', async () => {
    getMock.mockResolvedValue({ data: [operador({})] });
    patchMock
      .mockResolvedValueOnce({ data: operador({}) })
      .mockRejectedValueOnce({ response: { data: { message: 'Otro usuario acaba de cambiarle el cargo: recargue la lista' } } });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Editar: CHÁVEZ MORA LUCÍA ESTEFANÍA' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Editar operador' });
    await userEvent.selectOptions(within(dialogo).getByRole('combobox', { name: 'Cargo CDA' }), 'Digitadores');
    const pedidosAntes = getMock.mock.calls.length;
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar y pasar a Digitadores' }));
    await waitFor(() =>
      expect(sileo.error).toHaveBeenCalledWith({ title: 'Otro usuario acaba de cambiarle el cargo: recargue la lista' }),
    );
    await waitFor(() => expect(getMock.mock.calls.length).toBeGreaterThan(pedidosAntes));
    expect(screen.getByRole('dialog', { name: 'Editar operador' })).toBeInTheDocument();
  });

  it('editar sin cambiar de cargo no llama al cambio de cargo; agregar no muestra "Cargo CDA"', async () => {
    getMock.mockResolvedValue({ data: [operador({})] });
    patchMock.mockResolvedValueOnce({ data: operador({}) });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Editar: CHÁVEZ MORA LUCÍA ESTEFANÍA' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Editar operador' });
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(patchMock).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Agregar operador' }));
    const alta = await screen.findByRole('dialog', { name: 'Agregar operador' });
    expect(within(alta).queryByRole('combobox', { name: 'Cargo CDA' })).not.toBeInTheDocument();
  });

  it('editar: una fecha de ingreso ya registrada no se puede borrar', async () => {
    getMock.mockResolvedValue({ data: [operador({})] });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Editar: CHÁVEZ MORA LUCÍA ESTEFANÍA' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Editar operador' });
    const fecha = within(dialogo).getByLabelText('Fecha de ingreso');
    fireEvent.change(fecha, { target: { value: '' } });
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }));

    expect(fecha).toHaveAttribute('aria-invalid', 'true');
    expect(fecha).toHaveFocus();
    expect(within(dialogo).getByText('Fecha de ingreso requerida')).toBeInTheDocument();
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('editar: un registro antiguo sin fecha de ingreso se puede guardar igual', async () => {
    getMock.mockResolvedValue({ data: [operador({ fechaInicio: null })] });
    patchMock.mockResolvedValueOnce({ data: operador({ fechaInicio: null }) });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Editar: CHÁVEZ MORA LUCÍA ESTEFANÍA' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Editar operador' });
    expect(within(dialogo).getByLabelText('Fecha de ingreso (opcional)')).toHaveValue('');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/operadores-cda/o1', {
        apellidosNombres: 'CHÁVEZ MORA LUCÍA ESTEFANÍA',
        telefono: '0968333444',
        cargo: 'OPERADOR CDA',
      }),
    );
  });

  it('editar: viene lleno, la cédula no se edita ni se manda y un campo borrado se manda vacío', async () => {
    getMock.mockResolvedValue({ data: [operador({})] });
    patchMock.mockResolvedValueOnce({ data: operador({ telefono: null }) });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Editar: CHÁVEZ MORA LUCÍA ESTEFANÍA' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Editar operador' });

    expect(within(dialogo).getByLabelText('Cédula')).toHaveAttribute('readonly');
    await userEvent.clear(within(dialogo).getByLabelText('Teléfono (opcional)'));
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() =>
      expect(patchMock).toHaveBeenCalledWith('/operadores-cda/o1', {
        apellidosNombres: 'CHÁVEZ MORA LUCÍA ESTEFANÍA',
        cargo: 'OPERADOR CDA',
        fechaInicio: '2026-10-20',
      }),
    );
  });

  it('ocultar: pide confirmación, avisa que la foto se borrará y manda activo=false', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:foto');
    URL.revokeObjectURL = vi.fn();
    getMock.mockImplementation(async (url: string) =>
      url === '/operadores-cda?grupo=OPERADOR' ? { data: [operador({ tieneFoto: true })] } : { data: new Blob(['jpg']) },
    );
    patchMock.mockResolvedValueOnce({ data: operador({ activo: false }) });
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Ocultar: CHÁVEZ MORA LUCÍA ESTEFANÍA' }));
    const dialogo = await screen.findByRole('dialog', { name: '¿Ocultar a este operador?' });

    expect(within(dialogo).getByText('Su foto se eliminará esta madrugada')).toBeInTheDocument();
    // El foco empieza en Cancelar: un Enter por accidente no oculta a nadie.
    expect(within(dialogo).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Ocultar' }));

    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/operadores-cda/o1/activo', { activo: false }));
    // El botón "Ocultar" desaparece con la tarjeta: el foco no debe caer en <body>.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mostrar ocultos' })).toHaveFocus());
  });

  it('"Mostrar ocultos" pide también los inactivos y permite reactivarlos', async () => {
    getMock.mockImplementation(async (url: string) => ({
      data:
        url === '/operadores-cda?grupo=OPERADOR&incluirInactivos=true'
          ? [operador({}), operador({ id: 'o2', apellidosNombres: 'VEGA RÍOS LUIS', activo: false })]
          : [operador({})],
    }));
    patchMock.mockResolvedValueOnce({ data: operador({ id: 'o2', activo: true }) });
    renderPagina();

    const chip = await screen.findByRole('button', { name: 'Mostrar ocultos' });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'true');

    const reactivar = await screen.findByRole('button', { name: 'Reactivar: VEGA RÍOS LUIS' });
    expect(screen.getByRole('status')).toHaveTextContent('2 de 2 operadores · 0 con foto · 1 oculto');
    expect(screen.queryByRole('button', { name: /Enlace de foto: VEGA/ })).not.toBeInTheDocument();
    await userEvent.click(reactivar);
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/operadores-cda/o2/activo', { activo: true }));
    await waitFor(() => expect(chip).toHaveFocus());
  });

  it('un error sin mensaje de la API (p. ej. red caída) muestra el texto genérico', async () => {
    getMock.mockImplementation(async (url: string) => ({
      data: url.includes('incluirInactivos') ? [operador({ activo: false })] : [operador({})],
    }));
    patchMock.mockRejectedValueOnce(new Error('Network Error'));
    renderPagina();
    await userEvent.click(await screen.findByRole('button', { name: 'Mostrar ocultos' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Reactivar: CHÁVEZ MORA LUCÍA ESTEFANÍA' }));
    await waitFor(() => expect(sileo.error).toHaveBeenCalledWith({ title: 'No se pudo reactivar al operador' }));
  });
});

describe('iniciales / normalizar', () => {
  it('toma el primer apellido y el primer nombre', () => {
    expect(iniciales('CHÁVEZ MORA LUCÍA ESTEFANÍA')).toBe('CL');
    expect(iniciales('VEGA LUIS')).toBe('VL');
  });

  it('quita tildes y pasa a minúsculas', () => {
    expect(normalizar('CHÁVEZ Núñez')).toBe('chavez nunez');
  });

  it('"Enlace de foto" abre la ventana del enlace de ese operador; con foto muestra la foto y dice "Cambiar foto"', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:foto');
    URL.revokeObjectURL = vi.fn();
    getMock.mockImplementation(async (url: string) =>
      url === '/operadores-cda?grupo=OPERADOR'
        ? { data: [operador({}), operador({ id: 'o2', apellidosNombres: 'ANDRADE LÓPEZ MARÍA JOSÉ', tieneFoto: true })] }
        : { data: new Blob(['jpg']) },
    );
    postMock.mockResolvedValue({ data: { token: 'T'.repeat(43), expiraEn: '2026-10-24T19:00:00.000Z' } });
    renderPagina();

    const lista = await screen.findByRole('list', { name: 'Operadores CDA' });
    const [lucia, maria] = within(lista).getAllByRole('listitem');
    expect(within(maria).getByRole('button', { name: 'Cambiar foto: ANDRADE LÓPEZ MARÍA JOSÉ' })).toBeInTheDocument();
    await waitFor(() => expect(maria.querySelector('img')).toHaveAttribute('src', 'blob:foto'));
    expect(getMock).toHaveBeenCalledWith('/operadores-cda/o2/foto', { responseType: 'blob' });
    expect(getMock).not.toHaveBeenCalledWith('/operadores-cda/o1/foto', expect.anything());

    await userEvent.click(within(lucia).getByRole('button', { name: 'Enlace de foto: CHÁVEZ MORA LUCÍA ESTEFANÍA' }));
    expect(await screen.findByRole('dialog', { name: 'Enlace para subir foto' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Generar enlace' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/operadores-cda/o1/enlace-foto'));
  });
});

describe('ListadoOperadores — fecha de ingreso', () => {
  const tres = () => [
    operador({ id: 'a', apellidosNombres: 'ANDRADE LÓPEZ MARÍA', cedula: '1002003000', fechaInicio: '2026-10-01' }),
    operador({ id: 'b', apellidosNombres: 'BRAVO RUIZ JUAN', cedula: '1710034065', fechaInicio: '2026-10-15' }),
    operador({ id: 'c', apellidosNombres: 'CEVALLOS MEJÍA ANA', cedula: '0102030405', fechaInicio: null }),
  ];
  const nombres = () =>
    within(screen.getByRole('list', { name: 'Operadores CDA' }))
      .getAllByRole('listitem')
      .map((li) => within(li).getByRole('heading').getAttribute('aria-label'));

  beforeEach(() => {
    vi.clearAllMocks();
    permisos.actuales = new Set(PERMISO_IDS);
    roles = ['ADMINISTRADOR'];
    getMock.mockResolvedValue({ data: tres() });
  });

  it('cada tarjeta muestra la fecha de ingreso (o "Sin fecha")', async () => {
    renderPagina();
    const lista = await screen.findByRole('list', { name: 'Operadores CDA' });
    const [a, , c] = within(lista).getAllByRole('listitem');
    expect(within(a).getByText('01/10/2026')).toBeInTheDocument();
    expect(within(c).getByText('Sin fecha')).toBeInTheDocument();
  });

  it('filtra por rango de ingreso y lo deja en la URL', async () => {
    renderPagina();
    await screen.findByRole('list', { name: 'Operadores CDA' });
    fireEvent.change(screen.getByLabelText('Ingreso desde'), { target: { value: '2026-10-10' } });
    expect(nombres()).toEqual(['BRAVO RUIZ JUAN']);
    expect(screen.getByRole('status')).toHaveTextContent('1 de 3 operadores');
    expect(screen.getByTestId('url')).toHaveTextContent('ingresoDesde=2026-10-10');

    fireEvent.change(screen.getByLabelText('Ingreso desde'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Ingreso hasta'), { target: { value: '2026-10-10' } });
    expect(nombres()).toEqual(['ANDRADE LÓPEZ MARÍA']);
  });

  it('"Incluir sin fecha" suma a quienes no tienen fecha de ingreso', async () => {
    renderPagina('/operadores-cda?ingresoDesde=2026-10-10');
    await screen.findByRole('list', { name: 'Operadores CDA' });
    expect(nombres()).toEqual(['BRAVO RUIZ JUAN']);
    await userEvent.click(screen.getByRole('button', { name: 'Incluir sin fecha' }));
    expect(screen.getByRole('button', { name: 'Incluir sin fecha' })).toHaveAttribute('aria-pressed', 'true');
    expect(nombres()).toEqual(['BRAVO RUIZ JUAN', 'CEVALLOS MEJÍA ANA']);
  });

  it('se combina con la búsqueda; "Limpiar filtros" quita todo', async () => {
    renderPagina('/operadores-cda?ingresoHasta=2026-10-31');
    await screen.findByRole('list', { name: 'Operadores CDA' });
    await userEvent.type(screen.getByRole('textbox', { name: 'Buscar operador por nombre o cédula' }), 'cevallos');
    expect(screen.getByText('Ningún operador coincide con los filtros.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    expect(nombres()).toHaveLength(3);
    expect(screen.getByTestId('url')).toHaveTextContent(/^$/);
    expect(screen.queryByRole('button', { name: 'Limpiar filtros' })).not.toBeInTheDocument();
  });

  it('una fecha mal escrita en el enlace se ignora (no vacía el listado)', async () => {
    renderPagina('/operadores-cda?ingresoDesde=zzz&ingresoHasta=abc');
    await screen.findByRole('list', { name: 'Operadores CDA' });
    expect(nombres()).toHaveLength(3);
    expect(screen.getByLabelText('Ingreso desde')).toHaveValue('');
  });

  it('un rango invertido avisa y no filtra', async () => {
    renderPagina('/operadores-cda?ingresoDesde=2026-10-20&ingresoHasta=2026-10-01');
    await screen.findByRole('list', { name: 'Operadores CDA' });
    expect(screen.getByRole('alert')).toHaveTextContent('La fecha “desde” es posterior a “hasta”');
    expect(screen.getByLabelText('Ingreso desde')).toHaveAttribute('aria-invalid', 'true');
    expect(nombres()).toHaveLength(3);
  });

  it('ordena por fecha de ingreso, con los que no tienen fecha al final', async () => {
    renderPagina();
    await screen.findByRole('list', { name: 'Operadores CDA' });
    await userEvent.selectOptions(screen.getByLabelText('Ordenar'), 'ingreso-reciente');
    expect(nombres()).toEqual(['BRAVO RUIZ JUAN', 'ANDRADE LÓPEZ MARÍA', 'CEVALLOS MEJÍA ANA']);
    await userEvent.selectOptions(screen.getByLabelText('Ordenar'), 'ingreso-antiguo');
    expect(nombres()).toEqual(['ANDRADE LÓPEZ MARÍA', 'BRAVO RUIZ JUAN', 'CEVALLOS MEJÍA ANA']);
  });
});
