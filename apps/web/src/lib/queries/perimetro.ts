import type { PlanPerimetroDetalle, PlanPerimetroResumen } from '@cne/shared-types';
import type { CrearPlanPerimetroInput, GuardarPlanPerimetroInput } from '@cne/shared-validation';
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
