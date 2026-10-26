const ZONA = 'America/Guayaquil';

/**
 * Día calendario (AAAA-MM-DD) en Ecuador continental. En UTC el día cambia a
 * las 19:00 locales: una salida a las 19:30 sería "mañana" si se usara UTC.
 */
export function diaEcuador(momento: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    momento,
  );
}

/** AAAA-MM-DD → Date para columnas @db.Date (medianoche UTC, sin corrimiento). */
export function fechaDb(dia: string): Date {
  return new Date(`${dia}T00:00:00Z`);
}

/** Date de una columna @db.Date → AAAA-MM-DD. */
export function diaDeFechaDb(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** "HH:MM" en hora de Ecuador. */
export function horaEcuador(momento: Date): string {
  // hourCycle h23 (no hour12:false): algunos motores ICU dan "24:05" a medianoche.
  return momento.toLocaleTimeString('es-EC', { timeZone: ZONA, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/** AAAA-MM-DD + "HH:MM" en hora de Ecuador → instante. Ecuador continental es UTC-5 todo el año (sin horario de verano). */
export function momentoEcuador(dia: string, hora: string): Date {
  return new Date(`${dia}T${hora}:00-05:00`);
}

/** Días entre dos AAAA-MM-DD, ambos incluidos. */
export function diasEntre(desde: string, hasta: string): string[] {
  const dias: string[] = [];
  for (let d = fechaDb(desde); d <= fechaDb(hasta); d = new Date(d.getTime() + 86_400_000)) {
    dias.push(diaDeFechaDb(d));
  }
  return dias;
}
