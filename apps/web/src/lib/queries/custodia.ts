import type { FilaInformeCustodia } from '@cne/shared-types';
import { api } from '../api';

export interface FiltrosCustodia {
  cantonId?: number;
  recintoId?: string;
}

function params(f: FiltrosCustodia): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.cantonId) p.cantonId = String(f.cantonId);
  if (f.recintoId) p.recintoId = f.recintoId;
  return p;
}

export const getInformeCustodia = () => api.get<FilaInformeCustodia[]>('/custodia/informe');

export const descargarActaKit = (kitId: string) =>
  api.get<Blob>(`/custodia/kits/${kitId}/acta`, { responseType: 'blob' });

export const descargarActas = (filtros: FiltrosCustodia) =>
  api.get<Blob>('/custodia/actas', { params: params(filtros), responseType: 'blob' });

/** Guarda un blob como archivo (mismo patrón que la descarga de QR de kits). */
export function guardarArchivo(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
