import type { SyncRecintosPreview, SyncRecintosResultado } from '@cne/shared-types';
import { api } from '../api';

export async function getPreviewSyncRecintos(): Promise<SyncRecintosPreview> {
  const { data } = await api.get<SyncRecintosPreview>('/recintos/sync/preview');
  return data;
}

export async function aplicarSyncRecintos(): Promise<SyncRecintosResultado> {
  const { data } = await api.post<SyncRecintosResultado>('/recintos/sync');
  return data;
}
