import type { ResponsableInforme } from '@cne/shared-types';
import { api } from '../api';

/** Opciones comunes de los PDF: quién firma y si va la jornada (día de elecciones). */
export interface OpcionesInforme {
  responsableId: string;
  /** Incluye la prueba de conexión y las fotos de los reportes. */
  incluirJornada: boolean;
}

function params(o: OpcionesInforme, extra: Record<string, string> = {}): Record<string, string> {
  return { responsableId: o.responsableId, incluirJornada: String(o.incluirJornada), ...extra };
}

export const getResponsablesInforme = () =>
  api.get<ResponsableInforme[]>('/tracking/informes-operador/responsables');

export const descargarInformeOperador = (operadorId: string, o: OpcionesInforme) =>
  api.get<Blob>(`/tracking/informes-operador/${operadorId}/pdf`, { params: params(o), responseType: 'blob' });

/** Informes de varios operadores: los elegidos o, si no se eligen, los del cantón (o todos). */
export const descargarInformesOperador = (
  o: OpcionesInforme,
  filtro: { cantonId?: number | null; operadorIds?: string[] },
) => {
  const extra: Record<string, string> = {};
  if (filtro.cantonId) extra.cantonId = String(filtro.cantonId);
  if (filtro.operadorIds?.length) extra.operadorIds = filtro.operadorIds.join(',');
  return api.get<Blob>('/tracking/informes-operador/pdf', { params: params(o, extra), responseType: 'blob' });
};

export const descargarReporteGeneral = (o: OpcionesInforme, cantonId?: number | null) =>
  api.get<Blob>('/tracking/informes-operador/reporte-general', {
    params: params(o, cantonId ? { cantonId: String(cantonId) } : {}),
    responseType: 'blob',
  });
