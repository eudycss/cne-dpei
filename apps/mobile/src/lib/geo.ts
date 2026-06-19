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

// ponytail: self-check manual, no hay test runner configurado en apps/mobile.
// Llamar a esta función desde un breakpoint/consola si se necesita revalidar.
export function demoDistanciaMetros(): boolean {
  const quito: Coordenada = { latitud: -0.1807, longitud: -78.4678 };
  const mismoPunto = distanciaMetros(quito, quito);
  // ~111 m por cada 0.001° de latitud en el ecuador.
  const cercaDe1km: Coordenada = { latitud: quito.latitud + 0.009, longitud: quito.longitud };
  const d = distanciaMetros(quito, cercaDe1km);
  return mismoPunto < 0.01 && d > 950 && d < 1050;
}
