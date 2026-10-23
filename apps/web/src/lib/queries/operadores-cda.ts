import type {
  AsistenciaCdaDia,
  AsistenciaCdaFila,
  ImportOperadoresCdaResult,
  MarcarAsistenciaCdaMasivaResult,
  OperadorCda,
  TipoMarcaAsistenciaCda,
} from '@cne/shared-types';
import { api } from '../api';

export async function getOperadoresCda(): Promise<OperadorCda[]> {
  const { data } = await api.get<OperadorCda[]>('/operadores-cda');
  return data;
}

/** Sin `aplicar` solo devuelve la vista previa; con `aplicar` guarda. */
export async function importarOperadoresCda(file: File, aplicar: boolean): Promise<ImportOperadoresCdaResult> {
  const fd = new FormData();
  fd.append('file', file);
  const { data } = await api.post<ImportOperadoresCdaResult>(
    `/operadores-cda/importar${aplicar ? '?aplicar=true' : ''}`,
    fd,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return data;
}

export async function getAsistenciaCda(fecha: string): Promise<AsistenciaCdaDia> {
  const { data } = await api.get<AsistenciaCdaDia>(`/operadores-cda/asistencia?fecha=${encodeURIComponent(fecha)}`);
  return data;
}

export async function marcarAsistenciaCda(operadorId: string, tipo: TipoMarcaAsistenciaCda): Promise<AsistenciaCdaFila> {
  const { data } = await api.post<AsistenciaCdaFila>(`/operadores-cda/${operadorId}/asistencia`, { tipo });
  return data;
}

/** `marcaEn`: la marca que se vio; si otro técnico la cambió, la API no la quita (409). */
export async function quitarAsistenciaCda(
  operadorId: string,
  tipo: TipoMarcaAsistenciaCda,
  marcaEn: string,
): Promise<void> {
  await api.delete(`/operadores-cda/${operadorId}/asistencia/${tipo}?marcaEn=${encodeURIComponent(marcaEn)}`);
}

export async function marcarAsistenciaCdaMasiva(
  tipo: TipoMarcaAsistenciaCda,
  operadorIds: string[],
): Promise<MarcarAsistenciaCdaMasivaResult> {
  const { data } = await api.post<MarcarAsistenciaCdaMasivaResult>('/operadores-cda/asistencia/masiva', {
    tipo,
    operadorIds,
  });
  return data;
}

/** Descarga el Excel de asistencia desde el primer día hasta `hasta`. */
export async function descargarAsistenciaCda(hasta: string): Promise<void> {
  const res = await api.get(`/operadores-cda/asistencia/exportar.xlsx?hasta=${encodeURIComponent(hasta)}`, {
    responseType: 'blob',
  });
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `asistencia_operadores_cda_${hasta}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
