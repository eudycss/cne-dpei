import type { PlanPerimetroDetalle, TipoZonaPerimetro, VallaPerimetro } from '@cne/shared-types';

// Geometría del plan de perímetro (portada de la app suelta plan-perimetro, logic.js).
// Puntos en [lat, lng] como en la API; GeoJSON va en [lng, lat].

const RADIO_TIERRA = 6371008.8; // radio medio terrestre (m)
const aRad = (d: number) => (d * Math.PI) / 180;

export const ZONAS_PERIMETRO: Record<TipoZonaPerimetro, { etiqueta: string; color: string }> = {
  peligro: { etiqueta: 'Peligro', color: '#ef4444' },
  precaucion: { etiqueta: 'Precaución', color: '#f59e0b' },
  segura: { etiqueta: 'Segura', color: '#22c55e' },
  acceso: { etiqueta: 'Acceso / evacuación', color: '#3b82f6' },
};

function metrosPorGrado(lat: number) {
  const mLat = (Math.PI / 180) * RADIO_TIERRA;
  return { lat: mLat, lng: mLat * Math.cos(aRad(lat)) };
}

/** Desplaza un punto dE metros al este y dN metros al norte. */
export function desplazar([lat, lng]: [number, number], dE: number, dN: number): [number, number] {
  const m = metrosPorGrado(lat);
  return [lat + dN / m.lat, lng + dE / m.lng];
}

/** Extremos de una valla de `largo` metros centrada en su punto y girada `angulo` grados (0 = norte). */
export function extremosValla(v: Pick<VallaPerimetro, 'lat' | 'lng' | 'angulo'>, largo: number): [[number, number], [number, number]] {
  const mitad = largo / 2;
  const a = aRad(v.angulo);
  const dE = Math.sin(a) * mitad;
  const dN = Math.cos(a) * mitad;
  return [desplazar([v.lat, v.lng], -dE, -dN), desplazar([v.lat, v.lng], dE, dN)];
}

const aLngLat = ([lat, lng]: [number, number]): [number, number] => [lng, lat];
/** Anillo GeoJSON: [lng, lat] y cerrado (el primer punto se repite al final). */
const anillo = (puntos: [number, number][]) => [...puntos, puntos[0]].map(aLngLat);

type Coleccion = GeoJSON.FeatureCollection;

/** Las tres capas dibujadas del plan, listas para fuentes GeoJSON de MapLibre. */
export function capasDelPlan(plan: Pick<PlanPerimetroDetalle, 'perimetro' | 'zonas' | 'vallas' | 'ajustes'>): {
  perimetro: Coleccion;
  zonas: Coleccion;
  vallas: Coleccion;
} {
  return {
    perimetro: {
      type: 'FeatureCollection',
      features: plan.perimetro
        ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [anillo(plan.perimetro)] } }]
        : [],
    },
    zonas: {
      type: 'FeatureCollection',
      features: plan.zonas.map((z) => ({
        type: 'Feature',
        properties: { nombre: z.nombre, color: ZONAS_PERIMETRO[z.tipo].color },
        geometry: { type: 'Polygon', coordinates: [anillo(z.coords)] },
      })),
    },
    vallas: {
      type: 'FeatureCollection',
      features: plan.vallas.map((v) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: extremosValla(v, plan.ajustes.largoValla).map(aLngLat) },
      })),
    },
  };
}

type Punto = [number, number];
const aGrados = (r: number) => (r * 180) / Math.PI;
const acotar = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Distancia geodésica (haversine) en metros. */
export function distancia(a: Punto, b: Punto): number {
  const dLat = aRad(b[0] - a[0]);
  const dLng = aRad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aRad(a[0])) * Math.cos(aRad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TIERRA * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Vector local (este, norte) en metros de a hacia b. */
function enu(a: Punto, b: Punto) {
  const m = metrosPorGrado((a[0] + b[0]) / 2);
  return { e: (b[1] - a[1]) * m.lng, n: (b[0] - a[0]) * m.lat };
}

/** Rumbo de a hacia b en grados (0 = norte, sentido horario). */
export function rumbo(a: Punto, b: Punto): number {
  const v = enu(a, b);
  return (aGrados(Math.atan2(v.e, v.n)) + 360) % 360;
}

/** Tramos del anillo cerrado (el último vuelve al primero). */
function tramos(anillo: Punto[]): [Punto, Punto][] {
  if (anillo.length < 2) return [];
  const cerrado = anillo.length > 2;
  const n = cerrado ? anillo.length : anillo.length - 1;
  return Array.from({ length: n }, (_, i) => [anillo[i], anillo[(i + 1) % anillo.length]]);
}

/** Largo del perímetro en metros. */
export function longitudAnillo(anillo: Punto[]): number {
  return tramos(anillo).reduce((s, [a, b]) => s + distancia(a, b), 0);
}

/** Área del polígono en m² (fórmula del zapatero en plano local). */
export function areaAnillo(anillo: Punto[]): number {
  if (anillo.length < 3) return 0;
  const pts = anillo.map((p) => enu(anillo[0], p));
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.e * b.n - b.e * a.n;
  }
  return Math.abs(s) / 2;
}

/** `n` puntos a la misma distancia uno de otro sobre el perímetro, con el rumbo de su tramo. */
export function puntosEquidistantes(anillo: Punto[], n: number): { punto: Punto; rumbo: number }[] {
  const cuantos = Math.max(0, Math.floor(n));
  const segs = tramos(anillo).map(([a, b]) => ({ a, b, largo: distancia(a, b) }));
  const total = segs.reduce((s, t) => s + t.largo, 0);
  if (!cuantos || total === 0) return [];
  const paso = total / cuantos;
  return Array.from({ length: cuantos }, (_, i) => {
    let resto = i * paso;
    for (const t of segs) {
      if (resto <= t.largo || t === segs[segs.length - 1]) {
        const f = t.largo === 0 ? 0 : acotar(resto / t.largo, 0, 1);
        return { punto: [t.a[0] + (t.b[0] - t.a[0]) * f, t.a[1] + (t.b[1] - t.a[1]) * f] as Punto, rumbo: rumbo(t.a, t.b) };
      }
      resto -= t.largo;
    }
    return { punto: anillo[0], rumbo: 0 };
  });
}

/** Tramo del perímetro más cercano a p: rumbo del tramo y distancia (m). */
export function tramoMasCercano(anillo: Punto[], p: Punto): { rumbo: number; distancia: number } | null {
  let mejor: { rumbo: number; distancia: number } | null = null;
  for (const [a, b] of tramos(anillo)) {
    const ab = enu(a, b);
    const ap = enu(a, p);
    const l2 = ab.e * ab.e + ab.n * ab.n;
    const t = l2 === 0 ? 0 : acotar((ap.e * ab.e + ap.n * ab.n) / l2, 0, 1);
    const d = distancia(p, desplazar(a, ab.e * t, ab.n * t));
    if (!mejor || d < mejor.distancia) mejor = { rumbo: rumbo(a, b), distancia: d };
  }
  return mejor;
}

/** Línea y vértices del polígono que se está dibujando (vista previa). */
export function capaDibujo(puntos: Punto[]): GeoJSON.FeatureCollection {
  const vertices: GeoJSON.Feature[] = puntos.map((p) => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'Point', coordinates: aLngLat(p) },
  }));
  const linea: GeoJSON.Feature[] =
    puntos.length >= 2
      ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [...puntos, puntos[0]].map(aLngLat) } }]
      : [];
  return { type: 'FeatureCollection', features: [...linea, ...vertices] };
}

/** Todos los puntos del plan, para encuadrarlo cuando no tiene una vista guardada. */
export function puntosDelPlan(plan: Pick<PlanPerimetroDetalle, 'perimetro' | 'zonas' | 'vallas' | 'puestos'>): [number, number][] {
  return [
    ...(plan.perimetro ?? []),
    ...plan.zonas.flatMap((z) => z.coords),
    ...plan.vallas.map((v): [number, number] => [v.lat, v.lng]),
    ...plan.puestos.map((p): [number, number] => [p.lat, p.lng]),
  ];
}
