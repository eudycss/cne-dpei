import axios from 'axios';
import { api } from './api';

/**
 * Sube una foto (multipart) al servidor. Si falla por sesión vencida (401) reintenta
 * UNA vez con un FormData nuevo: el de un envío ya hecho no es confiable para
 * reenviar, y tras el 401 el interceptor de `api` ya renovó el token. Los errores de
 * red NO se reintentan aquí: la lógica offline (foto pendiente, cola) ya los maneja.
 * Antes, la primera foto tras >15 min sin otra petición fallaba y el operador la
 * subía a mano al segundo intento (Díaz Jumine, 2026-11-15).
 */
export async function subirFoto<T>(endpoint: string, uri: string): Promise<T> {
  const intentar = async () => {
    const form = new FormData();
    const filename = uri.split('/').pop() ?? `foto-${Date.now()}.jpg`;
    const ext = /\.(\w+)$/.exec(filename)?.[1]?.toLowerCase() ?? 'jpg';
    const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
    // En RN, FormData acepta el objeto { uri, name, type } como blob; los tipos
    // estándar de TS no lo reflejan, por eso el cast a any.
    form.append('file', { uri, name: filename, type: mime } as any);
    const { data } = await api.post<T>(endpoint, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      transformRequest: (d) => d,
    });
    return data;
  };
  try {
    return await intentar();
  } catch (e) {
    if (!(axios.isAxiosError(e) && e.response?.status === 401)) throw e;
    return intentar();
  }
}
