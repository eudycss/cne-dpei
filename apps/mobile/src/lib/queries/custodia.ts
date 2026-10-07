import type {
  CambiarOperadorRequest,
  CorregirMilitarRequest,
  EntregaCustodio,
  KitCustodiaResponse,
  MilitarResumen,
  OperadorResumen,
  RegistrarEntregaRequest,
} from '@cne/shared-types';
import { api } from '../api';

// Cadena de custodia (Asistente Electoral Transversal). Necesitan la respuesta
// del servidor (militares del recinto, estado del kit): NO van por la cola offline.

export async function validarKitCustodia(codigo: string): Promise<KitCustodiaResponse> {
  const { data } = await api.post<KitCustodiaResponse>('/custodia/validar-kit', { codigo });
  return data;
}

export async function registrarEntrega(body: RegistrarEntregaRequest): Promise<EntregaCustodio> {
  const { data } = await api.post<EntregaCustodio>('/custodia/entregas', body);
  return data;
}

export async function corregirMilitar(kitId: string, body: CorregirMilitarRequest): Promise<EntregaCustodio> {
  const { data } = await api.patch<EntregaCustodio>(`/custodia/entregas/${kitId}/militar`, body);
  return data;
}

export async function cambiarOperador(kitId: string, body: CambiarOperadorRequest): Promise<OperadorResumen> {
  const { data } = await api.patch<OperadorResumen>(`/custodia/kits/${kitId}/operador`, body);
  return data;
}

export async function buscarMilitares(buscar: string): Promise<MilitarResumen[]> {
  const { data } = await api.get<MilitarResumen[]>('/custodia/militares', { params: { buscar } });
  return data;
}

export async function buscarOperadores(buscar: string): Promise<OperadorResumen[]> {
  const { data } = await api.get<OperadorResumen[]>('/custodia/operadores', { params: { buscar } });
  return data;
}
