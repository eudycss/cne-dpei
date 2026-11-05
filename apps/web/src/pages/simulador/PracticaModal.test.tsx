import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CargoSimulador, PersonaSimulador, PracticaDigitacion } from '@cne/shared-types';

import { PracticaModal } from './PracticaModal';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
const putMock = api.put as unknown as ReturnType<typeof vi.fn>;

const CARGOS: CargoSimulador[] = [
  { clave: 'DIGITADOR', nombre: 'Digitadores', centro: 'CPE', personas: 30 },
  { clave: 'OPERADOR', nombre: 'Operadores CDA', centro: 'CDA', personas: 31 },
];

const ANA: PersonaSimulador = {
  id: '22222222-2222-4222-8222-222222222222',
  apellidosNombres: 'PÉREZ ANA',
  cedula: '1710034065',
  grupo: 'OPERADOR',
  cargo: 'Operadores CDA',
  activo: true,
};
const LUIS: PersonaSimulador = { ...ANA, id: '33333333-3333-4333-8333-333333333333', apellidosNombres: 'MORA LUIS', grupo: 'DIGITADOR', cargo: 'Digitadores' };

const PRACTICA: PracticaDigitacion = {
  id: '11111111-1111-4111-8111-111111111111',
  nombre: 'Práctica 1',
  filasPorActa: 12,
  votoMin: 0,
  votoMax: 350,
  metaActas: 200,
  plazoMinutos: 60,
  inicio: '2026-11-10T13:00:00.000Z',
  fin: '2026-11-10T23:00:00.000Z',
  pctDigitosDistintos: 10,
  intentosMax: 1,
  activa: true,
  cargos: ['DIGITADOR'],
  personas: [{ ...ANA, incluida: true }],
  alcance: 31,
  intentos: 0,
  creadoEn: '2026-11-05T12:00:00.000Z',
};

function renderModal(practica?: PracticaDigitacion) {
  const onGuardada = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PracticaModal practica={practica} onClose={onClose} onGuardada={onGuardada} />
    </QueryClientProvider>,
  );
  return { onGuardada, onClose };
}

describe('PracticaModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockImplementation((url: string, cfg?: { params?: { q?: string } }) => {
      if (url.endsWith('/cargos')) return Promise.resolve({ data: CARGOS });
      if (url.endsWith('/personas')) return Promise.resolve({ data: cfg?.params?.q === 'mora' ? [LUIS] : [ANA] });
      return Promise.reject(new Error(url));
    });
    postMock.mockResolvedValue({ data: PRACTICA });
    putMock.mockResolvedValue({ data: PRACTICA });
  });

  it('crea una práctica con fechas en hora de Ecuador, cargos y una persona agregada', async () => {
    const user = userEvent.setup();
    const { onGuardada } = renderModal();
    expect(screen.getByRole('dialog', { name: 'Nueva práctica' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Nombre de la práctica'), 'Simulacro digitadores');
    await user.type(screen.getByLabelText(/Se puede empezar desde/), '2026-11-10T08:00');
    await user.type(screen.getByLabelText(/Se puede empezar hasta/), '2026-11-10T18:00');
    await user.click(await screen.findByRole('checkbox', { name: /Digitadores/ }));

    await user.type(screen.getByLabelText('Buscar persona'), 'ana');
    await user.click(await screen.findByRole('button', { name: 'Agregar a PÉREZ ANA' }));
    const lista = screen.getByRole('list', { name: 'Personas agregadas o quitadas' });
    expect(within(lista).getByText('Agregada')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Guardar práctica' }));
    await waitFor(() => expect(postMock).toHaveBeenCalled());
    expect(postMock.mock.calls[0][0]).toBe('/simulador-digitacion/practicas');
    expect(postMock.mock.calls[0][1]).toEqual({
      nombre: 'Simulacro digitadores',
      inicio: '2026-11-10T08:00:00-05:00',
      fin: '2026-11-10T18:00:00-05:00',
      filasPorActa: 12,
      votoMin: 0,
      votoMax: 350,
      metaActas: 200,
      plazoMinutos: 60,
      pctDigitosDistintos: 10,
      intentosMax: 1,
      cargos: ['DIGITADOR'],
      incluir: [ANA.id],
      excluir: [],
    });
    await waitFor(() => expect(onGuardada).toHaveBeenCalled());
  });

  it('a alguien de un cargo habilitado se le ofrece quitarlo', async () => {
    const user = userEvent.setup();
    renderModal(PRACTICA);
    await user.type(screen.getByLabelText('Buscar persona'), 'mora');
    await user.click(await screen.findByRole('button', { name: 'Quitar a MORA LUIS' }));
    await user.click(screen.getByRole('button', { name: 'Guardar práctica' }));
    await waitFor(() => expect(putMock).toHaveBeenCalled());
    expect(putMock.mock.calls[0][0]).toBe(`/simulador-digitacion/practicas/${PRACTICA.id}`);
    expect(putMock.mock.calls[0][1]).toMatchObject({ incluir: [ANA.id], excluir: [LUIS.id], inicio: '2026-11-10T08:00:00-05:00' });
  });

  it('sin datos válidos no envía: muestra los errores y enfoca el primero', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('button', { name: 'Guardar práctica' }));
    expect(postMock).not.toHaveBeenCalled();
    const nombre = screen.getByLabelText('Nombre de la práctica');
    expect(nombre).toHaveAttribute('aria-invalid', 'true');
    expect(nombre).toHaveFocus();
    expect(screen.getByText('Elija al menos un cargo o una persona')).toBeInTheDocument();
  });

  it('voto mínimo mayor que el máximo: error en el máximo', async () => {
    const user = userEvent.setup();
    renderModal(PRACTICA);
    const min = screen.getByLabelText('Voto mínimo');
    await user.clear(min);
    await user.type(min, '400');
    await user.click(screen.getByRole('button', { name: 'Guardar práctica' }));
    expect(putMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Voto máximo')).toHaveAttribute('aria-invalid', 'true');
  });

  it('con intentos hechos, lo que define la calificación queda fijo', () => {
    renderModal({ ...PRACTICA, intentos: 3 });
    expect(screen.getByRole('note')).toHaveTextContent('ya tiene 3 intento(s)');
    expect(screen.getByLabelText('Meta de actas')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Filas por acta')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Intentos por persona')).not.toHaveAttribute('readonly');
  });

  it('al cambiar cargos se descartan las excepciones que ya no tienen sentido, y se avisa', async () => {
    const user = userEvent.setup();
    // Ana (Operadores CDA) está agregada; Luis (Digitadores) se quita.
    renderModal({ ...PRACTICA, personas: [{ ...ANA, incluida: true }, { ...LUIS, incluida: false }] });
    // Desmarcar Digitadores: quitar a Luis ya no hace nada.
    await user.click(await screen.findByRole('checkbox', { name: /Digitadores/ }));
    expect(screen.getByRole('status')).toHaveTextContent('Se descartó a MORA LUIS');
    // Marcar Operadores CDA: agregar a Ana sobra.
    await user.click(screen.getByRole('checkbox', { name: /Operadores CDA/ }));
    expect(screen.queryByRole('list', { name: 'Personas agregadas o quitadas' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar práctica' }));
    await waitFor(() => expect(putMock).toHaveBeenCalled());
    expect(putMock.mock.calls[0][1]).toMatchObject({ cargos: ['OPERADOR'], incluir: [], excluir: [] });
  });

  it('sin cargos cargados, el error de cargos igual recibe el foco', async () => {
    const user = userEvent.setup();
    getMock.mockRejectedValue({ response: { data: { message: 'Sin conexión' } } });
    renderModal({ ...PRACTICA, cargos: [], personas: [] });
    expect(await screen.findByText('Sin conexión')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Guardar práctica' }));
    expect(screen.getByRole('group', { name: 'Cargos a los que aplica' })).toHaveFocus();
  });

  it('fin antes del inicio: error en "hasta"', async () => {
    const user = userEvent.setup();
    renderModal({ ...PRACTICA, fin: '2026-11-10T12:00:00.000Z' });
    await user.click(screen.getByRole('button', { name: 'Guardar práctica' }));
    expect(screen.getByLabelText(/Se puede empezar hasta/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('El fin debe ser posterior al inicio')).toBeInTheDocument();
  });

  it('Escape en el buscador borra la búsqueda y no cierra el formulario', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal(PRACTICA);
    const buscar = screen.getByLabelText('Buscar persona');
    await user.type(buscar, 'mora');
    await user.keyboard('{Escape}');
    expect(buscar).toHaveValue('');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('si la búsqueda falla lo dice (no "0 resultados")', async () => {
    const user = userEvent.setup();
    getMock.mockImplementation((url: string) =>
      url.endsWith('/cargos') ? Promise.resolve({ data: CARGOS }) : Promise.reject({ response: { data: { message: 'Error del servidor' } } }),
    );
    renderModal(PRACTICA);
    await user.type(screen.getByLabelText('Buscar persona'), 'mora');
    expect(await screen.findByText('Error del servidor')).toBeInTheDocument();
  });

  it('quien ya está en la lista no se vuelve a ofrecer', async () => {
    const user = userEvent.setup();
    renderModal(PRACTICA);
    await user.type(screen.getByLabelText('Buscar persona'), 'ana');
    expect(await screen.findByText('Ya está en la lista')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Agregar a PÉREZ ANA' })).not.toBeInTheDocument();
  });

  it('error del servidor al guardar: aviso y el formulario sigue abierto', async () => {
    const user = userEvent.setup();
    const { sileo } = await import('sileo');
    putMock.mockRejectedValue({ response: { data: { message: 'La práctica ya tiene intentos' } } });
    const { onGuardada } = renderModal(PRACTICA);
    await user.click(screen.getByRole('button', { name: 'Guardar práctica' }));
    await waitFor(() => expect(sileo.error).toHaveBeenCalledWith({ title: 'La práctica ya tiene intentos' }));
    expect(onGuardada).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('una persona inactiva se marca: no cuenta en el alcance', () => {
    renderModal({ ...PRACTICA, personas: [{ ...ANA, activo: false, incluida: true }] });
    expect(screen.getByText('Inactiva: no cuenta')).toBeInTheDocument();
  });

  it('se puede deshacer una excepción', async () => {
    const user = userEvent.setup();
    renderModal(PRACTICA);
    await user.click(screen.getByRole('button', { name: 'Deshacer PÉREZ ANA' }));
    expect(screen.queryByRole('list', { name: 'Personas agregadas o quitadas' })).not.toBeInTheDocument();
  });
});
