import type {
  LlegadaNoCdaResponse,
  MiAsignacionResponse,
  PruebaConexionRequest,
  PruebaConexionResponse,
  SalidaDpiRequest,
  SalidaDpiResponse,
} from '@cne/shared-types';
import { api } from '../api';
import { isTransientError, withOffline } from '../offline-queue';
import { actualizarCopia, guardarAsignacion, leerAsignacion } from '../cache-jornada';

export type AsignacionConOrigen = { data: MiAsignacionResponse; desdeCache: boolean };

/**
 * Descarga la asignación y guarda una copia en el celular. Sin señal (o con
 * el servidor caído) devuelve la última copia para que el operador pueda
 * seguir trabajando; `desdeCache` indica que puede estar desactualizada.
 * Si no hay copia, propaga el error original.
 */
export async function getMiAsignacionConOrigen(): Promise<AsignacionConOrigen> {
  try {
    const { data } = await api.get<MiAsignacionResponse>('/tracking/mi-asignacion');
    // Si falla guardar la copia, la descarga ya tuvo éxito igual.
    await guardarAsignacion(data).catch(() => {});
    return { data, desdeCache: false };
  } catch (e) {
    if (isTransientError(e)) {
      const copia = await leerAsignacion();
      if (copia) return { data: copia, desdeCache: true };
    }
    throw e;
  }
}

export async function getMiAsignacion(): Promise<MiAsignacionResponse> {
  return (await getMiAsignacionConOrigen()).data;
}

export async function postSalidaDpi(body: SalidaDpiRequest): Promise<SalidaDpiResponse | null> {
  const result = await withOffline('/tracking/salida-dpi', 'post', body, async () => {
    const { data } = await api.post<SalidaDpiResponse>('/tracking/salida-dpi', body);
    return data;
  });
  await actualizarCopia((a) => ({ ...a, yaRegistroSalida: true }));
  return result;
}

export async function postLlegadaNoCda(recintoId: string): Promise<LlegadaNoCdaResponse | null> {
  const result = await withOffline('/tracking/llegada-no-cda', 'post', { recintoId }, async () => {
    const { data } = await api.post<LlegadaNoCdaResponse>('/tracking/llegada-no-cda', { recintoId });
    return data;
  });
  const ahora = new Date().toISOString();
  await actualizarCopia((a) => ({
    ...a,
    noCdas: a.noCdas.map((nc) => (nc.id === recintoId ? { ...nc, llegadaRegistradaEn: nc.llegadaRegistradaEn ?? ahora } : nc)),
  }));
  return result;
}

export async function postPruebaConexion(body: PruebaConexionRequest): Promise<PruebaConexionResponse | null> {
  const result = await withOffline('/tracking/prueba-conexion', 'post', body, async () => {
    const { data } = await api.post<PruebaConexionResponse>('/tracking/prueba-conexion', body);
    return data;
  });
  await marcarPruebaConexionEnCopia();
  return result;
}

/** También lo usa registrarPruebaConexion cuando encola la prueba directamente. */
export function marcarPruebaConexionEnCopia(): Promise<void> {
  return actualizarCopia((a) => ({ ...a, yaRegistroPruebaConexion: true }));
}
