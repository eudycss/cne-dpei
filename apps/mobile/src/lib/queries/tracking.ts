import type {
  LlegadaNoCdaResponse,
  MiAsignacionResponse,
  SalidaDpiRequest,
  SalidaDpiResponse,
} from '@cne/shared-types';
import { api } from '../api';

export async function getMiAsignacion(): Promise<MiAsignacionResponse> {
  const { data } = await api.get<MiAsignacionResponse>('/tracking/mi-asignacion');
  return data;
}

export async function postSalidaDpi(body: SalidaDpiRequest): Promise<SalidaDpiResponse> {
  const { data } = await api.post<SalidaDpiResponse>('/tracking/salida-dpi', body);
  return data;
}

export async function postLlegadaNoCda(recintoId: string): Promise<LlegadaNoCdaResponse> {
  const { data } = await api.post<LlegadaNoCdaResponse>('/tracking/llegada-no-cda', { recintoId });
  return data;
}
