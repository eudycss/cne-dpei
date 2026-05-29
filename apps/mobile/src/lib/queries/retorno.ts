import type {
  IngestaPosicionesRequest,
  IngestaPosicionesResponse,
  SalidaRecintoRequest,
  SalidaRecintoResponse,
} from '@cne/shared-types';
import { api } from '../api';

export async function postSalidaRecinto(
  body: SalidaRecintoRequest,
): Promise<SalidaRecintoResponse> {
  const { data } = await api.post<SalidaRecintoResponse>('/tracking/salida-recinto', body);
  return data;
}

export async function postPosiciones(
  body: IngestaPosicionesRequest,
): Promise<IngestaPosicionesResponse> {
  const { data } = await api.post<IngestaPosicionesResponse>('/tracking/posiciones', body);
  return data;
}
