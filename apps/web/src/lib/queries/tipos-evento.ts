import type { TipoEventoCatalog } from '@cne/shared-types';
import { api } from '../api';

export const getTiposEvento = () => api.get<TipoEventoCatalog[]>('/tipos-evento');
export const getTiposEventoAdmin = () => api.get<TipoEventoCatalog[]>('/tipos-evento/admin');
export const createTipoEvento = (body: { codigo: string; etiqueta: string }) =>
  api.post<TipoEventoCatalog>('/tipos-evento', body);
export const updateTipoEvento = (id: string, body: { etiqueta?: string; activo?: boolean }) =>
  api.patch<TipoEventoCatalog>(`/tipos-evento/${id}`, body);
export const deleteTipoEvento = (id: string) => api.delete(`/tipos-evento/${id}`);
