import type { ItemKitCatalog } from '@cne/shared-types';
import { api } from '../api';

export const getItemsKit = () => api.get<ItemKitCatalog[]>('/items-kit');
export const getItemsKitAdmin = () => api.get<ItemKitCatalog[]>('/items-kit/admin');
export const createItemKit = (body: { codigo: string; etiqueta: string }) =>
  api.post<ItemKitCatalog>('/items-kit', body);
export const updateItemKit = (id: string, body: { etiqueta?: string; activo?: boolean }) =>
  api.patch<ItemKitCatalog>(`/items-kit/${id}`, body);
export const deleteItemKit = (id: string) => api.delete(`/items-kit/${id}`);
