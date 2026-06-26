import type { Alerta, EventoElectoral, UpdateEstadoAlertaRequest } from '@cne/shared-types';
import { api } from '../api';

export async function getEventoActivo(): Promise<EventoElectoral | null> {
  const { data } = await api.get<EventoElectoral | null>('/eventos/active');
  return data;
}

export async function getAlertas(params: {
  eventoId: string;
  estado?: string;
}): Promise<Alerta[]> {
  const { data } = await api.get<Alerta[]>('/alertas', { params });
  return data;
}

export async function actualizarEstadoAlerta(
  id: string,
  body: UpdateEstadoAlertaRequest,
): Promise<Alerta> {
  const { data } = await api.patch<Alerta>(`/alertas/${id}`, body);
  return data;
}
