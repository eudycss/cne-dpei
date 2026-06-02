import type { OperadorEnRetorno } from '@cne/shared-types';
import { api } from '../api';

/**
 * HU6: operadores de CDA en su tramo de retorno al DPI, con su última posición
 * GPS y kits asignados. El backend filtra por el supervisor autenticado.
 */
export async function getOperadoresEnRetorno(): Promise<OperadorEnRetorno[]> {
  const { data } = await api.get<OperadorEnRetorno[]>('/tracking/operadores-en-retorno');
  return data;
}
