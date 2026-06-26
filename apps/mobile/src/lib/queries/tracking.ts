import type {
  LlegadaNoCdaResponse,
  MiAsignacionResponse,
  SalidaDpiRequest,
  SalidaDpiResponse,
} from '@cne/shared-types';
import { api } from '../api';
import { withOffline } from '../offline-queue';

export async function getMiAsignacion(): Promise<MiAsignacionResponse> {
  const { data } = await api.get<MiAsignacionResponse>('/tracking/mi-asignacion');
  return data;
}

export async function postSalidaDpi(body: SalidaDpiRequest): Promise<SalidaDpiResponse | null> {
  return withOffline('/tracking/salida-dpi', 'post', body, async () => {
    const { data } = await api.post<SalidaDpiResponse>('/tracking/salida-dpi', body);
    return data;
  });
}

export async function postLlegadaNoCda(recintoId: string): Promise<LlegadaNoCdaResponse | null> {
  return withOffline('/tracking/llegada-no-cda', 'post', { recintoId }, async () => {
    const { data } = await api.post<LlegadaNoCdaResponse>('/tracking/llegada-no-cda', { recintoId });
    return data;
  });
}
