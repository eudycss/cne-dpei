import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ConsultaQrCda, OperadorCda } from '@cne/shared-types';

import { EscanearQrModal } from './EscanearQrModal';
import { GrupoCdaContext } from './grupo';
import { api } from '../../lib/api';
import { sileo } from 'sileo';

vi.mock('../../lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('sileo', () => ({ sileo: { error: vi.fn(), success: vi.fn() } }));
// La cámara real no existe en jsdom: el doble "lee" un código al pulsar un botón.
vi.mock('./CamaraQr', () => ({
  CamaraQr: ({ onLeido, pausado }: { onLeido: (c: string) => void; pausado?: boolean }) => (
    <button type="button" onClick={() => onLeido(TOKEN)}>
      {pausado ? 'cámara en pausa' : 'simular lectura'}
    </button>
  ),
}));

const postMock = api.post as unknown as ReturnType<typeof vi.fn>;
const getMock = api.get as unknown as ReturnType<typeof vi.fn>;
const TOKEN = `CDA1${'ABCDEFGHJKLMN'.repeat(2)}`;

const ANA: OperadorCda = {
  id: 'a',
  grupo: 'OPERADOR',
  numero: 1,
  apellidosNombres: 'PÉREZ LÓPEZ ANA MARÍA',
  cedula: '1710034065',
  telefono: null,
  cargo: 'OPERADOR CDA',
  unidad: null,
  fechaInicio: null,
  tieneFoto: false,
  activo: true,
  creadoEn: '2026-10-20T10:00:00Z',
};

const consulta = (over: Partial<ConsultaQrCda> = {}): ConsultaQrCda => ({
  operador: ANA,
  siguiente: 'ENTRADA',
  entradaEn: null,
  salidaEn: null,
  salidaDesde: null,
  ...over,
});

function renderModal(grupo: 'OPERADOR' | 'ASISTENTE' = 'OPERADOR') {
  const onMarcado = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GrupoCdaContext.Provider value={grupo}>
        <EscanearQrModal onClose={vi.fn()} onMarcado={onMarcado} />
      </GrupoCdaContext.Provider>
    </QueryClientProvider>,
  );
  return onMarcado;
}

const campo = () => screen.getByLabelText('Código del carnet');

describe('EscanearQrModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lector USB con foto: el código + Enter muestra la foto; confirmar registra y vuelve a esperar', async () => {
    const CON_FOTO = { ...ANA, tieneFoto: true };
    const crear = vi.fn(() => 'blob:foto');
    Object.assign(URL, { createObjectURL: crear, revokeObjectURL: vi.fn() });
    getMock.mockResolvedValueOnce({ data: new Blob(['jpeg']) });
    postMock
      .mockResolvedValueOnce({ data: consulta({ operador: CON_FOTO }) })
      .mockResolvedValueOnce({
        data: { operador: CON_FOTO, entradaEn: '2026-10-23T13:01:00Z', entradaPor: 'Yo', salidaEn: null, salidaPor: null },
      });
    const onMarcado = renderModal();
    expect(campo()).toHaveFocus();

    // Minúsculas por Bloq Mayús: se normaliza.
    await userEvent.type(campo(), `${TOKEN.toLowerCase()}{Enter}`);

    expect(await screen.findByRole('img', { name: 'Foto de PÉREZ LÓPEZ ANA MARÍA' })).toHaveAttribute('src', 'blob:foto');
    expect(getMock).toHaveBeenCalledWith('/operadores-cda/a/foto', { responseType: 'blob' });
    expect(postMock).toHaveBeenCalledWith('/operadores-cda/asistencia/qr/consultar', { token: TOKEN });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    const confirmar = screen.getByRole('button', { name: 'Registrar entrada' });
    expect(confirmar).toHaveFocus();

    await userEvent.click(confirmar);

    await waitFor(() => expect(onMarcado).toHaveBeenCalled());
    expect(postMock).toHaveBeenLastCalledWith('/operadores-cda/asistencia/qr', { token: TOKEN, tipo: 'ENTRADA' });
    expect(sileo.success).toHaveBeenCalledWith({
      title: 'Entrada registrada a las 08:01',
      description: 'PÉREZ LÓPEZ ANA MARÍA',
    });
    expect(screen.getByRole('status')).toHaveTextContent('Entrada registrada a las 08:01: PÉREZ LÓPEZ ANA MARÍA');
    await waitFor(() => expect(campo()).toHaveFocus());
    expect(campo()).toHaveValue('');
  });

  it('sin foto: avisa que verifique la cédula y deja registrar directo, sin casilla', async () => {
    postMock.mockResolvedValueOnce({ data: consulta() });
    renderModal();
    await userEvent.type(campo(), `${TOKEN}{Enter}`);

    expect(await screen.findByText(/Sin foto registrada/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    const confirmar = screen.getByRole('button', { name: 'Registrar entrada' });
    expect(confirmar).toBeEnabled();
    expect(confirmar).toHaveFocus();
  });

  it('si otro técnico marcó antes (409), muestra el motivo y vuelve a esperar', async () => {
    postMock
      .mockResolvedValueOnce({ data: consulta({ operador: { ...ANA, tieneFoto: true } }) })
      .mockRejectedValueOnce({ response: { data: { message: 'La entrada de hoy ya estaba registrada a las 08:00' } } });
    getMock.mockResolvedValueOnce({ data: new Blob(['jpeg']) });
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() });
    const onMarcado = renderModal();
    await userEvent.type(campo(), `${TOKEN}{Enter}`);
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar entrada' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('La entrada de hoy ya estaba registrada a las 08:00');
    expect(campo()).toBeInTheDocument();
    expect(onMarcado).not.toHaveBeenCalled();
  });

  it('sin conexión no escanea ni marca, y lo dice; al volver la red se puede seguir', async () => {
    const enLinea = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderModal();
    expect(screen.getByRole('alert')).toHaveTextContent('el carnet solo se puede escanear con conexión');
    expect(campo()).toBeDisabled();

    enLinea.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(campo()).toBeEnabled();
    expect(postMock).not.toHaveBeenCalled();
    enLinea.mockRestore();
  });

  it('un carnet del otro grupo se acepta pero avisa en qué asistencia queda la marca', async () => {
    postMock.mockResolvedValueOnce({ data: consulta() });
    renderModal('ASISTENTE');
    await userEvent.type(campo(), `${TOKEN}{Enter}`);
    expect(await screen.findByText(/Este carnet es de Operadores CDA/)).toHaveTextContent(
      'la marca se registrará en la asistencia de operadores',
    );
    expect(screen.getByRole('button', { name: 'Registrar entrada' })).toBeInTheDocument();
  });

  it('un carnet del mismo grupo no muestra el aviso', async () => {
    postMock.mockResolvedValueOnce({ data: consulta() });
    renderModal('OPERADOR');
    await userEvent.type(campo(), `${TOKEN}{Enter}`);
    await screen.findByRole('button', { name: 'Registrar entrada' });
    expect(screen.queryByText(/Este carnet es de/)).not.toBeInTheDocument();
  });

  it('un código que no es carnet no llega a la API', async () => {
    renderModal();
    await userEvent.type(campo(), 'KIT-12345{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Código no reconocido: no es un carnet CDA');
    expect(postMock).not.toHaveBeenCalled();
  });

  it('carnet anulado: muestra el error del servidor y sigue esperando', async () => {
    postMock.mockRejectedValueOnce({ response: { data: { message: 'Credencial no válida o anulada' } } });
    renderModal();
    await userEvent.type(campo(), `${TOKEN}{Enter}`);
    expect(await screen.findByRole('alert')).toHaveTextContent('Credencial no válida o anulada');
    expect(campo()).toBeInTheDocument();
  });

  it('salida antes de tiempo: no deja confirmar y avisa desde cuándo', async () => {
    postMock.mockResolvedValueOnce({
      data: consulta({ siguiente: 'SALIDA', entradaEn: '2026-10-23T13:01:00Z', salidaDesde: '2999-01-01T13:06:00Z' }),
    });
    renderModal();
    await userEvent.type(campo(), `${TOKEN}{Enter}`);
    expect(await screen.findByRole('button', { name: 'Registrar salida' })).toBeDisabled();
    expect(screen.getByText(/la salida con el carnet se acepta desde las/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  });

  it('día completo: lo informa y no ofrece marcar', async () => {
    postMock.mockResolvedValueOnce({
      data: consulta({ siguiente: 'COMPLETO', entradaEn: '2026-10-23T13:01:00Z', salidaEn: '2026-10-23T22:00:00Z' }),
    });
    renderModal();
    await userEvent.type(campo(), `${TOKEN}{Enter}`);
    expect(await screen.findByText('Ya registró la entrada y la salida de hoy.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Registrar/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Escanear otro' }));
    expect(campo()).toBeInTheDocument();
  });

  it('cámara: la misma lectura repetida en segundos se consulta una sola vez', async () => {
    postMock.mockResolvedValue({ data: consulta() });
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: 'Usar cámara' }));
    expect(screen.getByRole('button', { name: 'Apagar cámara' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'simular lectura' }));
    await screen.findByText('PÉREZ LÓPEZ ANA MARÍA');
    // Mientras se confirma, la cámara se pausa (no se apaga ni vuelve a pedir permiso).
    expect(screen.getByRole('button', { name: 'cámara en pausa' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await userEvent.click(screen.getByRole('button', { name: 'simular lectura' }));
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Ese carnet se acaba de leer: espere unos segundos');
  });
});
