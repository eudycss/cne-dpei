import { api } from '../api';
import { guardar, nombreDeDescarga } from './operadores-cda';

export type FormatoReporteRecintos = 'xlsx' | 'pdf';

/** Descarga cada CDA con sus recintos NO CDA (todo el catálogo o solo un cantón). */
export async function descargarReporteRecintosCda(formato: FormatoReporteRecintos, cantonId?: string): Promise<void> {
  const res = await api.get<Blob>(`/recintos/reporte-cda.${formato}`, {
    params: cantonId ? { cantonId } : undefined,
    responseType: 'blob',
  });
  guardar(res.data, nombreDeDescarga(res.headers['content-disposition'], `recintos_cda_no_cda.${formato}`));
}
