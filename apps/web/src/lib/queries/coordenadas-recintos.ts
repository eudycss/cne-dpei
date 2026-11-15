import type { CoordenadasRecintos } from '@cne/shared-types';
import { api } from '../api';

export async function getCoordenadasRecintos(umbral: number): Promise<CoordenadasRecintos> {
  const { data } = await api.get<CoordenadasRecintos>('/recintos/coordenadas', { params: { umbral } });
  return data;
}
