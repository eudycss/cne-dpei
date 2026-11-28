/**
 * Formato del reporte de llegadas de los CDA a la DPEI, compartido por la web
 * (pantalla) y la API (Excel/PDF) para que digan lo mismo.
 */

/** "29/11 21:05" en hora de Ecuador: con el día, porque la noche cruza la medianoche. */
export function horaConDia(iso: string | null): string {
  if (!iso) return '—';
  const p = new Intl.DateTimeFormat('es-EC', {
    timeZone: 'America/Guayaquil',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  const v = (t: Intl.DateTimeFormatPartTypes) => p.find((x) => x.type === t)?.value ?? '';
  return `${v('day')}/${v('month')} ${v('hour')}:${v('minute')}`;
}

/** 95 → "1 h 35 min"; 40 → "40 min". */
export function duracionTexto(min: number | null): string {
  if (min === null) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** Cómo se registraron las llegadas del CDA: "App", "Manual (administrador)", "Por kit" o "—" si ninguna pareja llegó. */
export function registroLlegadaTexto(c: { parejasLlegadas: number; manual: boolean; porKit: boolean }): string {
  if (c.parejasLlegadas === 0) return '—';
  const partes = [c.manual && 'Manual (administrador)', c.porKit && 'Por kit'].filter(Boolean);
  return partes.length ? partes.join(', ') : 'App';
}
