import type { AvanceInformeCda, EstadoFotoInformeCda, VisitaInformeCdaPublica } from '@cne/shared-types';
import { VERSION_AVISO_INFORME_CDA } from '@cne/shared-validation';
import { api } from '../api';

// Página pública /informe-cda: la cédula y el token de la visita van en el
// cuerpo (nunca en la URL, para que no queden en logs ni en el historial).

export async function consultarInformeCda(cedula: string): Promise<VisitaInformeCdaPublica> {
  const { data } = await api.post<VisitaInformeCdaPublica>('/publico/informe-cda/consultar', { cedula });
  return data;
}

export async function subirFotoInformeCda(token: string, posicion: number, foto: Blob): Promise<EstadoFotoInformeCda[]> {
  const fd = new FormData();
  fd.append('token', token);
  fd.append('posicion', String(posicion));
  fd.append('consentimiento', 'true');
  fd.append('version', VERSION_AVISO_INFORME_CDA);
  fd.append('foto', foto, `foto${posicion}.jpg`);
  const { data } = await api.post<{ fotos: EstadoFotoInformeCda[] }>('/publico/informe-cda/foto', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data.fotos;
}

export async function generarInformeCda(token: string): Promise<Blob> {
  const { data } = await api.post<Blob>('/publico/informe-cda/generar', { token }, { responseType: 'blob' });
  return data;
}

/** Enlace que se comparte con todo el personal CDA/CPE. */
export function urlInformeCda(origen = window.location.origin): string {
  return `${origen}/informe-cda`;
}

// Delegación (con sesión).

export async function getAvanceInformesCda(): Promise<AvanceInformeCda[]> {
  const { data } = await api.get<AvanceInformeCda[]>('/operadores-cda/informes-productos/avance');
  return data;
}

export const descargarInformeCda = (operadorId: string) =>
  api.get<Blob>(`/operadores-cda/${operadorId}/informe-productos`, { responseType: 'blob' });
