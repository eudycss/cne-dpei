import type {
  FotoMilitarResponse,
  LlegadaRecintoRequest,
  LlegadaRecintoResponse,
  RecepcionKitRequest,
  RecepcionKitResponse,
  ValidarKitResponse,
} from '@cne/shared-types';
import { api } from '../api';

export async function subirFotoMilitar(uri: string): Promise<FotoMilitarResponse> {
  const form = new FormData();
  // En RN, FormData acepta el objeto { uri, name, type } como blob; los tipos
  // estándar de TS no lo reflejan, por eso el cast a any.
  const filename = uri.split('/').pop() ?? `militar-${Date.now()}.jpg`;
  const match = /\.(\w+)$/.exec(filename);
  const ext = match?.[1]?.toLowerCase() ?? 'jpg';
  const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
  form.append('file', { uri, name: filename, type: mime } as any);

  const { data } = await api.post<FotoMilitarResponse>('/tracking/foto-militar', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    transformRequest: (d) => d,
  });
  return data;
}

export async function validarKit(codigo: string): Promise<ValidarKitResponse> {
  const { data } = await api.post<ValidarKitResponse>('/tracking/validar-kit', { codigo });
  return data;
}

export async function confirmarRecepcionKit(
  body: RecepcionKitRequest,
): Promise<RecepcionKitResponse> {
  const { data } = await api.post<RecepcionKitResponse>('/tracking/recepcion-kit', body);
  return data;
}

export async function registrarLlegadaRecinto(
  body: LlegadaRecintoRequest,
): Promise<LlegadaRecintoResponse> {
  const { data } = await api.post<LlegadaRecintoResponse>('/tracking/llegada-recinto', body);
  return data;
}
