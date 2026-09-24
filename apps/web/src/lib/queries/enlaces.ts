import type { ConfigEnlacesResponse, EnlaceRecinto } from '@cne/shared-types';
import { api } from '../api';

export async function getEnlaces(): Promise<EnlaceRecinto[]> {
  const { data } = await api.get<EnlaceRecinto[]>('/enlaces');
  return data;
}

export async function getConfigEnlaces(): Promise<ConfigEnlacesResponse> {
  const { data } = await api.get<ConfigEnlacesResponse>('/enlaces/config');
  return data;
}

export async function addCorreoEnlace(correo: string): Promise<ConfigEnlacesResponse> {
  const { data } = await api.post<ConfigEnlacesResponse>('/enlaces/config/correos', { correo });
  return data;
}

export async function removeCorreoEnlace(correo: string): Promise<ConfigEnlacesResponse> {
  const { data } = await api.delete<ConfigEnlacesResponse>('/enlaces/config/correos', { data: { correo } });
  return data;
}

export async function reenviarListaTelegram(): Promise<{ enviados: number }> {
  const { data } = await api.post<{ enviados: number }>('/enlaces/telegram/reenviar');
  return data;
}
