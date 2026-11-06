import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { MochilaPorQr } from '@cne/shared-types';

import { EscanearMochilasModal } from './EscanearMochilasModal';
import { buscarMochilaPorQr, guardarNumeroMochila } from '../../lib/queries/kits';

vi.mock('../../lib/queries/kits', () => ({ buscarMochilaPorQr: vi.fn(), guardarNumeroMochila: vi.fn() }));
vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));
// La cámara real no existe en jsdom: dos botones simulan leer un QR o que falle.
vi.mock('../operadores-cda/CamaraQr', () => ({
  CamaraQr: ({ onLeido, onError, pausado }: { onLeido: (c: string) => void; onError: (m: string) => void; pausado?: boolean }) => (
    <div>
      <span>{pausado ? 'cámara en pausa' : 'cámara leyendo'}</span>
      <button type="button" onClick={() => onLeido('p2zcerv4')}>
        leer QR
      </button>
      <button type="button" onClick={() => onLeido('https://otra-cosa.com')}>
        leer otro QR
      </button>
      <button type="button" onClick={() => onLeido('ZZZZ9999')}>
        leer otra mochila
      </button>
      <button type="button" onClick={() => onError('El navegador no dio permiso para usar la cámara')}>
        fallar cámara
      </button>
    </div>
  ),
}));

const buscarMock = buscarMochilaPorQr as unknown as ReturnType<typeof vi.fn>;
const guardarMock = guardarNumeroMochila as unknown as ReturnType<typeof vi.fn>;

const mochila = (numeroMochila: number | null): MochilaPorQr => ({
  kitId: 'kit-1',
  codigoUnico: 'P2ZCERV4',
  numeroMochila,
  nombreKit: 'Kit Recinto 1440',
  evento: '2 Prueba Técnica',
  recinto: { codigoRecinto: '1440', nombre: 'UE Atahualpa' },
});

function abrir(puedeReemplazar = false) {
  const onGuardado = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EscanearMochilasModal puedeReemplazar={puedeReemplazar} onClose={vi.fn()} onGuardado={onGuardado} />
    </QueryClientProvider>,
  );
  return { onGuardado };
}

describe('EscanearMochilasModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('una mochila sin número pide registrarlo; al guardar avisa y vuelve a escanear', async () => {
    buscarMock.mockResolvedValue({ data: mochila(null) });
    guardarMock.mockResolvedValue({ data: { codigoUnico: 'P2ZCERV4', numeroMochila: 54, numeroAnterior: null, quitadoDe: null } });
    const { onGuardado } = abrir();

    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    expect(buscarMock).toHaveBeenCalledWith('P2ZCERV4');
    expect(await screen.findByRole('heading', { name: '1440 · UE Atahualpa' })).toBeInTheDocument();
    expect(screen.getByText('cámara en pausa')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('N.º de mochila (1 a 9999)'), '54');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(guardarMock).toHaveBeenCalledWith('kit-1', { numero: 54 }));
    expect(await screen.findByRole('status')).toHaveTextContent('QR P2ZCERV4 = mochila N.º 54. Escanee la siguiente.');
    expect(onGuardado).toHaveBeenCalled();
    expect(screen.getByText('cámara leyendo')).toBeInTheDocument();
  });

  it('una mochila que ya tiene número lo muestra; se puede corregir', async () => {
    buscarMock.mockResolvedValue({ data: mochila(54) });
    guardarMock.mockResolvedValue({ data: { codigoUnico: 'P2ZCERV4', numeroMochila: 45, numeroAnterior: 54, quitadoDe: null } });
    abrir();

    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    expect(await screen.findByText(/Esta mochila ya tiene el/)).toHaveTextContent('Esta mochila ya tiene el N.º 54.');
    expect(screen.queryByLabelText('N.º de mochila (1 a 9999)')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Corregir número' }));
    const campo = screen.getByLabelText('N.º de mochila (1 a 9999)');
    expect(campo).toHaveValue('54');
    await userEvent.clear(campo);
    await userEvent.type(campo, '45');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(guardarMock).toHaveBeenCalledWith('kit-1', { numero: 45 }));
  });

  it('el supervisor: si el número es de otra mochila solo ve el aviso, sin opción de pasárselo', async () => {
    buscarMock.mockResolvedValue({ data: mochila(null) });
    guardarMock.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 409,
        data: { codigo: 'MOCHILA_EN_OTRO_QR', message: 'La mochila N.º 23 ya está ligada al QR OTRO2345. Revise el número de la mochila; si está bien, avise al administrador.' },
      },
    });
    abrir(false);

    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    await userEvent.type(await screen.findByLabelText('N.º de mochila (1 a 9999)'), '23');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(/avise al administrador/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sí, pasárselo a este kit' })).not.toBeInTheDocument();
  });

  it('un QR que no es de kit avisa sin consultar la API; lecturas repetidas del mismo QR se buscan una vez', async () => {
    buscarMock.mockResolvedValue({ data: mochila(54) });
    abrir();
    await userEvent.click(screen.getByRole('button', { name: 'leer otro QR' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Ese código no es de un kit');
    expect(buscarMock).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    await screen.findByText(/Esta mochila ya tiene el/);
    await userEvent.click(screen.getByRole('button', { name: 'Escanear siguiente' }));
    expect(buscarMock).toHaveBeenCalledTimes(1);
  });

  it('si la cámara falla lo dice y se puede escribir el código a mano', async () => {
    buscarMock.mockResolvedValue({ data: mochila(null) });
    abrir();
    await userEvent.click(screen.getByRole('button', { name: 'fallar cámara' }));
    expect(screen.getByRole('alert')).toHaveTextContent('El navegador no dio permiso para usar la cámara. Puede escribir el código a mano.');
    expect(screen.queryByText('cámara leyendo')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Código del QR (si la cámara no lo lee)'), 'p2zcerv4');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(buscarMock).toHaveBeenCalledWith('P2ZCERV4'));
  });

  it('la misma mochila, aún frente a la cámara tras "Escanear siguiente", no se reabre; escrita a mano sí', async () => {
    buscarMock.mockResolvedValue({ data: mochila(54) });
    abrir();
    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Escanear siguiente' }));
    expect(screen.getByRole('heading', { name: 'Escanear mochilas' })).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    expect(buscarMock).toHaveBeenCalledTimes(1);
    // Otra mochila sí se busca enseguida.
    await userEvent.click(screen.getByRole('button', { name: 'leer otra mochila' }));
    await waitFor(() => expect(buscarMock).toHaveBeenLastCalledWith('ZZZZ9999'));
    await userEvent.click(await screen.findByRole('button', { name: 'Escanear siguiente' }));
    // Y la primera escrita a mano también.
    await userEvent.type(screen.getByLabelText('Código del QR (si la cámara no lo lee)'), 'P2ZCERV4');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(buscarMock).toHaveBeenCalledTimes(3));
  });

  it('con una mochila abierta, otra lectura de la cámara se ignora (no pisa lo que se está escribiendo)', async () => {
    buscarMock.mockResolvedValue({ data: mochila(null) });
    abrir();
    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    await userEvent.type(await screen.findByLabelText('N.º de mochila (1 a 9999)'), '12');
    await userEvent.click(screen.getByRole('button', { name: 'leer otra mochila' }));
    expect(buscarMock).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('N.º de mochila (1 a 9999)')).toHaveValue('12');
  });

  it('si falló la red, el mismo QR se puede reintentar enseguida; si no existe, la cámara no lo repite', async () => {
    buscarMock
      .mockRejectedValueOnce({ message: 'Network Error' })
      .mockResolvedValueOnce({ data: mochila(54) })
      .mockRejectedValueOnce({ isAxiosError: true, response: { status: 404, data: { message: 'El QR ZZZZ9999 no es de ningún kit registrado' } } });
    abrir();
    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo buscar ese QR');
    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Escanear siguiente' }));
    expect(buscarMock).toHaveBeenCalledTimes(2);

    await userEvent.click(screen.getByRole('button', { name: 'leer otra mochila' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no es de ningún kit registrado');
    await userEvent.click(screen.getByRole('button', { name: 'leer otra mochila' }));
    expect(buscarMock).toHaveBeenCalledTimes(3);
  });

  it('el administrador sí puede pasarle a esta mochila el número de otra', async () => {
    buscarMock.mockResolvedValue({ data: mochila(null) });
    guardarMock
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: { status: 409, data: { codigo: 'MOCHILA_EN_OTRO_QR', message: 'La mochila N.º 23 ya está ligada al QR OTRO2345.' } },
      })
      .mockResolvedValueOnce({ data: { codigoUnico: 'P2ZCERV4', numeroMochila: 23, numeroAnterior: null, quitadoDe: 'OTRO2345' } });
    abrir(true);
    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    await userEvent.type(await screen.findByLabelText('N.º de mochila (1 a 9999)'), '23');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Sí, pasárselo a este kit' }));
    await waitFor(() => expect(guardarMock).toHaveBeenLastCalledWith('kit-1', { numero: 23, reemplazar: true }));
  });

  it('un QR que no existe muestra el mensaje de la API', async () => {
    buscarMock.mockRejectedValue({ response: { data: { message: 'El QR P2ZCERV4 no es de ningún kit registrado' } } });
    abrir();
    await userEvent.click(screen.getByRole('button', { name: 'leer QR' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('El QR P2ZCERV4 no es de ningún kit registrado');
  });
});
