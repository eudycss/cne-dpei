import type {
  IngestaPosicionesRequest,
  IngestaPosicionesResponse,
  KitsVerificadosRetornoResponse,
  LlegadaDpiRequest,
  LlegadaDpiResponse,
  SalidaRecintoRequest,
  SalidaRecintoResponse,
  ValidarKitRetornoResponse,
  VerificarKitRetornoRequest,
  VerificarKitRetornoResponse,
} from '@cne/shared-types';
import { api } from '../api';

export async function postSalidaRecinto(
  body: SalidaRecintoRequest,
): Promise<SalidaRecintoResponse> {
  const { data } = await api.post<SalidaRecintoResponse>('/tracking/salida-recinto', body);
  return data;
}

export async function postPosiciones(
  body: IngestaPosicionesRequest,
): Promise<IngestaPosicionesResponse> {
  const { data } = await api.post<IngestaPosicionesResponse>('/tracking/posiciones', body);
  return data;
}

export async function postLlegadaDpi(
  body: LlegadaDpiRequest,
): Promise<LlegadaDpiResponse> {
  const { data } = await api.post<LlegadaDpiResponse>('/tracking/llegada-dpi', body);
  return data;
}

export async function validarKitRetorno(codigo: string): Promise<ValidarKitRetornoResponse> {
  const { data } = await api.post<ValidarKitRetornoResponse>('/tracking/validar-kit-retorno', { codigo });
  return data;
}

export async function verificarKitRetorno(
  body: VerificarKitRetornoRequest,
): Promise<VerificarKitRetornoResponse> {
  const { data } = await api.post<VerificarKitRetornoResponse>('/tracking/verificar-kit-retorno', body);
  return data;
}

export async function getKitsVerificadosRetorno(): Promise<KitsVerificadosRetornoResponse> {
  const { data } = await api.get<KitsVerificadosRetornoResponse>('/tracking/kits-verificados-retorno');
  return data;
}
