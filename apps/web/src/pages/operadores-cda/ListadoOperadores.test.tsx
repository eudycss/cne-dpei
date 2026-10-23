import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OperadorCda, RoleName } from '@cne/shared-types';

import { ListadoOperadores } from './ListadoOperadores';
import { iniciales, normalizar } from './utils';
import { api } from '../../lib/api';
import { sileo } from 'sileo';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { error: vi.fn(), success: vi.fn() } }));
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

function renderPagina() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ListadoOperadores />
    </QueryClientProvider>,
  );
}

describe('ListadoOperadores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});

describe('ListadoOperadores — agregar, editar y ocultar (administrador)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    expect(within(dialogo).getByRole('alert')).toHaveTextContent('Revise los 2 campos marcados.');
    expect(within(dialogo).getByLabelText('Apellidos y nombres')).toHaveFocus();
    expect(within(dialogo).getByLabelText('Cédula')).toHaveAttribute('aria-invalid', 'true');
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
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Agregar operador' }));

    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/operadores-cda', {
        apellidosNombres: 'RUIZ MORA JUAN',
        cedula: '1002003000',
        telefono: '0987111222',
        cargo: 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - OPERADORES CDA',
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
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Agregar operador' }));

    await waitFor(() => expect(sileo.error).toHaveBeenCalledWith({ title: 'Ya existe un operador con esa cédula' }));
    expect(screen.getByRole('dialog', { name: 'Agregar operador' })).toBeInTheDocument();
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
      url === '/operadores-cda' ? { data: [operador({ tieneFoto: true })] } : { data: new Blob(['jpg']) },
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
        url === '/operadores-cda?incluirInactivos=true'
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
      url === '/operadores-cda'
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
