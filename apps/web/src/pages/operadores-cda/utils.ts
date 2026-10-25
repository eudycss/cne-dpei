/** Sin tildes y en minúsculas, para buscar "chavez" y encontrar "CHÁVEZ". */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Iniciales para el avatar: primer apellido y primer nombre ("APELLIDO1 APELLIDO2 NOMBRE1 …"). */
export function iniciales(apellidosNombres: string): string {
  const p = apellidosNombres.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[2]?.[0] ?? p[1]?.[0] ?? '')).toUpperCase();
}

/**
 * "APELLIDO1 APELLIDO2 NOMBRE1 NOMBRE2" → apellidos y nombres por separado
 * (las dos primeras palabras son los apellidos). Con dos palabras o menos
 * todo queda como apellidos.
 */
export function partirNombre(apellidosNombres: string): { apellidos: string; nombres: string } {
  const p = apellidosNombres.trim().split(/\s+/);
  if (p.length <= 2) return { apellidos: p.join(' '), nombres: '' };
  return { apellidos: p.slice(0, 2).join(' '), nombres: p.slice(2).join(' ') };
}

const ABREVIATURAS: Record<string, string> = { asistente: 'Asist.', administrativo: 'Adm.', administrativa: 'Adm.' };
const SIGLAS = new Set(['cda', 'cne', 'dpe', 'cpe', 'upsi']);

/** "ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - OPERADORES CDA" → "Asist. Adm. Electoral Provincial". */
export function cargoCorto(cargo: string): string {
  return cargo
    .split(' - ')[0]
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => ABREVIATURAS[w] ?? (SIGLAS.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

const ZONA = 'America/Guayaquil';

/** "2026-10-20" -> "20/10/2026" (sin pasar por Date: no se corre de día por zona horaria). */
export function fechaCorta(iso: string): string {
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/** Hoy (AAAA-MM-DD) en Ecuador, como lo calcula la API. */
export function hoyEcuador(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    ahora,
  );
}

/** "08:05" en hora de Ecuador. */
export function horaEcuador(iso: string): string {
  // hourCycle h23 (no hour12:false): algunos motores ICU dan "24:05" a medianoche.
  return new Date(iso).toLocaleTimeString('es-EC', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/** Celular de Ecuador para wa.me: "0968 333 444" → "593968333444". null si no parece un celular. */
export function numeroWhatsApp(telefono: string | null): string | null {
  const d = (telefono ?? '').replace(/\D/g, '');
  if (/^09\d{8}$/.test(d)) return `593${d.slice(1)}`;
  if (/^5939\d{8}$/.test(d)) return d;
  return null;
}

/** El mensaje que manda la API (400/404/409) o uno genérico. */
export function mensajeError(e: unknown, porDefecto: string): string {
  return (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? porDefecto;
}
