import type {
  AsignarKitRequest,
  BulkUploadResult,
  CargaMochilasResult,
  CreateKitRequest,
  EditKitRequest,
  Kit,
  NumeroMochilaRequest,
  NumeroMochilaResponse,
  Paginated,
} from '@cne/shared-types';
import { api } from '../api';

export const getKits = (params: URLSearchParams) => api.get<Paginated<Kit>>(`/kits?${params}`);
export const getRecintosOcupados = (eventoId: string) =>
  api.get<string[]>(`/kits/recintos-ocupados?eventoId=${eventoId}`);
export const createKit = (body: CreateKitRequest) => api.post<Kit>('/kits', body);
export const editKit = (id: string, body: EditKitRequest) => api.patch<Kit>(`/kits/${id}`, body);
export const asignarKit = (id: string, body: AsignarKitRequest) =>
  api.patch<Kit>(`/kits/${id}/asignar`, body);
export const desasignarKit = (id: string, body?: { justificacion?: string }) =>
  api.patch<Kit>(`/kits/${id}/desasignar`, body ?? {});
export const regenerarCodigoKit = (id: string, justificacion?: string) =>
  api.post<Kit>(`/kits/${id}/codigo-nuevo`, justificacion ? { justificacion } : {});
export const bulkUploadKits = (eventoId: string, file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return api.post<BulkUploadResult>(`/kits/bulk?eventoId=${eventoId}`, fd);
};
export const downloadKitsTemplate = () => api.get('/kits/template.xlsx', { responseType: 'blob' });
export const downloadKitsPdfQr = (kitIds: string[]) =>
  api.post('/kits/pdf-qr', { kitIds }, { responseType: 'blob' });

// ─── N.º de mochila ──────────────────────────────────────────────────────────
export const guardarNumeroMochila = (kitId: string, body: NumeroMochilaRequest) =>
  api.put<NumeroMochilaResponse>(`/kits/${kitId}/mochila`, body);
/** Sin `aplicar` solo devuelve la vista previa (no guarda nada). */
export const cargarMochilas = (eventoId: string, file: File, aplicar: boolean) => {
  const fd = new FormData();
  fd.append('file', file);
  return api.post<CargaMochilasResult>(
    `/kits/mochilas/carga?eventoId=${encodeURIComponent(eventoId)}&aplicar=${aplicar}`,
    fd,
  );
};
export const downloadMochilasPlantilla = () => api.get<Blob>('/kits/mochilas/plantilla.xlsx', { responseType: 'blob' });
export const downloadMochilasReporte = (eventoId: string) =>
  api.get<Blob>(`/kits/mochilas/reporte.xlsx?eventoId=${encodeURIComponent(eventoId)}`, { responseType: 'blob' });
