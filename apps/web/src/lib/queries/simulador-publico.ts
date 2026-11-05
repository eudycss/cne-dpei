import type {
  EstadoIntentoSimulador,
  GuardarActaSimuladorResponse,
  IngresoSimuladorResponse,
  IniciarSimuladorResponse,
  NuevaActaSimuladorResponse,
} from '@cne/shared-types';
import { apiPublico } from '../api';

const BASE = '/publico/simulador';

// Todo por POST con el dato en el cuerpo: la cédula y el token no quedan en URLs ni logs.

export async function ingresarSimulador(cedula: string): Promise<IngresoSimuladorResponse> {
  const { data } = await apiPublico.post<IngresoSimuladorResponse>(`${BASE}/ingresar`, { cedula });
  return data;
}

export async function iniciarSimulador(cedula: string, practicaId: string): Promise<IniciarSimuladorResponse> {
  const { data } = await apiPublico.post<IniciarSimuladorResponse>(`${BASE}/iniciar`, { cedula, practicaId });
  return data;
}

export async function estadoSimulador(token: string): Promise<EstadoIntentoSimulador> {
  const { data } = await apiPublico.post<EstadoIntentoSimulador>(`${BASE}/estado`, { token });
  return data;
}

export async function nuevaActaSimulador(token: string): Promise<NuevaActaSimuladorResponse> {
  const { data } = await apiPublico.post<NuevaActaSimuladorResponse>(`${BASE}/nueva-acta`, { token });
  return data;
}

export async function guardarActaSimulador(
  token: string,
  actaId: string,
  valores: (number | null)[],
): Promise<GuardarActaSimuladorResponse> {
  const { data } = await apiPublico.post<GuardarActaSimuladorResponse>(`${BASE}/guardar`, { token, actaId, valores });
  return data;
}

export async function borradorActaSimulador(token: string, actaId: string, valores: (number | null)[]): Promise<{ guardado: boolean }> {
  const { data } = await apiPublico.post<{ guardado: boolean }>(`${BASE}/borrador`, { token, actaId, valores });
  return data;
}

/**
 * El token de la práctica vive solo en esta pestaña (sessionStorage): sobrevive
 * a recargar la página, pero no queda en el equipo al cerrarla.
 */
const CLAVE_TOKEN = 'cne.simulador.token';
export const tokenSimulador = {
  leer: () => sessionStorage.getItem(CLAVE_TOKEN),
  guardar: (t: string) => sessionStorage.setItem(CLAVE_TOKEN, t),
  borrar: () => sessionStorage.removeItem(CLAVE_TOKEN),
};

export const estadoHttp = (e: unknown) => (e as { response?: { status?: number } })?.response?.status;
export function mensajeDe(e: unknown, porDefecto: string): string {
  const m = (e as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  return typeof m === 'string' ? m : porDefecto;
}

/** "Sesenta y dos" → "S e s e n t a   y   d o s", como se escribe a mano en los casilleros del acta. */
export function espaciado(texto: string): string {
  return texto
    .split(' ')
    .map((palabra) => palabra.split('').join(' '))
    .join('   ');
}

/** Variación estable por fila (inclinación, sangría, tamaño) para que no parezca texto impreso. */
export function trazoDeFila(semilla: string, fila: number): { giro: number; sangria: number; escala: number } {
  let h = 2166136261;
  for (const c of `${semilla}:${fila}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const u = (n: number) => ((h >>> n) & 0xff) / 255;
  return { giro: Number((u(0) * 3 - 1.5).toFixed(2)), sangria: Math.round(u(8) * 24), escala: Number((0.92 + u(16) * 0.16).toFixed(2)) };
}

/** Milisegundos → "mm:ss" (o "h:mm:ss" si pasa de una hora). */
export function reloj(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const dos = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${dos(m)}:${dos(s)}` : `${dos(m)}:${dos(s)}`;
}
