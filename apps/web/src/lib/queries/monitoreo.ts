import type { CdaEstadoDto, OperadorEnRetorno } from '@cne/shared-types';
import { api } from '../api';

/**
 * HU6: operadores de CDA actualmente en su tramo de retorno al DPI, con su
 * última posición GPS y kits asignados. El backend filtra por supervisor
 * asignado (los administradores ven a todos).
 */
export async function getOperadoresEnRetorno(): Promise<OperadorEnRetorno[]> {
  const { data } = await api.get<OperadorEnRetorno[]>('/tracking/operadores-en-retorno');
  return data;
}

/**
 * Estado en vivo de cada CDA del evento activo (operador, estado del flujo
 * y última ubicación conocida). El backend filtra por supervisor asignado
 * (los administradores ven todos los CDAs).
 */
export async function getEstadoCdas(): Promise<CdaEstadoDto[]> {
  const { data } = await api.get<CdaEstadoDto[]>('/tracking/estado-cdas');
  return data;
}

/**
 * HU3-CA2: foto del militar (descifrada) recibida al entregar el kit del CDA
 * de ese recinto. Devuelve el blob de la imagen para mostrarla con un Object URL.
 */
export async function getFotoMilitar(recintoId: string): Promise<Blob> {
  const { data } = await api.get<Blob>(`/tracking/estado-cdas/${recintoId}/foto-militar`, {
    responseType: 'blob',
  });
  return data;
}
