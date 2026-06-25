import type { Alerta, UpdateEstadoAlertaRequest } from '@cne/shared-types';
import { api } from '../api';

export async function getAlertas(params: {
  eventoId: string;
  tipo?: string;
  estado?: string;
}): Promise<Alerta[]> {
  const { data } = await api.get<Alerta[]>('/alertas', { params });
  return data;
}

export async function updateEstadoAlerta(
  id: string,
  body: UpdateEstadoAlertaRequest,
): Promise<Alerta> {
  const { data } = await api.patch<Alerta>(`/alertas/${id}`, body);
  return data;
}
