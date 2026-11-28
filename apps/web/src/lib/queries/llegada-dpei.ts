import type { ReporteLlegadaDpei } from '@cne/shared-types';
import { api } from '../api';

export { duracionTexto, horaConDia } from '@cne/shared-validation';

/** Llegada de los CDA a la DPEI en un día de jornada (sin fecha: el actual); null si no hay evento activo. */
export async function getReporteLlegadaDpei(fecha?: string): Promise<ReporteLlegadaDpei | null> {
  const { data } = await api.get<ReporteLlegadaDpei | null>('/tracking/reporte-llegada-dpei', {
    params: fecha ? { fecha } : undefined,
  });
  return data || null;
}

export function pedirReporteLlegadaDpei(formato: 'xlsx' | 'pdf', fecha?: string) {
  return api.get<Blob>(`/tracking/reporte-llegada-dpei.${formato}`, {
    params: fecha ? { fecha } : undefined,
    responseType: 'blob',
  });
}

/** "llegada_dpei_cdas_2026-11-29.pdf" (el mismo nombre que pone la API). */
export function nombreReporteLlegadaDpei(formato: 'xlsx' | 'pdf', fecha: string): string {
  return `llegada_dpei_cdas_${fecha}.${formato}`;
}

/** "2026-11-29" → "29/11/2026". */
export function fechaCorta(dia: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : dia;
}

