import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AsistenciaCdaDia, AsistenciaCdaFila, OperadorCda } from '@cne/shared-types';

import { AsistenciaPanel } from './AsistenciaPanel';
import { api } from '../../lib/api';
import { sileo } from 'sileo';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { error: vi.fn(), success: vi.fn(), action: vi.fn() } }));

const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
const deleteMock = api.delete as unknown as ReturnType<typeof vi.fn>;

const operador = (id: string, apellidosNombres: string, cedula: string): OperadorCda => ({
  id,
  numero: null,
  apellidosNombres,
  cedula,
  telefono: '0987923273',
  cargo: 'OPERADOR CDA',
  unidad: null,
  fechaInicio: '2026-10-20',
  tieneFoto: false,
  activo: true,
  creadoEn: '2026-10-20T10:00:00.000Z',
});

const ANA = operador('a', 'ANDRADE LÓPEZ ANA MARÍA', '1710034065');
const LUIS = operador('l', 'VEGA TAPIA LUIS ALBERTO', '1002003000');
const MARIA = operador('m', 'CHÁVEZ MORA MARÍA JOSÉ', '0102030400');

// 13:05 UTC = 08:05 en Ecuador.
const fila = (o: OperadorCda, over: Partial<AsistenciaCdaFila> = {}): AsistenciaCdaFila => ({
  operador: o,
  entradaEn: null,
  entradaPor: null,
  salidaEn: null,
  salidaPor: null,
  ...over,
});

function dia(over: Partial<AsistenciaCdaDia> = {}): AsistenciaCdaDia {
  return {
    fecha: '2026-10-22',
    esHoy: true,
    filas: [
      fila(ANA, { entradaEn: '2026-10-22T13:05:00.000Z', entradaPor: 'Técnico Uno' }),
      fila(LUIS),
      fila(MARIA, {
        entradaEn: '2026-10-22T13:00:00.000Z',
        entradaPor: 'Técnico Uno',
        salidaEn: '2026-10-22T22:45:00.000Z',
        salidaPor: 'Técnico Dos',
      }),
    ],
    ...over,
  };
}

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AsistenciaPanel />
    </QueryClientProvider>,
  );
}

const filaDe = (nombre: string) => screen.getByRole('rowheader', { name: new RegExp(nombre) }).closest('tr')!;

describe('AsistenciaPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMock.mockResolvedValue({ data: dia() });
  });

  it('resume el día y muestra cada marca con su hora en Ecuador', async () => {
    renderPanel();

    const resumen = await screen.findByRole('group', { name: 'Resumen del día' });
    expect(within(resumen).getByText('2 / 3')).toBeInTheDocument();
    expect(within(resumen).getByText('Pendientes de salida').nextSibling).toHaveTextContent('1');

    const entradaAna = within(filaDe('ANDRADE')).getByRole('button', { name: 'Entrada de ANDRADE LÓPEZ ANA MARÍA' });
    expect(entradaAna).toHaveAttribute('aria-pressed', 'true');
    expect(entradaAna).toHaveAccessibleDescription('Registrada a las 08:05 por Técnico Uno. Pulse para quitarla.');
    expect(within(filaDe('CHÁVEZ')).getByRole('button', { name: /^Salida de/ })).toHaveAccessibleDescription(/17:45 por Técnico Dos/);
    expect(within(filaDe('VEGA')).getByRole('button', { name: /^Entrada de/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('la salida queda inactiva sin entrada, pero se puede enfocar y explica por qué', async () => {
    renderPanel();
    await screen.findByRole('group', { name: 'Resumen del día' });
    const salida = within(filaDe('VEGA')).getByRole('button', { name: 'Salida de VEGA TAPIA LUIS ALBERTO' });
    expect(salida).toHaveAttribute('aria-disabled', 'true');
    expect(salida).not.toBeDisabled();
    expect(salida).toHaveAccessibleDescription('Pendiente. Primero marque la entrada');

    await userEvent.click(salida);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('marcar la entrada actualiza la fila y ofrece deshacer durante 5 s', async () => {
    postMock.mockResolvedValueOnce({
      data: fila(LUIS, { entradaEn: '2026-10-22T13:30:00.000Z', entradaPor: 'Yo Mismo' }),
    });
    renderPanel();
    await screen.findByRole('group', { name: 'Resumen del día' });

    await userEvent.click(within(filaDe('VEGA')).getByRole('button', { name: /^Entrada de VEGA/ }));

    expect(postMock).toHaveBeenCalledWith('/operadores-cda/l/asistencia', { tipo: 'ENTRADA' });
    await waitFor(() =>
      expect(within(filaDe('VEGA')).getByRole('button', { name: /^Entrada de VEGA/ })).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(within(filaDe('VEGA')).getByRole('button', { name: /^Entrada de VEGA/ })).toHaveAccessibleDescription(/08:30 por Yo Mismo/);

    const aviso = (sileo.action as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(aviso).toMatchObject({ title: 'Entrada registrada', duration: 5000, button: { title: 'Deshacer' } });
    deleteMock.mockResolvedValueOnce({});
    aviso.button.onClick();
    // Solo quita la marca que se acaba de poner (si otro técnico la cambió, la API responde 409).
    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith(
        `/operadores-cda/l/asistencia/ENTRADA?marcaEn=${encodeURIComponent('2026-10-22T13:30:00.000Z')}`,
      ),
    );
  });

  it('si otro técnico ya marcó, muestra el mensaje de la API y recarga', async () => {
    postMock.mockRejectedValueOnce({ response: { data: { message: 'La entrada de hoy ya estaba registrada a las 08:01 por Técnico Dos' } } });
    renderPanel();
    await screen.findByRole('group', { name: 'Resumen del día' });

    await userEvent.click(within(filaDe('VEGA')).getByRole('button', { name: /^Entrada de VEGA/ }));

    await waitFor(() =>
      expect(sileo.error).toHaveBeenCalledWith({ title: 'La entrada de hoy ya estaba registrada a las 08:01 por Técnico Dos' }),
    );
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
  });

  it('pulsar una marca pide confirmación antes de quitarla', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    deleteMock.mockResolvedValueOnce({});
    renderPanel();
    await screen.findByRole('group', { name: 'Resumen del día' });
    const entradaAna = within(filaDe('ANDRADE')).getByRole('button', { name: /^Entrada de ANDRADE/ });

    await userEvent.click(entradaAna);
    expect(deleteMock).not.toHaveBeenCalled();
    await userEvent.click(entradaAna);

    expect(confirmar).toHaveBeenLastCalledWith('¿Quitar la entrada de hoy de ANDRADE LÓPEZ ANA MARÍA?');
    await waitFor(() =>
      expect(deleteMock).toHaveBeenCalledWith(
        `/operadores-cda/a/asistencia/ENTRADA?marcaEn=${encodeURIComponent('2026-10-22T13:05:00.000Z')}`,
      ),
    );
  });

  it('filtra por estado y busca sin tildes', async () => {
    renderPanel();
    await screen.findByRole('group', { name: 'Resumen del día' });

    await userEvent.click(screen.getByRole('button', { name: 'Sin entrada · 1' }));
    expect(screen.getByRole('button', { name: 'Sin entrada · 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('rowheader')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Todos · 3' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Buscar operador por nombre o cédula' }), 'chavez');
    const filas = screen.getAllByRole('rowheader');
    expect(filas).toHaveLength(1);
    expect(filas[0]).toHaveTextContent('CHÁVEZ MORA MARÍA JOSÉ');
    // Bajo el nombre va el cargo abreviado, como en Figma.
    expect(filas[0]).toHaveTextContent('Operador CDA');
  });

  it('el marcado masivo confirma y envía solo a los pendientes visibles', async () => {
    postMock.mockResolvedValueOnce({ data: { marcados: 1, omitidos: 0, ignorados: 0 } });
    renderPanel();
    await screen.findByRole('group', { name: 'Resumen del día' });

    await userEvent.click(screen.getByRole('button', { name: 'Marcar entrada a pendientes (1)' }));
    const dialogo = screen.getByRole('dialog', { name: 'Marcar entrada a 1 operador(es)' });
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Marcar entrada' }));

    expect(postMock).toHaveBeenCalledWith('/operadores-cda/asistencia/masiva', { tipo: 'ENTRADA', operadorIds: ['l'] });
    await waitFor(() => expect(sileo.success).toHaveBeenCalledWith({ title: '1 entrada(s) registrada(s)', description: undefined }));
  });

  it('un día pasado es solo consulta: sin marcado masivo y con los checks deshabilitados', async () => {
    getMock.mockResolvedValueOnce({ data: dia() }).mockResolvedValueOnce({ data: dia({ fecha: '2026-10-21', esHoy: false }) });
    renderPanel();
    await screen.findByRole('group', { name: 'Resumen del día' });

    fireEvent.change(screen.getByLabelText('Día'), { target: { value: '2026-10-21' } });

    expect(await screen.findByText(/Está viendo un día pasado/)).toBeInTheDocument();
    expect(getMock).toHaveBeenLastCalledWith('/operadores-cda/asistencia?fecha=2026-10-21');
    expect(screen.queryByRole('button', { name: /pendientes/ })).not.toBeInTheDocument();
    expect(within(filaDe('VEGA')).getByRole('button', { name: /^Entrada de VEGA/ })).toHaveAttribute('aria-disabled', 'true');
  });
});
