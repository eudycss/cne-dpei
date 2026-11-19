import type {
  CandidatoDistribucion,
  DistribucionDiasDetalle,
  DistribucionDiasResumen,
  FormatoReporteCda,
  PersonaDistribucionDias,
} from '@cne/shared-types';
import type {
  AgregarPersonaDistribucionInput,
  CrearDistribucionDiasInput,
  EditarPersonaDistribucionInput,
  ReporteDistribucionInput,
} from '@cne/shared-validation';
import { api } from '../api';

// Distribución del personal por días (pestaña de Operadores CDA).

const BASE = '/distribuciones-dias';

export async function getDistribuciones(): Promise<DistribucionDiasResumen[]> {
  const { data } = await api.get<DistribucionDiasResumen[]>(BASE);
  return data;
}

export async function getDistribucion(id: string): Promise<DistribucionDiasDetalle> {
  const { data } = await api.get<DistribucionDiasDetalle>(`${BASE}/${id}`);
  return data;
}

export async function crearDistribucion(body: CrearDistribucionDiasInput): Promise<DistribucionDiasDetalle> {
  const { data } = await api.post<DistribucionDiasDetalle>(BASE, body);
  return data;
}

export async function regenerarDistribucion(id: string): Promise<DistribucionDiasDetalle> {
  const { data } = await api.post<DistribucionDiasDetalle>(`${BASE}/${id}/regenerar`);
  return data;
}

export async function eliminarDistribucion(id: string): Promise<void> {
  await api.delete(`${BASE}/${id}`);
}

export async function getCandidatosDistribucion(id: string, buscar: string): Promise<CandidatoDistribucion[]> {
  const { data } = await api.get<CandidatoDistribucion[]>(`${BASE}/${id}/candidatos`, { params: { buscar } });
  return data;
}

export async function agregarPersonaDistribucion(id: string, body: AgregarPersonaDistribucionInput): Promise<PersonaDistribucionDias> {
  const { data } = await api.post<PersonaDistribucionDias>(`${BASE}/${id}/personas`, body);
  return data;
}

export async function editarPersonaDistribucion(id: string, personaId: string, body: EditarPersonaDistribucionInput): Promise<PersonaDistribucionDias> {
  const { data } = await api.patch<PersonaDistribucionDias>(`${BASE}/${id}/personas/${personaId}`, body);
  return data;
}

export async function quitarPersonaDistribucion(id: string, personaId: string): Promise<void> {
  await api.delete(`${BASE}/${id}/personas/${personaId}`);
}

/** Excel o PDF; sin filtros, todos los días y todos los encargados. */
export function pedirReporteDistribucion(id: string, formato: FormatoReporteCda, filtro: ReporteDistribucionInput) {
  const params: Record<string, string> = {};
  if (filtro.fecha) params.fecha = filtro.fecha;
  if (filtro.encargado) params.encargado = filtro.encargado;
  return api.get<Blob>(`${BASE}/${id}/reporte.${formato}`, { params, responseType: 'blob' });
}
