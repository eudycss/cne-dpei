import type { CoordenadaRecinto } from '@cne/shared-types';

/** Una llegada/salida del recinto: dónde estaba el celular y a cuántos metros de la coordenada guardada. */
export interface MarcaRecinto {
  lat: number;
  lng: number;
  metros: number;
}

export interface RecintoCoordenada {
  id: string;
  codigo: string;
  nombre: string;
  canton: string;
  lat: number;
  lng: number;
}

/** Con menos marcaciones que esto la mediana no es confiable: se muestra, pero no se propone. */
export const MIN_MARCAS_COORDENADA = 3;
/** Mediana de distancia desde la que la coordenada guardada se considera sospechosa. */
export const UMBRAL_COORDENADA_METROS = 150;
/** Marcaciones más lejos que esto son de otro lugar (p. ej. un registro fuera de rango), no del recinto. */
export const RADIO_MARCAS_METROS = 2000;

const RADIO_TIERRA_M = 6_371_000;

/** Mediana de una lista no vacía (la media de los dos centrales si es par). */
export function mediana(valores: number[]): number {
  const o = [...valores].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
}

/** Distancia en metros entre dos puntos (haversine). */
export function distanciaMetros(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * RADIO_TIERRA_M * Math.asin(Math.sqrt(a));
}

const redondear = (n: number, decimales: number) => Number(n.toFixed(decimales));

/** Umbral pedido por el usuario: solo 10-5000 m; cualquier otra cosa (vacío, texto, repetido) vale el de por defecto. */
export function parseUmbral(valor: unknown): number {
  const n = typeof valor === 'string' && valor.trim() ? Number(valor) : NaN;
  return Number.isFinite(n) && n >= 10 && n <= 5000 ? n : UMBRAL_COORDENADA_METROS;
}

/**
 * Compara la coordenada guardada de cada recinto con las marcaciones reales: la
 * propuesta es la mediana de latitud y de longitud (una marca suelta no la
 * arrastra). Las marcaciones a más de RADIO_MARCAS_METROS no entran en la propuesta
 * pero se cuentan: un recinto con solo marcaciones lejanas tiene la coordenada muy corrida
 * y es sospechoso. Sin marcaciones el recinto no aparece.
 */
export function analizarCoordenadas(
  recintos: RecintoCoordenada[],
  marcas: Map<string, MarcaRecinto[]>,
  umbralMetros = UMBRAL_COORDENADA_METROS,
  minMarcas = MIN_MARCAS_COORDENADA,
): CoordenadaRecinto[] {
  const filas: CoordenadaRecinto[] = [];
  for (const r of recintos) {
    const todas = marcas.get(r.id);
    if (!todas?.length) continue;
    const m = todas.filter((x) => x.metros <= RADIO_MARCAS_METROS);
    const marcasLejanas = todas.length - m.length;
    if (m.length === 0) {
      filas.push({
        id: r.id,
        codigo: r.codigo,
        nombre: r.nombre,
        canton: r.canton,
        latActual: r.lat,
        lngActual: r.lng,
        marcas: 0,
        marcasLejanas,
        medianaMetros: Math.round(mediana(todas.map((x) => x.metros))),
        latPropuesta: null,
        lngPropuesta: null,
        desfaseMetros: null,
        sospechosa: marcasLejanas >= minMarcas,
      });
      continue;
    }
    const medianaMetros = Math.round(mediana(m.map((x) => x.metros)));
    const suficientes = m.length >= minMarcas;
    const latPropuesta = suficientes ? redondear(mediana(m.map((x) => x.lat)), 6) : null;
    const lngPropuesta = suficientes ? redondear(mediana(m.map((x) => x.lng)), 6) : null;
    filas.push({
      id: r.id,
      codigo: r.codigo,
      nombre: r.nombre,
      canton: r.canton,
      latActual: r.lat,
      lngActual: r.lng,
      marcas: m.length,
      marcasLejanas,
      medianaMetros,
      latPropuesta,
      lngPropuesta,
      desfaseMetros:
        latPropuesta === null || lngPropuesta === null
          ? null
          : Math.round(distanciaMetros(r.lat, r.lng, latPropuesta, lngPropuesta)),
      sospechosa: suficientes && medianaMetros > umbralMetros,
    });
  }
  // Los más desfasados primero.
  return filas.sort((a, b) => Number(b.sospechosa) - Number(a.sospechosa) || b.medianaMetros - a.medianaMetros);
}
