import type {
  IngestaPosicionesRequest,
  IngestaPosicionesResponse,
  LlegadaDpiRequest,
  LlegadaDpiResponse,
  RetornoKitsResponse,
  SalidaRecintoRequest,
  SalidaRecintoResponse,
  ValidarKitRetornoResponse,
  VerificarKitRetornoRequest,
  VerificarKitRetornoResponse,
} from '@cne/shared-types';
import { api } from '../api';
import { withOffline } from '../offline-queue';
import { subirFoto } from '../subir-foto';
import { actualizarCopia } from '../cache-jornada';

// subirFotoActa NO tiene soporte offline: las URLs de las actas son requeridas
// por postSalidaRecinto (mismo criterio que subirFotoMilitar en llegada.ts).
export async function subirFotoActa(uri: string): Promise<{ url: string }> {
  return subirFoto<{ url: string }>('/tracking/foto-acta', uri);
}

export async function postSalidaRecinto(body: SalidaRecintoRequest): Promise<SalidaRecintoResponse | null> {
  const result = await withOffline('/tracking/salida-recinto', 'post', body, async () => {
    const { data } = await api.post<SalidaRecintoResponse>('/tracking/salida-recinto', body);
    return data;
  });
  await actualizarCopia((a) => ({ ...a, yaRegistroSalidaRecinto: true }));
  return result;
}

export async function postPosiciones(body: IngestaPosicionesRequest): Promise<IngestaPosicionesResponse | null> {
  return withOffline('/tracking/posiciones', 'post', body, async () => {
    const { data } = await api.post<IngestaPosicionesResponse>('/tracking/posiciones', body);
    return data;
  }, { enOrden: false });
}

export async function postLlegadaDpi(body: LlegadaDpiRequest): Promise<LlegadaDpiResponse | null> {
  const result = await withOffline('/tracking/llegada-dpi', 'post', body, async () => {
    const { data } = await api.post<LlegadaDpiResponse>('/tracking/llegada-dpi', body);
    return data;
  });
  await actualizarCopia((a) => ({ ...a, yaRegistroLlegadaDpi: true }));
  return result;
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

export async function getRetornoKits(): Promise<RetornoKitsResponse> {
  const { data } = await api.get<RetornoKitsResponse>('/tracking/retorno-kits');
  return data;
}
