// Buscador de lugares del plan: coordenadas escritas o pegadas (también un enlace
// de Google Maps) y nombres con Nominatim (OpenStreetMap, gratis y sin clave).
// Política de Nominatim: como mucho 1 búsqueda por segundo y nada de
// autocompletar; por eso solo se busca al enviar el formulario.

export interface LugarEncontrado {
  nombre: string;
  /** Segunda línea: el resto de la dirección (cantón, provincia...). */
  detalle: string;
  lat: number;
  lng: number;
}

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
/** Imbabura: los resultados de aquí salen primero (no excluye el resto del país). */
const CAJA_IMBABURA = '-79.30,0.95,-77.75,0.05';
export const MAX_RESULTADOS = 6;
export const MAX_LARGO_BUSQUEDA = 200;

/** Nombre sin tildes ni mayúsculas, para reconocer el mismo lugar escrito distinto. */
const clave = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

const enRango = (lat: number, lng: number) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/**
 * Coordenadas dentro del texto: "0.3485, -78.1189", "0.3485 -78.1189" o un enlace
 * de Google Maps (".../@0.3485,-78.1189,17z" o "?q=0.3485,-78.1189"). null si no hay.
 */
export function leerCoordenadas(texto: string): [number, number] | null {
  const t = texto.trim();
  const enlace = t.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/) ?? t.match(/[?&](?:q|query|ll)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/);
  const suelto = t.match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  const m = enlace ?? suelto;
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return enRango(lat, lng) ? [lat, lng] : null;
}

/** Busca por nombre en Ecuador, con prioridad a Imbabura. Descarta lo que no tenga coordenadas válidas. */
export async function buscarLugares(texto: string, signal?: AbortSignal): Promise<LugarEncontrado[]> {
  const q = texto.trim().slice(0, MAX_LARGO_BUSQUEDA);
  if (!q) return [];
  const params = new URLSearchParams({
    format: 'jsonv2',
    q,
    limit: String(MAX_RESULTADOS),
    countrycodes: 'ec',
    'accept-language': 'es',
    viewbox: CAJA_IMBABURA,
  });
  const r = await fetch(`${NOMINATIM}?${params}`, { headers: { Accept: 'application/json' }, signal, referrerPolicy: 'strict-origin-when-cross-origin' });
  if (!r.ok) throw new Error(`Nominatim respondió ${r.status}`);
  const datos: unknown = await r.json();
  if (!Array.isArray(datos)) return [];
  const vistos = new Set<string>();
  return datos.flatMap((d): LugarEncontrado[] => {
    const lat = Number((d as { lat?: unknown })?.lat);
    const lng = Number((d as { lon?: unknown })?.lon);
    const completo = String((d as { display_name?: unknown })?.display_name ?? '').slice(0, 300);
    if (!enRango(lat, lng) || !completo) return [];
    const [nombre, ...resto] = completo.split(',').map((s) => s.trim());
    // OSM a veces trae el mismo lugar dos veces (con y sin tilde): mismo nombre a ~100 m es repetido.
    const id = `${clave(nombre)}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
    if (vistos.has(id)) return [];
    vistos.add(id);
    return [{ nombre, detalle: resto.join(', '), lat, lng }];
  }).slice(0, MAX_RESULTADOS);
}
