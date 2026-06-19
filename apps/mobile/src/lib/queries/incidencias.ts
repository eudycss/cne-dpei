import type { CreateIncidenciaRequest, Incidencia, Paginated } from '@cne/shared-types';
import { api } from '../api';

export async function reportarIncidencia(body: CreateIncidenciaRequest): Promise<Incidencia> {
  const { data } = await api.post<Incidencia>('/incidencias', body);
  return data;
}

export async function misIncidencias(params?: { estado?: string }): Promise<Paginated<Incidencia>> {
  const { data } = await api.get<Paginated<Incidencia>>('/incidencias/mias', { params });
  return data;
}
