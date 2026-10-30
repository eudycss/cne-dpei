import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CargoCda } from '@cne/shared-types';

import { GestionarCargosModal } from './GestionarCargosModal';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
const patchMock = api.patch as unknown as ReturnType<typeof vi.fn>;

const cargo = (c: Partial<CargoCda> & Pick<CargoCda, 'clave' | 'nombre'>): CargoCda => ({
  centro: 'CPE',
  activo: true,
  protegido: false,
  orden: 1,
  personas: 0,
  ...c,
});

const CARGOS: CargoCda[] = [
  cargo({ clave: 'OPERADOR', nombre: 'Operadores CDA', centro: 'CDA', protegido: true, personas: 31 }),
  cargo({ clave: 'DIGITADOR', nombre: 'Digitadores', personas: 12 }),
  cargo({ clave: 'JEFES', nombre: 'Jefes de sala', activo: false, personas: 2 }),
];

function renderModal(onClose = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GestionarCargosModal onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onClose };
}

describe('GestionarCargosModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue({ data: CARGOS });
    postMock.mockImplementation((_u: string, b: { nombre: string; centro: string }) =>
      Promise.resolve({ data: cargo({ clave: 'X', ...b } as CargoCda) }),
    );
    patchMock.mockResolvedValue({ data: CARGOS[1] });
  });

  it('lista cada cargo con su centro, personas y estado; operadores y asistentes no se desactivan', async () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: 'Gestionar cargos' })).toBeInTheDocument();
    const tabla = await screen.findByRole('table', { name: 'Cargos CDA y CPE' });
    const filas = within(tabla).getAllByRole('row').slice(1);
    expect(filas.map((f) => within(f).getAllByRole('cell').slice(0, 4).map((c) => c.textContent))).toEqual([
      ['Operadores CDA', 'CDA', '31', 'Activo'],
      ['Digitadores', 'CPE', '12', 'Activo'],
      ['Jefes de sala', 'CPE', '2', 'Desactivado'],
    ]);
    expect(within(filas[0]).queryByRole('button', { name: /Desactivar/ })).not.toBeInTheDocument();
    expect(within(filas[0]).getByText(/la usa la app/i)).toBeInTheDocument();
    expect(within(filas[1]).getByRole('button', { name: 'Desactivar Digitadores' })).toBeInTheDocument();
    expect(within(filas[2]).getByRole('button', { name: 'Reactivar Jefes de sala' })).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith('/cargos-cda');
  });

  it('agregar un cargo: nombre y centro', async () => {
    renderModal();
    await screen.findByRole('table', { name: 'Cargos CDA y CPE' });
    await userEvent.type(screen.getByLabelText('Nombre del cargo nuevo'), '  Técnicos de sala ');
    await userEvent.selectOptions(screen.getByLabelText('Centro'), 'CDA');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar cargo' }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/cargos-cda', { nombre: 'Técnicos de sala', centro: 'CDA' }));
    await waitFor(() => expect(screen.getByLabelText('Nombre del cargo nuevo')).toHaveValue(''));
  });

  it('un nombre inválido o repetido no se envía y se explica junto al campo', async () => {
    renderModal();
    await screen.findByRole('table', { name: 'Cargos CDA y CPE' });
    const nombre = screen.getByLabelText('Nombre del cargo nuevo');
    await userEvent.type(nombre, 'ab');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar cargo' }));
    expect(await screen.findByText('Mínimo 3 caracteres')).toBeInTheDocument();
    expect(nombre).toHaveAttribute('aria-invalid', 'true');

    await userEvent.clear(nombre);
    await userEvent.type(nombre, 'DIGITADORES');
    await userEvent.click(screen.getByRole('button', { name: 'Agregar cargo' }));
    expect(await screen.findByText('Ya existe un cargo con ese nombre')).toBeInTheDocument();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('cambiar el nombre: solo el nombre visible', async () => {
    renderModal();
    await screen.findByRole('table', { name: 'Cargos CDA y CPE' });
    await userEvent.click(screen.getByRole('button', { name: 'Editar nombre de Digitadores' }));
    const campo = screen.getByLabelText('Nuevo nombre de Digitadores');
    expect(campo).toHaveFocus();
    await userEvent.clear(campo);
    await userEvent.type(campo, 'Digitación');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar nombre' }));
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/cargos-cda/DIGITADOR', { nombre: 'Digitación' }));
  });

  it('cancelar la edición del nombre no envía nada', async () => {
    renderModal();
    await screen.findByRole('table', { name: 'Cargos CDA y CPE' });
    await userEvent.click(screen.getByRole('button', { name: 'Editar nombre de Digitadores' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar edición' }));
    expect(screen.queryByLabelText('Nuevo nombre de Digitadores')).not.toBeInTheDocument();
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('desactivar avisa que se conserva todo; reactivar va directo', async () => {
    renderModal();
    await screen.findByRole('table', { name: 'Cargos CDA y CPE' });
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar Digitadores' }));
    const aviso = screen.getByRole('alertdialog', { name: '¿Desactivar Digitadores?' });
    expect(within(aviso).getByText(/12 personas/)).toBeInTheDocument();
    expect(within(aviso).getByText(/se conservan/)).toBeInTheDocument();
    await userEvent.click(within(aviso).getByRole('button', { name: 'Desactivar' }));
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/cargos-cda/DIGITADOR/activo', { activo: false }));

    await userEvent.click(screen.getByRole('button', { name: 'Reactivar Jefes de sala' }));
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/cargos-cda/JEFES/activo', { activo: true }));
  });

  it('teclado: Escape cancela la edición o la confirmación (no cierra todo) y el foco vuelve a su botón', async () => {
    const { onClose } = renderModal();
    await screen.findByRole('table', { name: 'Cargos CDA y CPE' });

    await userEvent.click(screen.getByRole('button', { name: 'Editar nombre de Digitadores' }));
    await userEvent.type(screen.getByLabelText('Nuevo nombre de Digitadores'), ' 2');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByLabelText('Nuevo nombre de Digitadores')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar nombre de Digitadores' })).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Desactivar Digitadores' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desactivar Digitadores' })).toHaveFocus();

    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('cancelar la confirmación devuelve el foco a Desactivar', async () => {
    renderModal();
    await screen.findByRole('table', { name: 'Cargos CDA y CPE' });
    await userEvent.click(screen.getByRole('button', { name: 'Desactivar Digitadores' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: 'Desactivar Digitadores' })).toHaveFocus();
  });

  it('se cierra con el botón Cerrar', async () => {
    const { onClose } = renderModal();
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(onClose).toHaveBeenCalled();
  });
});
