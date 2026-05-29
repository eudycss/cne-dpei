import type { OperadorEnRetorno } from '@cne/shared-types';
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
