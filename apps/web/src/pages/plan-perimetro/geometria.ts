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

/** Todos los puntos del plan, para encuadrarlo cuando no tiene una vista guardada. */
export function puntosDelPlan(plan: Pick<PlanPerimetroDetalle, 'perimetro' | 'zonas' | 'vallas' | 'puestos'>): [number, number][] {
  return [
    ...(plan.perimetro ?? []),
    ...plan.zonas.flatMap((z) => z.coords),
    ...plan.vallas.map((v): [number, number] => [v.lat, v.lng]),
    ...plan.puestos.map((p): [number, number] => [p.lat, p.lng]),
  ];
}
