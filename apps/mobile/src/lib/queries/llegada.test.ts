import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MiAsignacionKit } from '@cne/shared-types';
import { api } from '../api';
import { asegurarFotoMilitarSubida } from '../offline-foto-militar';
import { contarPendientes, flushQueue } from '../offline-queue';
import { actualizarCopia } from '../cache-jornada';
import { confirmarRecepcionKit, KitNoEnAsignacionError, validarKitConRespaldo } from './llegada';

jest.mock('../api', () => ({ api: { post: jest.fn() } }));

jest.mock('../cache-jornada', () => ({ actualizarCopia: jest.fn() }));

jest.mock('../offline-foto-militar', () => {
  const PREFIJO = 'pendiente:foto-militar:';
  return {
    asegurarFotoMilitarSubida: jest.fn(),
    esMarcadorFotoPendiente: (v: unknown) => typeof v === 'string' && v.startsWith(PREFIJO),
    contextoDeMarcador: (m: string) => m.slice(PREFIJO.length),
    resolverFotoMilitarEnPayload: jest.fn(async (p: object) => p),
  };
});

const networkError = { isAxiosError: true, response: undefined };
const notFoundError = { isAxiosError: true, response: { status: 404, data: { message: 'Kit no encontrado' } } };

const kits: MiAsignacionKit[] = [
  { id: 'k1', codigoUnico: 'ABC123', nombre: 'Kit 1', contenidos: null, items: ['Papeletas'], recibido: false },
  { id: 'k2', codigoUnico: 'XYZ789', nombre: 'Kit 2', contenidos: null, items: [], recibido: true },
];

const bodyBase = { kitId: 'k1', militarId: null, latitud: 0.3, longitud: -78.1 };

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('validarKitConRespaldo', () => {
  it('con señal usa la respuesta del servidor', async () => {
    const kitServidor = { id: 'k1', codigoUnico: 'ABC123', nombre: 'Kit 1', contenidos: null, items: [], yaRecibido: false };
    (api.post as jest.Mock).mockResolvedValue({ data: kitServidor });

    await expect(validarKitConRespaldo('ABC123', kits)).resolves.toEqual({ kit: kitServidor, sinSenal: false });
  });

  it('sin señal valida contra los kits guardados, sin distinguir mayúsculas ni espacios', async () => {
    (api.post as jest.Mock).mockRejectedValue(networkError);

    await expect(validarKitConRespaldo('  abc123 ', kits)).resolves.toEqual({
      kit: { id: 'k1', codigoUnico: 'ABC123', nombre: 'Kit 1', contenidos: null, items: ['Papeletas'], yaRecibido: false },
      sinSenal: true,
    });
  });

  it('sin señal marca como ya recibido un kit confirmado antes', async () => {
    (api.post as jest.Mock).mockRejectedValue(networkError);

    const { kit } = await validarKitConRespaldo('XYZ789', kits);
    expect(kit.yaRecibido).toBe(true);
  });

  it('sin señal rechaza un código que no está en la asignación', async () => {
    (api.post as jest.Mock).mockRejectedValue(networkError);

    await expect(validarKitConRespaldo('OTRO', kits)).rejects.toBeInstanceOf(KitNoEnAsignacionError);
  });

  it('con señal propaga el rechazo del servidor (no usa la lista local)', async () => {
    (api.post as jest.Mock).mockRejectedValue(notFoundError);

    await expect(validarKitConRespaldo('ABC123', kits)).rejects.toBe(notFoundError);
  });
});

describe('confirmarRecepcionKit', () => {
  it('con la URL real de la foto la envía directo', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { id: 'r1', kitId: 'k1', confirmadoEn: 'x' } });

    await confirmarRecepcionKit({ ...bodyBase, fotoMilitarUrl: 'militares/abc.bin' });

    expect(api.post).toHaveBeenCalledWith('/tracking/recepcion-kit', { ...bodyBase, fotoMilitarUrl: 'militares/abc.bin' });
    expect(asegurarFotoMilitarSubida).not.toHaveBeenCalled();
  });

  it('con foto pendiente y señal, sube la foto y envía la recepción con la URL real', async () => {
    (asegurarFotoMilitarSubida as jest.Mock).mockResolvedValue('militares/nueva.bin');
    (api.post as jest.Mock).mockResolvedValue({ data: { id: 'r1', kitId: 'k1', confirmadoEn: 'x' } });

    const r = await confirmarRecepcionKit({ ...bodyBase, fotoMilitarUrl: 'pendiente:foto-militar:ev1_r1' });

    expect(asegurarFotoMilitarSubida).toHaveBeenCalledWith('ev1_r1');
    expect(api.post).toHaveBeenCalledWith('/tracking/recepcion-kit', { ...bodyBase, fotoMilitarUrl: 'militares/nueva.bin' });
    expect(r).not.toBeNull();
  });

  it('con foto pendiente y sin señal, encola la recepción con el marcador', async () => {
    (asegurarFotoMilitarSubida as jest.Mock).mockRejectedValue(networkError);

    const r = await confirmarRecepcionKit({ ...bodyBase, fotoMilitarUrl: 'pendiente:foto-militar:ev1_r1' });

    expect(r).toBeNull();
    expect(api.post).not.toHaveBeenCalled();
    await expect(contarPendientes()).resolves.toBe(1);
    // La copia local marca el kit recibido pero nunca guarda el marcador como foto.
    const cambio = (actualizarCopia as jest.Mock).mock.calls[0][0];
    const copia = cambio({ fotoMilitarUrl: null, kits: [{ id: 'k1', recibido: false }] });
    expect(copia).toMatchObject({ fotoMilitarUrl: null, kits: [{ id: 'k1', recibido: true }] });

    (api.post as jest.Mock).mockResolvedValue({ data: {} });
    await flushQueue();
    expect(api.post).toHaveBeenCalledWith('/tracking/recepcion-kit', {
      ...bodyBase,
      fotoMilitarUrl: 'pendiente:foto-militar:ev1_r1',
      desdeOffline: true,
    });
  });

  it('propaga un error que no es de red al subir la foto pendiente', async () => {
    const perdida = new Error('perdida');
    (asegurarFotoMilitarSubida as jest.Mock).mockRejectedValue(perdida);

    await expect(
      confirmarRecepcionKit({ ...bodyBase, fotoMilitarUrl: 'pendiente:foto-militar:ev1_r1' }),
    ).rejects.toBe(perdida);
    await expect(contarPendientes()).resolves.toBe(0);
  });
});
