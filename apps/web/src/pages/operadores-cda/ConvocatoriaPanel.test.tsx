import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ConvocatoriaCdaDia, ConvocatoriaCdaPersona } from '@cne/shared-types';

import { ConvocatoriaPanel } from './ConvocatoriaPanel';
import { getConvocatoriaCda, guardarConvocatoriaCda } from '../../lib/queries/operadores-cda';
import { sileo } from 'sileo';

vi.mock('../../lib/queries/operadores-cda', () => ({ getConvocatoriaCda: vi.fn(), guardarConvocatoriaCda: vi.fn() }));
vi.mock('sileo', () => ({ sileo: { error: vi.fn(), success: vi.fn() } }));
const permisos = { gestionar: true };
vi.mock('../../lib/useModulos', () => ({
  useModulos: () => ({ puede: (id: string) => id === 'cda.convocatoria.gestionar' && permisos.gestionar }),
}));
vi.mock('./utils', async (original) => ({ ...(await original<typeof import('./utils')>()), hoyEcuador: () => '2026-11-05' }));

const getMock = getConvocatoriaCda as unknown as ReturnType<typeof vi.fn>;
const guardarMock = guardarConvocatoriaCda as unknown as ReturnType<typeof vi.fn>;

const p = (
  id: string,
  nombre: string,
  grupo: string,
  cargo: string,
  centro: string,
  over: Partial<ConvocatoriaCdaPersona> = {},
): ConvocatoriaCdaPersona => ({
  operadorId: id,
  apellidosNombres: nombre,
  cedula: `17000000${id}`,
  grupo,
  cargo,
  centro,
  convocado: false,
  porPareja: false,
  ...over,
});

function dia(fecha = '2026-11-05', personas?: ConvocatoriaCdaPersona[]): ConvocatoriaCdaDia {
  const lista = personas ?? [
    p('01', 'ANDRADE ANA', 'OPERADOR', 'Operador', 'CDA', { convocado: true, porPareja: true }),
    p('02', 'BENÍTEZ BRUNO', 'OPERADOR', 'Operador', 'CDA'),
    p('03', 'ZAPATA ZOE', 'DIGITADOR', 'Digitador', 'CPE', { convocado: true }),
    p('04', 'ÁLVAREZ ALBA', 'DIGITADOR', 'Digitador', 'CPE'),
  ];
  return { fecha, personas: lista, convocados: lista.filter((x) => x.convocado).length, total: lista.length };
}

function montar() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConvocatoriaPanel />
    </QueryClientProvider>,
  );
}

describe('ConvocatoriaPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permisos.gestionar = true;
    getMock.mockImplementation((fecha: string) => Promise.resolve(dia(fecha)));
    guardarMock.mockImplementation((fecha: string, ids: string[]) => Promise.resolve({ ...dia(fecha), convocados: ids.length + 1 }));
  });

  it('lista por centro y cargo; los de Parejas salen marcados y bloqueados', async () => {
    montar();
    const cda = await screen.findByRole('group', { name: 'CDA · Operador (1/2)' });
    expect(screen.getByRole('group', { name: 'CPE · Digitador (1/2)' })).toBeInTheDocument();
    const ana = within(cda).getByRole('checkbox', { name: /ANDRADE ANA/ });
    expect(ana).toBeChecked();
    expect(ana).toBeDisabled();
    expect(within(cda).getByText('En Parejas')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Convocados: 2 de 4');
  });

  it('marcar y guardar manda solo los convocados a mano (sin los de Parejas)', async () => {
    montar();
    await userEvent.click(await screen.findByRole('checkbox', { name: /BENÍTEZ BRUNO/ }));
    expect(screen.getByRole('status')).toHaveTextContent('Convocados: 3 de 4 · hay cambios sin guardar');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar convocatoria (3)' }));
    await waitFor(() => expect(guardarMock).toHaveBeenCalledWith('2026-11-05', ['03', '02']));
    expect(sileo.success).toHaveBeenCalled();
  });

  it('"Todo el cargo" y "Nadie" marcan o quitan a todo el cargo (salvo los de Parejas)', async () => {
    montar();
    const cpe = await screen.findByRole('group', { name: 'CPE · Digitador (1/2)' });
    await userEvent.click(within(cpe).getByRole('button', { name: 'Convocar a todo el cargo Digitador' }));
    expect(within(cpe).getAllByRole('checkbox').every((c) => (c as HTMLInputElement).checked)).toBe(true);
    const cda = screen.getByRole('group', { name: /CDA · Operador/ });
    await userEvent.click(within(cda).getByRole('button', { name: 'Quitar a todo el cargo Operador' }));
    expect(within(cda).getByRole('checkbox', { name: /ANDRADE ANA/ })).toBeChecked();
  });

  it('copiar de otra fecha trae sus convocados (también los que fueron en Parejas ese día)', async () => {
    getMock.mockImplementation((fecha: string) =>
      Promise.resolve(
        fecha === '2026-11-01'
          ? dia(fecha, [
              p('01', 'ANDRADE ANA', 'OPERADOR', 'Operador', 'CDA'),
              p('02', 'BENÍTEZ BRUNO', 'OPERADOR', 'Operador', 'CDA', { convocado: true, porPareja: true }),
              p('03', 'ZAPATA ZOE', 'DIGITADOR', 'Digitador', 'CPE'),
              p('04', 'ÁLVAREZ ALBA', 'DIGITADOR', 'Digitador', 'CPE', { convocado: true }),
            ])
          : dia(fecha),
      ),
    );
    // Ya hay marcas (Zoe): pide confirmar el reemplazo.
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
    montar();
    await screen.findByRole('group', { name: /CDA · Operador/ });
    fireEvent.change(screen.getByLabelText('Copiar de'), { target: { value: '2026-11-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await waitFor(() => expect(confirmar).toHaveBeenCalledWith('¿Reemplazar las marcas actuales por los 2 convocados del 2026-11-01?'));
    confirmar.mockRestore();
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /BENÍTEZ BRUNO/ })).toBeChecked());
    expect(screen.getByRole('checkbox', { name: /ÁLVAREZ ALBA/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /ZAPATA ZOE/ })).not.toBeChecked();
    expect(guardarMock).not.toHaveBeenCalled();
  });

  it('"Todo el cargo" con una búsqueda solo convoca a los que se ven', async () => {
    montar();
    const cpe = await screen.findByRole('group', { name: 'CPE · Digitador (1/2)' });
    await userEvent.type(screen.getByLabelText('Buscar persona en la convocatoria'), 'alvarez');
    await userEvent.click(within(cpe).getByRole('button', { name: 'Convocar a todo el cargo Digitador (los de la búsqueda)' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar convocatoria (3)' }));
    await waitFor(() => expect(guardarMock).toHaveBeenCalledWith('2026-11-05', ['03', '04']));
  });

  it('cambiar de día con cambios sin guardar pide confirmar; si no, se queda', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    montar();
    await userEvent.click(await screen.findByRole('checkbox', { name: /BENÍTEZ BRUNO/ }));
    fireEvent.change(screen.getByLabelText('Día'), { target: { value: '2026-11-06' } });
    expect(confirmar).toHaveBeenCalled();
    expect(screen.getByLabelText('Día')).toHaveValue('2026-11-05');
    expect(screen.getByRole('checkbox', { name: /BENÍTEZ BRUNO/ })).toBeChecked();
    confirmar.mockRestore();
  });

  it('copiar de una fecha sin convocados avisa y no borra nada', async () => {
    getMock.mockImplementation((fecha: string) =>
      Promise.resolve(fecha === '2026-11-01' ? dia(fecha, dia().personas.map((x) => ({ ...x, convocado: false, porPareja: false }))) : dia(fecha)),
    );
    montar();
    await screen.findByRole('group', { name: /CDA · Operador/ });
    fireEvent.change(screen.getByLabelText('Copiar de'), { target: { value: '2026-11-01' } });
    await userEvent.click(screen.getByRole('button', { name: 'Copiar' }));
    await waitFor(() => expect(sileo.error).toHaveBeenCalledWith(expect.objectContaining({ title: 'El 2026-11-01 no tiene convocados' })));
    expect(screen.getByRole('checkbox', { name: /ZAPATA ZOE/ })).toBeChecked();
  });

  it('si no se puede guardar lo dice y conserva las marcas', async () => {
    guardarMock.mockRejectedValueOnce({ response: { data: { message: 'Alguna persona no existe o está oculta' } } });
    montar();
    await userEvent.click(await screen.findByRole('checkbox', { name: /BENÍTEZ BRUNO/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar convocatoria (3)' }));
    await waitFor(() => expect(sileo.error).toHaveBeenCalledWith({ title: 'Alguna persona no existe o está oculta' }));
    expect(screen.getByRole('checkbox', { name: /BENÍTEZ BRUNO/ })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Descartar cambios' }));
    expect(screen.getByRole('checkbox', { name: /BENÍTEZ BRUNO/ })).not.toBeChecked();
  });

  it('sin el permiso solo consulta', async () => {
    permisos.gestionar = false;
    montar();
    expect(await screen.findByText('Solo consulta: su rol no puede cambiar la convocatoria.')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /BENÍTEZ BRUNO/ })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Guardar convocatoria/ })).not.toBeInTheDocument();
  });

  it('cambiar un día pasado avisa que se recalculan sus faltas', async () => {
    montar();
    await screen.findByRole('group', { name: /CDA · Operador/ });
    fireEvent.change(screen.getByLabelText('Día'), { target: { value: '2026-11-01' } });
    expect(await screen.findByText(/Está cambiando un día pasado/)).toBeInTheDocument();
  });
});
