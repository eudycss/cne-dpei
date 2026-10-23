import type { ImportOperadoresCdaResult, OperadorCda } from '@cne/shared-types';
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
