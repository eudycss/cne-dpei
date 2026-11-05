import type { CargoSimulador, NovedadDigitacion, PersonaSimulador, PracticaDigitacion } from '@cne/shared-types';
import type { PracticaDigitacionInput } from '@cne/shared-validation';
import { api } from '../api';

const BASE = '/simulador-digitacion';

export const CLAVE_PRACTICAS = ['simulador', 'practicas'] as const;
export const CLAVE_NOVEDADES = ['simulador', 'novedades'] as const;
export const CLAVE_CARGOS = ['simulador', 'cargos'] as const;

export async function getPracticasDigitacion(): Promise<PracticaDigitacion[]> {
  const { data } = await api.get<PracticaDigitacion[]>(`${BASE}/practicas`);
  return data;
}

export async function crearPracticaDigitacion(body: PracticaDigitacionInput): Promise<PracticaDigitacion> {
  const { data } = await api.post<PracticaDigitacion>(`${BASE}/practicas`, body);
  return data;
}

export async function editarPracticaDigitacion(id: string, body: PracticaDigitacionInput): Promise<PracticaDigitacion> {
  const { data } = await api.put<PracticaDigitacion>(`${BASE}/practicas/${id}`, body);
  return data;
}

export async function cambiarActivaPracticaDigitacion(id: string, activa: boolean): Promise<PracticaDigitacion> {
  const { data } = await api.patch<PracticaDigitacion>(`${BASE}/practicas/${id}/activa`, { activa });
  return data;
}

export async function getCargosSimulador(): Promise<CargoSimulador[]> {
  const { data } = await api.get<CargoSimulador[]>(`${BASE}/cargos`);
  return data;
}

export async function buscarPersonasSimulador(q: string): Promise<PersonaSimulador[]> {
  const { data } = await api.get<PersonaSimulador[]>(`${BASE}/personas`, { params: { q } });
  return data;
}

export async function getNovedadesDigitacion(): Promise<NovedadDigitacion[]> {
  const { data } = await api.get<NovedadDigitacion[]>(`${BASE}/novedades`);
  return data;
}

export async function crearNovedadDigitacion(nombre: string): Promise<NovedadDigitacion> {
  const { data } = await api.post<NovedadDigitacion>(`${BASE}/novedades`, { nombre });
  return data;
}

export async function renombrarNovedadDigitacion(id: string, nombre: string): Promise<NovedadDigitacion> {
  const { data } = await api.patch<NovedadDigitacion>(`${BASE}/novedades/${id}`, { nombre });
  return data;
}

export async function cambiarActivaNovedadDigitacion(id: string, activa: boolean): Promise<NovedadDigitacion> {
  const { data } = await api.patch<NovedadDigitacion>(`${BASE}/novedades/${id}/activa`, { activa });
  return data;
}

// ---- Fechas: Ecuador no tiene horario de verano (siempre UTC−5) ----

const DESFASE_ECUADOR_MS = -5 * 60 * 60_000;

/** Valor de <input type="datetime-local"> en hora de Ecuador → ISO con zona ("…T08:00:00-05:00"). */
export function deCampoFechaHora(local: string): string {
  return `${local}:00-05:00`;
}

/** ISO → valor de <input type="datetime-local"> en hora de Ecuador ("2026-11-10T08:00"). */
export function aCampoFechaHora(iso: string): string {
  return new Date(new Date(iso).getTime() + DESFASE_ECUADOR_MS).toISOString().slice(0, 16);
}

/** "10/11/2026 08:00" en hora de Ecuador. */
export function fechaHoraEcuador(iso: string): string {
  const [fecha, hora] = aCampoFechaHora(iso).split('T');
  const [a, m, d] = fecha.split('-');
  return `${d}/${m}/${a} ${hora}`;
}
