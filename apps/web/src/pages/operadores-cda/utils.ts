/** Sin tildes y en minúsculas, para buscar "chavez" y encontrar "CHÁVEZ". */
export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Iniciales para el avatar: primer apellido y primer nombre ("APELLIDO1 APELLIDO2 NOMBRE1 …"). */
export function iniciales(apellidosNombres: string): string {
  const p = apellidosNombres.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[2]?.[0] ?? p[1]?.[0] ?? '')).toUpperCase();
}

const ZONA = 'America/Guayaquil';

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
