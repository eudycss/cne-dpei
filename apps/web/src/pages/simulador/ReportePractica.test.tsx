import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FilaReporteSimulador, IntentoReporteSimulador, PracticaDigitacion, ReporteSimulador } from '@cne/shared-types';

import { debeRefrescar, ReportePractica, resultado } from './ReportePractica';
import { api } from '../../lib/api';
import { guardar } from '../../lib/queries/operadores-cda';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/queries/operadores-cda', async (original) => ({
  ...(await original<typeof import('../../lib/queries/operadores-cda')>()),
  guardar: vi.fn(),
}));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const guardarMock = guardar as unknown as ReturnType<typeof vi.fn>;
const ID = '11111111-1111-4111-8111-111111111111';
const ANA = '22222222-2222-4222-8222-222222222222';

const PRACTICA = { id: ID, nombre: 'Simulacro 1', metaActas: 20, plazoMinutos: 30 } as PracticaDigitacion;

const intento = (o: Partial<IntentoReporteSimulador> = {}): IntentoReporteSimulador => ({
  numero: 1,
  cargo: 'Digitadores',
  iniciadoEn: '2026-11-10T14:00:00.000Z',
  terminadoEn: '2026-11-10T14:30:00.000Z',
  motivo: 'TIEMPO',
  minutos: 30,
  segundos: 1800,
  actasFaltantes: 10,
  filasDigitadas: 100,
  filasCorrectas: 90,
  filasConError: 10,
  registrosPorMinuto: 3.3,
  actasCompletadas: 10,
  actasPerfectas: 8,
  actasConError: 2,
  cumplio: false,
  ...o,
});

const fila = (o: Partial<FilaReporteSimulador>): FilaReporteSimulador => ({
  operadorId: ANA,
  cedula: '1710034065',
  apellidosNombres: 'ANA PÉREZ',
  telefono: '0991234567',
  cargo: 'Digitadores',
  estado: 'TERMINADO',
  asignada: true,
  intentos: [],
  mejor: null,
  cumplio: false,
  ...o,
});

const REPORTE: ReporteSimulador = {
  practica: { id: ID, nombre: 'Simulacro 1', metaActas: 20, plazoMinutos: 30, filasPorActa: 10, inicio: '2026-11-10T13:00:00.000Z', fin: '2026-11-10T23:00:00.000Z' },
  generadoEn: '2026-11-10T15:00:00.000Z',
  totales: { personas: 2, presentaron: 1, cumplieron: 1, enCurso: 0, noSePresentaron: 1 },
  filas: [
    fila({
      intentos: [intento(), intento({ numero: 2, motivo: 'META', cumplio: true, segundos: 1104, actasFaltantes: 0, actasCompletadas: 20, filasCorrectas: 198, filasDigitadas: 200, filasConError: 2 })],
      mejor: 2,
      cumplio: true,
    }),
    fila({ operadorId: '33333333-3333-4333-8333-333333333333', cedula: '1002003004', apellidosNombres: 'LUIS MORA', telefono: null, estado: 'NO_SE_PRESENTO' }),
  ],
};

function renderReporte(onVolver = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReportePractica practica={PRACTICA} onVolver={onVolver} />
    </QueryClientProvider>,
  );
  return { onVolver };
}

describe('ReportePractica', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockImplementation((url: string) => {
      if (url.endsWith('/reporte')) return Promise.resolve({ data: REPORTE });
      return Promise.resolve({ data: new Blob(['x']), headers: { 'content-disposition': 'attachment; filename="simulador_digitacion_2026.xlsx"' } });
    });
  });

  it('totales y una fila por persona con su mejor intento; quien no se presentó, con guiones', async () => {
    renderReporte();
    const tabla = await screen.findByRole('table', { name: 'Reporte de Simulacro 1' });
    expect(getMock).toHaveBeenCalledWith(`/simulador-digitacion/practicas/${ID}/reporte`);
    const resumen = screen.getByLabelText('Resumen');
    expect(within(resumen).getByText('Cumplieron la meta').nextElementSibling).toHaveTextContent('1');
    expect(within(resumen).getByText('No se presentaron').nextElementSibling).toHaveTextContent('1');

    const [, ana, luis] = within(tabla).getAllByRole('row');
    const celdas = (r: HTMLElement) => within(r).getAllByRole('cell').map((c) => c.textContent);
    // Una columna por intento con su tiempo: cumplió → 18:24; se acabó → tiempo y actas que faltaron.
    expect(within(tabla).getByRole('columnheader', { name: 'Intento 1' })).toBeInTheDocument();
    expect(within(tabla).getByRole('columnheader', { name: 'Intento 2' })).toBeInTheDocument();
    expect(celdas(ana)).toEqual([
      '1', '0991234567', 'Digitadores', 'Terminó', '200', '198', '2', '3.3', '20 de 20', 'Sí', '30:00 · faltaron 10 actas', '18:24', 'Ver 2',
    ]);
    expect(celdas(luis)).toEqual(['2', '—', 'Digitadores', 'No se presentó', '—', '—', '—', '—', '—', '—', '—', '—', '0']);
  });

  it('filtra por estado', async () => {
    const user = userEvent.setup();
    renderReporte();
    await screen.findByRole('table', { name: 'Reporte de Simulacro 1' });
    await user.selectOptions(screen.getByLabelText('Mostrar'), 'ausentes');
    expect(screen.queryByText('ANA PÉREZ')).not.toBeInTheDocument();
    expect(screen.getByText('LUIS MORA')).toBeInTheDocument();
    expect(screen.getByText(/1 de 2/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Mostrar'), 'en-curso');
    expect(screen.getByText('Nadie en este filtro.')).toBeInTheDocument();
  });

  it('detalle de la persona: todos sus intentos, el mejor marcado, y su Excel/PDF', async () => {
    const user = userEvent.setup();
    renderReporte();
    await user.click(await screen.findByRole('button', { name: 'Ver los 2 intento(s) de ANA PÉREZ' }));
    const dialogo = screen.getByRole('dialog');
    const filas = within(within(dialogo).getByRole('table')).getAllByRole('row');
    expect(filas).toHaveLength(3);
    expect(filas[2]).toHaveTextContent('Mejor');
    expect(filas[2]).toHaveTextContent('Cumplió la meta');
    expect(within(dialogo).getByRole('columnheader', { name: 'Tiempo' })).toBeInTheDocument();
    expect(within(dialogo).queryByRole('columnheader', { name: 'Minutos' })).not.toBeInTheDocument();
    expect(filas[1]).toHaveTextContent('30:00 · faltaron 10 actas');
    expect(filas[2]).toHaveTextContent('18:24');
    await user.click(within(dialogo).getByRole('button', { name: 'Descargar PDF de ANA PÉREZ' }));
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith(`/simulador-digitacion/practicas/${ID}/reporte.pdf`, { params: { operadorId: ANA }, responseType: 'blob' }),
    );
    expect(guardarMock).toHaveBeenCalledWith(expect.any(Blob), 'simulador_digitacion_2026.xlsx');
  });

  it('Excel general sin persona; Volver', async () => {
    const user = userEvent.setup();
    const { onVolver } = renderReporte();
    await user.click(await screen.findByRole('button', { name: 'Descargar Excel del reporte general' }));
    await waitFor(() =>
      expect(getMock).toHaveBeenCalledWith(`/simulador-digitacion/practicas/${ID}/reporte.xlsx`, { params: undefined, responseType: 'blob' }),
    );
    await user.click(screen.getByRole('button', { name: 'Volver a prácticas' }));
    expect(onVolver).toHaveBeenCalled();
  });

  it('error al cargar: lo anuncia', async () => {
    getMock.mockRejectedValue({ response: { data: { message: 'Práctica no encontrada' } } });
    renderReporte();
    expect(await screen.findByRole('alert')).toHaveTextContent('Práctica no encontrada');
  });

  it('al entrar, el foco va al título del reporte', async () => {
    renderReporte();
    expect(screen.getByRole('heading', { name: 'Reporte: Simulacro 1' })).toHaveFocus();
  });

  it('mientras descarga, el botón anuncia que está descargando', async () => {
    const user = userEvent.setup();
    let soltar: (v: unknown) => void = () => {};
    renderReporte();
    await screen.findByRole('table', { name: 'Reporte de Simulacro 1' });
    getMock.mockImplementationOnce(() => new Promise((r) => (soltar = r)));
    await user.click(screen.getByRole('button', { name: 'Descargar PDF del reporte general' }));
    expect(screen.getByRole('button', { name: 'Descargando PDF…' })).toHaveAttribute('aria-disabled', 'true');
    soltar({ data: new Blob(['x']), headers: {} });
    expect(await screen.findByRole('button', { name: 'Descargar PDF del reporte general' })).toBeInTheDocument();
  });

  it('"Terminaron sin cumplir" no incluye a quien está en curso', async () => {
    const user = userEvent.setup();
    getMock.mockResolvedValue({
      data: { ...REPORTE, filas: [fila({ estado: 'EN_CURSO', intentos: [intento(), intento({ numero: 2, motivo: null })], mejor: 1 })] },
    });
    renderReporte();
    await screen.findByRole('table', { name: 'Reporte de Simulacro 1' });
    await user.selectOptions(screen.getByLabelText('Mostrar'), 'no-cumplieron');
    expect(screen.getByText('Nadie en este filtro.')).toBeInTheDocument();
  });

  it('se refresca solo si hay alguien digitando o la práctica sigue abierta', () => {
    const p = { ...PRACTICA, activa: true, inicio: '2026-11-10T13:00:00.000Z', fin: '2026-11-10T15:00:00.000Z', plazoMinutos: 30 };
    const t = (iso: string) => new Date(iso).getTime();
    expect(debeRefrescar(p, 0, t('2026-11-10T14:00:00Z'))).toBe(true);
    // Hasta el fin de la ventana + el plazo (quien empezó al final sigue digitando).
    expect(debeRefrescar(p, 0, t('2026-11-10T15:25:00Z'))).toBe(true);
    expect(debeRefrescar(p, 0, t('2026-11-10T16:00:00Z'))).toBe(false);
    expect(debeRefrescar(p, 2, t('2026-11-10T16:00:00Z'))).toBe(true);
    expect(debeRefrescar({ ...p, activa: false }, 0, t('2026-11-10T14:00:00Z'))).toBe(false);
  });

  it('texto del resultado', () => {
    expect(resultado(intento({ motivo: null }))).toBe('En curso');
    expect(resultado(intento())).toBe('Se acabó el tiempo');
  });
});
