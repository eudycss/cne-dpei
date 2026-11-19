import type { CandidatoPerimetro, CargoPerimetro, PlanPerimetroDetalle, PlanPerimetroResumen, PropuestaPersonalPerimetro } from '@cne/shared-types';
import type { CandidatosPerimetroInput, CrearPlanPerimetroInput, GuardarPlanPerimetroInput, PropuestaPersonalPerimetroInput } from '@cne/shared-validation';
import { api } from '../api';

const BASE = '/perimetro/planes';

export const clavePlanes = (eventoId: string) => ['perimetro', 'planes', eventoId] as const;
export const clavePlan = (id: string) => ['perimetro', 'plan', id] as const;
export const claveFotoPersona = (planId: string, operadorId: string) => ['perimetro', 'foto', planId, operadorId] as const;

export async function getPlanesPerimetro(eventoId: string): Promise<PlanPerimetroResumen[]> {
  const { data } = await api.get<PlanPerimetroResumen[]>(BASE, { params: { eventoId } });
  return data;
}

export async function getPlanPerimetro(id: string): Promise<PlanPerimetroDetalle> {
  const { data } = await api.get<PlanPerimetroDetalle>(`${BASE}/${id}`);
  return data;
}

/** El body pasa por el schema Zod en el API; aquí basta con el tipo de entrada (los defaults los pone el API). */
export async function crearPlanPerimetro(body: Pick<CrearPlanPerimetroInput, 'eventoId' | 'nombre'> & Partial<CrearPlanPerimetroInput>): Promise<PlanPerimetroDetalle> {
  const { data } = await api.post<PlanPerimetroDetalle>(BASE, body);
  return data;
}

/** Foto descifrada de una persona del plan (solo si está en un puesto de ese plan). */
export async function getFotoPersonaPlan(planId: string, operadorId: string): Promise<Blob> {
  const { data } = await api.get<Blob>(`${BASE}/${planId}/personas/${operadorId}/foto`, { responseType: 'blob' });
  return data;
}

/** Guarda el plan completo; si otra persona guardó antes, el API responde 409. */
export async function guardarPlanPerimetro(id: string, body: GuardarPlanPerimetroInput): Promise<PlanPerimetroDetalle> {
  const { data } = await api.put<PlanPerimetroDetalle>(`${BASE}/${id}`, body);
  return data;
}

export async function eliminarPlanPerimetro(id: string): Promise<{ id: string }> {
  const { data } = await api.delete<{ id: string }>(`${BASE}/${id}`);
  return data;
}

export const CLAVE_CARGOS_PERIMETRO = ['perimetro', 'cargos'] as const;
export const claveCandidatos = (planId: string, f: CandidatosPerimetroInput) => ['perimetro', 'candidatos', planId, f] as const;

export async function getCargosPerimetro(): Promise<CargoPerimetro[]> {
  const { data } = await api.get<CargoPerimetro[]>('/perimetro/cargos');
  return data;
}

/** Personal activo para asignar a mano: solo id y nombre (máx. 100). */
export async function getCandidatosPerimetro(planId: string, filtros: CandidatosPerimetroInput): Promise<CandidatoPerimetro[]> {
  const params = Object.fromEntries(Object.entries(filtros).filter(([, v]) => v !== undefined && v !== ''));
  const { data } = await api.get<CandidatoPerimetro[]>(`${BASE}/${planId}/candidatos`, { params });
  return data;
}

/** Personas para los puestos vacíos según el % de mujeres (el servidor no guarda nada). */
export async function pedirPropuestaPersonal(planId: string, body: PropuestaPersonalPerimetroInput): Promise<PropuestaPersonalPerimetro> {
  const { data } = await api.post<PropuestaPersonalPerimetro>(`${BASE}/${planId}/propuesta`, body);
  return data;
}
