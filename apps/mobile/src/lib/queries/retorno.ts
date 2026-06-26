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
import { withOffline } from '../offline-queue';

export async function postSalidaRecinto(body: SalidaRecintoRequest): Promise<SalidaRecintoResponse | null> {
  return withOffline('/tracking/salida-recinto', 'post', body, async () => {
    const { data } = await api.post<SalidaRecintoResponse>('/tracking/salida-recinto', body);
    return data;
  });
}

export async function postPosiciones(body: IngestaPosicionesRequest): Promise<IngestaPosicionesResponse | null> {
  return withOffline('/tracking/posiciones', 'post', body, async () => {
    const { data } = await api.post<IngestaPosicionesResponse>('/tracking/posiciones', body);
    return data;
  });
}

export async function postLlegadaDpi(body: LlegadaDpiRequest): Promise<LlegadaDpiResponse | null> {
  return withOffline('/tracking/llegada-dpi', 'post', body, async () => {
    const { data } = await api.post<LlegadaDpiResponse>('/tracking/llegada-dpi', body);
    return data;
  });
}

// validarKitRetorno y verificarKitRetorno requieren respuesta del servidor — NO se envuelven con offline.
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
