import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReporteAtrasosCda, RoleName } from '@cne/shared-types';

import { AtrasosPanel } from './AtrasosPanel';
import { api } from '../../lib/api';
import { sileo } from 'sileo';
import { hoyEcuador } from './utils';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), put: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { error: vi.fn(), success: vi.fn() } }));
let roles: RoleName[] = ['ADMINISTRADOR'];
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ user: { roles } }) }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const putMock = (api as unknown as { put: ReturnType<typeof vi.fn> }).put;

const ANA = { operadorId: 'a', apellidosNombres: 'ANDRADE LÓPEZ ANA', cedula: '1710034065' };
const LUIS = { operadorId: 'l', apellidosNombres: 'VEGA TAPIA LUIS', cedula: '1002003000' };

const REPORTE: ReporteAtrasosCda = {
  desde: '2026-10-20',
  hasta: '2026-10-21',
  config: { horaEntrada: '08:00', minutosGracia: 10 },
  totales: { puntuales: 1, atrasos: 2, faltas: 1, pendientes: 0, minutosAtraso: 71 },
  resumen: [
    { ...ANA, puntuales: 1, atrasos: 1, faltas: 0, minutosAtraso: 11 },
    { ...LUIS, puntuales: 0, atrasos: 1, faltas: 1, minutosAtraso: 60 },
  ],
  filas: [
    { ...ANA, fecha: '2026-10-20', entrada: '08:10', minutosAtraso: 0, estado: 'PUNTUAL' },
    { ...LUIS, fecha: '2026-10-20', entrada: '09:00', minutosAtraso: 60, estado: 'ATRASO' },
    { ...ANA, fecha: '2026-10-21', entrada: '08:11', minutosAtraso: 11, estado: 'ATRASO' },
    { ...LUIS, fecha: '2026-10-21', entrada: null, minutosAtraso: 0, estado: 'FALTA' },
  ],
};

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AtrasosPanel />
    </QueryClientProvider>,
  );
}

describe('AtrasosPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roles = ['ADMINISTRADOR'];
    getMock.mockImplementation((url: string) =>
      Promise.resolve({
        data: url.startsWith('/operadores-cda/asistencia/config') ? REPORTE.config : REPORTE,
      }),
    );
  });

  it('pide el mes en curso y muestra la regla, los totales y el resumen ordenado por atrasos', async () => {
    renderPanel();
    const hoy = hoyEcuador();
    await screen.findByText(/es atraso/);
    expect(getMock).toHaveBeenCalledWith(
      `/operadores-cda/asistencia/atrasos?desde=${hoy.slice(0, 8)}01&hasta=${hoy}&grupo=OPERADOR`,
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'Hora de entrada 08:00 · gracia de 10 min: entrada hasta las 08:10 es puntual; desde las 08:11 es atraso',
    );
    const kpis = screen.getByRole('group', { name: 'Resumen del periodo' });
    expect(within(kpis).getByText('Atrasos').parentElement).toHaveTextContent('2');
    expect(within(kpis).getByText('Minutos de atraso').parentElement).toHaveTextContent('Promedio 36 min por atraso');

    const filas = within(screen.getByRole('region', { name: 'Atrasos por operador' })).getAllByRole('row');
    // A igual número de atrasos, primero el que suma más minutos.
    expect(filas[1]).toHaveTextContent('VEGA TAPIA LUIS');
    expect(filas[2]).toHaveTextContent('ANDRADE LÓPEZ ANA');
  });

  it('el detalle filtra por estado y por nombre', async () => {
    renderPanel();
    await userEvent.click(await screen.findByRole('button', { name: 'Detalle por día' }));
    const tabla = () => screen.getByRole('region', { name: 'Detalle de atrasos por día' });
    expect(within(tabla()).getAllByRole('row')).toHaveLength(5);

    await userEvent.click(screen.getByRole('button', { name: /Atrasos · 2/ }));
    const atrasos = within(tabla()).getAllByRole('row').slice(1);
    expect(atrasos.map((r) => r.textContent)).toEqual([
      expect.stringContaining('09:0060Atraso'),
      expect.stringContaining('08:1111Atraso'),
    ]);

    await userEvent.click(screen.getByRole('button', { name: /Faltas · 1/ }));
    expect(within(tabla()).getAllByRole('row')[1]).toHaveTextContent('VEGA TAPIA LUIS');

    await userEvent.click(screen.getByRole('button', { name: /Todos · 4/ }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Buscar operador por nombre o cédula' }), 'andrade');
    expect(within(tabla()).getAllByRole('row')).toHaveLength(3);
  });

  it('un rango invertido muestra el error y no consulta', async () => {
    renderPanel();
    await screen.findByText(/es atraso/);
    getMock.mockClear();
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2099-01-01' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('La fecha inicial es posterior a la final');
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeDisabled();
    expect(getMock).not.toHaveBeenCalledWith(expect.stringContaining('2099-01-01'));
  });

  it('solo el administrador ve "Hora de entrada"', async () => {
    roles = ['TECNICO_SUPERVISOR'];
    renderPanel();
    await screen.findByText(/es atraso/);
    expect(screen.queryByRole('button', { name: 'Hora de entrada' })).not.toBeInTheDocument();
    expect(getMock).not.toHaveBeenCalledWith('/operadores-cda/asistencia/config?grupo=OPERADOR');
  });

  it('el administrador cambia la hora y la gracia; valida antes de enviar', async () => {
    putMock.mockResolvedValueOnce({ data: { horaEntrada: '07:30', minutosGracia: 5 } });
    renderPanel();
    const boton = await screen.findByRole('button', { name: 'Hora de entrada' });
    await waitFor(() => expect(boton).toBeEnabled());
    await userEvent.click(boton);

    const dialogo = screen.getByRole('dialog', { name: 'Hora de entrada' });
    const gracia = within(dialogo).getByLabelText('Minutos de gracia');
    await userEvent.clear(gracia);
    await userEvent.type(gracia, '200');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
    expect(within(dialogo).getByText('Máximo 120 minutos')).toBeInTheDocument();
    expect(gracia).toHaveAttribute('aria-invalid', 'true');
    expect(putMock).not.toHaveBeenCalled();

    fireEvent.change(within(dialogo).getByLabelText('Hora oficial de entrada'), { target: { value: '07:30' } });
    await userEvent.clear(gracia);
    await userEvent.type(gracia, '5');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(putMock).toHaveBeenCalledWith('/operadores-cda/asistencia/config?grupo=OPERADOR', { horaEntrada: '07:30', minutosGracia: 5 }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(sileo.success).toHaveBeenCalledWith({ title: 'Hora de entrada: 07:30 con 5 min de gracia' });
  });
});
