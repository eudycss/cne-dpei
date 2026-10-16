import type {
  LlegadaRecintoRequest,
  LlegadaRecintoResponse,
  MiAsignacionKit,
  RecepcionKitRequest,
  RecepcionKitResponse,
  ValidarKitResponse,
} from '@cne/shared-types';
import { api } from '../api';
import { enqueue, isTransientError, withOffline } from '../offline-queue';
import { actualizarCopia } from '../cache-jornada';
import { asegurarFotoMilitarSubida, contextoDeMarcador, esMarcadorFotoPendiente } from '../offline-foto-militar';

export async function validarKit(codigo: string): Promise<ValidarKitResponse> {
  const { data } = await api.post<ValidarKitResponse>('/tracking/validar-kit', { codigo });
  return data;
}

export class KitNoEnAsignacionError extends Error {
  constructor() {
    super('Sin señal no se puede consultar al servidor y este código no está en tu lista de kits. Verifica el código.');
    this.name = 'KitNoEnAsignacionError';
  }
}

/**
 * Valida el código con el servidor; sin señal, lo compara con los kits de la
 * asignación guardada en el celular. El servidor vuelve a comprobar que el kit
 * le pertenece al operador cuando la recepción se sincroniza.
 */
export async function validarKitConRespaldo(
  codigo: string,
  kitsAsignados: MiAsignacionKit[],
): Promise<{ kit: ValidarKitResponse; sinSenal: boolean }> {
  try {
    return { kit: await validarKit(codigo), sinSenal: false };
  } catch (e) {
    if (!isTransientError(e)) throw e;
    const buscado = codigo.trim().toUpperCase();
    const local = kitsAsignados.find((k) => k.codigoUnico.trim().toUpperCase() === buscado);
    if (!local) throw new KitNoEnAsignacionError();
    const { recibido, ...datos } = local;
    return { kit: { ...datos, yaRecibido: recibido }, sinSenal: true };
  }
}

export async function confirmarRecepcionKit(body: RecepcionKitRequest): Promise<RecepcionKitResponse | null> {
  let result: RecepcionKitResponse | null;
  if (esMarcadorFotoPendiente(body.fotoMilitarUrl)) {
    // La foto quedó en el celular: se intenta subirla ahora; si sigue sin
    // señal, la recepción se encola con el marcador y la cola sube la foto
    // primero al sincronizar.
    let fotoMilitarUrl: string | null = null;
    try {
      fotoMilitarUrl = await asegurarFotoMilitarSubida(contextoDeMarcador(body.fotoMilitarUrl));
    } catch (e) {
      if (!isTransientError(e)) throw e;
    }
    if (fotoMilitarUrl) {
      result = await enviarRecepcion({ ...body, fotoMilitarUrl });
    } else {
      await enqueue({ endpoint: '/tracking/recepcion-kit', method: 'post', payload: { ...body, desdeOffline: true } });
      result = null;
    }
  } else {
    result = await enviarRecepcion(body);
  }
  await actualizarCopia((a) => ({
    ...a,
    // El marcador de foto pendiente nunca se guarda en la copia: es solo un aviso para la cola.
    fotoMilitarUrl: a.fotoMilitarUrl ?? (esMarcadorFotoPendiente(body.fotoMilitarUrl) ? null : body.fotoMilitarUrl),
    kits: a.kits.map((k) => (k.id === body.kitId ? { ...k, recibido: true } : k)),
  }));
  return result;
}

function enviarRecepcion(body: RecepcionKitRequest): Promise<RecepcionKitResponse | null> {
  return withOffline('/tracking/recepcion-kit', 'post', body, async () => {
    const { data } = await api.post<RecepcionKitResponse>('/tracking/recepcion-kit', body);
    return data;
  });
}

export async function registrarLlegadaRecinto(body: LlegadaRecintoRequest): Promise<LlegadaRecintoResponse | null> {
  const result = await withOffline('/tracking/llegada-recinto', 'post', body, async () => {
    const { data } = await api.post<LlegadaRecintoResponse>('/tracking/llegada-recinto', body);
    return data;
  });
  await actualizarCopia((a) => ({ ...a, yaRegistroLlegada: true }));
  return result;
}
