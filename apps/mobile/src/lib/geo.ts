const RADIO_TIERRA_METROS = 6371000;

export type Coordenada = { latitud: number; longitud: number };

/** Distancia en metros entre dos coordenadas (fórmula de Haversine). */
export function distanciaMetros(a: Coordenada, b: Coordenada): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitud - a.latitud);
  const dLon = toRad(b.longitud - a.longitud);
  const lat1 = toRad(a.latitud);
  const lat2 = toRad(b.latitud);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * RADIO_TIERRA_METROS * Math.asin(Math.sqrt(h));
}
