import type {
  LlegadaRecintoManualResponse,
  OperadorEnRetorno,
  RecintoDificilAccesoDto,
} from '@cne/shared-types';
import { api } from '../api';

/**
 * HU6: operadores de CDA en su tramo de retorno al DPI, con su última posición
 * GPS y kits asignados. El backend filtra por el supervisor autenticado.
 */
export async function getOperadoresEnRetorno(): Promise<OperadorEnRetorno[]> {
  const { data } = await api.get<OperadorEnRetorno[]>('/tracking/operadores-en-retorno');
  return data;
}

/**
 * HU13 Parte B: CDAs esDificilAcceso del evento activo con el estado de su
 * operador, para que el supervisor sepa a cuáles les falta registrar la
 * llegada manualmente.
 */
export async function getRecintosDificilAcceso(): Promise<RecintoDificilAccesoDto[]> {
  const { data } = await api.get<RecintoDificilAccesoDto[]>('/tracking/recintos-dificil-acceso');
  return data;
}

/**
 * HU13 Parte B: registro manual de llegada al recinto (sin GPS), para cuando
 * el operador no tiene señal. Sin cola offline: el supervisor tiene señal en
 * el momento de registrar, aunque el recinto no.
 */
export async function postLlegadaRecintoManual(recintoId: string): Promise<LlegadaRecintoManualResponse> {
  const { data } = await api.post<LlegadaRecintoManualResponse>('/tracking/llegada-recinto-manual', { recintoId });
  return data;
}
