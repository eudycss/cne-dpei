import type {
  ConfigEvatics,
  ConsultaEvaticsPublica,
  DecisionEvatics,
  ListadoEvatics,
  RevisarEvaticsRequest,
  SubidaEvaticsResult,
} from '@cne/shared-types';
import { VERSION_AVISO_EVATICS, type FiltrosEvaticsInput } from '@cne/shared-validation';
import { api } from '../api';

// Página pública: la cédula va en el cuerpo, nunca en la URL (no queda en logs ni en el historial).

export async function consultarEvatics(cedula: string): Promise<ConsultaEvaticsPublica> {
  const { data } = await api.post<ConsultaEvaticsPublica>('/publico/evatics/consultar', { cedula });
  return data;
}

export async function subirEvatics(cedula: string, foto: Blob): Promise<SubidaEvaticsResult> {
  const fd = new FormData();
  fd.append('cedula', cedula);
  fd.append('consentimiento', 'true');
  fd.append('version', VERSION_AVISO_EVATICS);
  fd.append('foto', foto, 'certificado.jpg');
  const { data } = await api.post<SubidaEvaticsResult>('/publico/evatics/subir', fd, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data;
}

// Pestaña de CDAs: listado, foto, revisión y fecha límite.

/** Solo los filtros con valor: la API toma vacío como "sin filtro". */
export async function getEvatics(filtros: FiltrosEvaticsInput = {}): Promise<ListadoEvatics> {
  const params = Object.fromEntries(Object.entries(filtros).filter(([, v]) => v !== undefined && v !== ''));
  const { data } = await api.get<ListadoEvatics>('/operadores-cda/evatics', { params });
  return data;
}

/** `subidoEn` es la versión de la foto que muestra la web: 409 si la persona subió otra. */
export async function getFotoEvatics(certificadoId: string, subidoEn: string, anterior = false): Promise<Blob> {
  const { data } = await api.get<Blob>(`/operadores-cda/evatics/${certificadoId}/foto`, {
    params: anterior ? { v: subidoEn, anterior: 'true' } : { v: subidoEn },
    responseType: 'blob',
  });
  return data;
}

export async function revisarEvatics(
  certificadoId: string,
  body: RevisarEvaticsRequest,
): Promise<{ id: string; estado: DecisionEvatics; revisadoEn: string }> {
  const { data } = await api.post<{ id: string; estado: DecisionEvatics; revisadoEn: string }>(
    `/operadores-cda/evatics/${certificadoId}/revision`,
    body,
  );
  return data;
}

export async function getConfigEvatics(): Promise<ConfigEvatics> {
  const { data } = await api.get<ConfigEvatics>('/operadores-cda/evatics/config');
  return data;
}

export async function guardarConfigEvatics(fechaLimite: string | null): Promise<ConfigEvatics> {
  const { data } = await api.put<ConfigEvatics>('/operadores-cda/evatics/config', { fechaLimite });
  return data;
}
