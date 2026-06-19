import type {
  Incidencia,
  IncidenciaComentario,
  IncidenciaDetalle,
  Paginated,
  UpdateEstadoIncidenciaRequest,
} from '@cne/shared-types';
import { api } from '../api';

export async function getIncidencias(params: {
  estado?: string;
  eventoId?: string;
  page?: number;
  pageSize?: number;
}): Promise<Paginated<Incidencia>> {
  const { data } = await api.get<Paginated<Incidencia>>('/incidencias', { params });
  return data;
}

export async function getIncidencia(id: string): Promise<IncidenciaDetalle> {
  const { data } = await api.get<IncidenciaDetalle>(`/incidencias/${id}`);
  return data;
}

export async function updateEstadoIncidencia(
  id: string,
  body: UpdateEstadoIncidenciaRequest,
): Promise<Incidencia> {
  const { data } = await api.patch<Incidencia>(`/incidencias/${id}/estado`, body);
  return data;
}

export async function getComentarios(id: string): Promise<IncidenciaComentario[]> {
  const { data } = await api.get<IncidenciaComentario[]>(`/incidencias/${id}/comentarios`);
  return data;
}

export async function getFotoIncidencia(id: string): Promise<Blob> {
  const { data } = await api.get<Blob>(`/incidencias/${id}/foto`, { responseType: 'blob' });
  return data;
}
