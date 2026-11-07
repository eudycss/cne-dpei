import type { GuardarTiemposViajeRequest, GuardarTiemposViajeResult, TiemposViajeRecintos } from '@cne/shared-types';
import { api } from '../api';

export async function getTiemposViaje(): Promise<TiemposViajeRecintos> {
  const { data } = await api.get<TiemposViajeRecintos>('/recintos/tiempos-viaje');
  return data;
}

export async function guardarTiemposViaje(body: GuardarTiemposViajeRequest): Promise<GuardarTiemposViajeResult> {
  const { data } = await api.put<GuardarTiemposViajeResult>('/recintos/tiempos-viaje', body);
  return data;
}
