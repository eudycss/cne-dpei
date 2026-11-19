import type * as maplibregl from 'maplibre-gl';
import type { capasDelPlan } from './geometria';

// Estilo del mapa del plan: satélite Esri + calles y nombres, relieve 3D y las
// capas dibujadas del plan. Todo raster/GeoJSON (sin vector tiles: ver MapView.tsx).
// Gratis y sin API key. Se arma entero en cada cambio y MapLibre aplica solo la
// diferencia (setStyle con diff), así cambiar de capa no pierde el dibujo.

export type CapaBase = 'satelite' | 'satelite-calles' | 'calles';

export const CAPAS_BASE: { id: CapaBase; etiqueta: string }[] = [
  { id: 'satelite-calles', etiqueta: 'Satélite y calles' },
  { id: 'satelite', etiqueta: 'Satélite' },
  { id: 'calles', etiqueta: 'Mapa de calles' },
];

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
// Imbabura solo tiene imagen satelital hasta el zoom 18; más cerca se amplía la del 18.
const MAX_ZOOM_SATELITE = 18;
const ATRIB_ESRI = 'Imágenes © Esri, Maxar, Earthstar Geographics · Calles © Esri, HERE, OpenStreetMap';
const ATRIB_OSM =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';
// Elevación (Terrarium, AWS Open Data): gratis, sin clave.
const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

export const COLOR_PERIMETRO = '#22d3ee';
export const COLOR_VALLA = '#f97316';

type Capas = ReturnType<typeof capasDelPlan>;

const raster = (tiles: string, maxzoom: number, attribution?: string): maplibregl.RasterSourceSpecification => ({
  type: 'raster',
  tiles: [tiles],
  tileSize: 256,
  maxzoom,
  ...(attribution ? { attribution } : {}),
});

const SIN_DIBUJO: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
export const COLOR_DIBUJO = '#facc15';

/** `dibujo`: vista previa del polígono que se está dibujando (línea y vértices). */
export function estiloPlan(
  capa: CapaBase,
  relieve: boolean,
  capas: Capas,
  dibujo: GeoJSON.FeatureCollection = SIN_DIBUJO,
): maplibregl.StyleSpecification {
  const conSatelite = capa !== 'calles';
  const fondo: maplibregl.LayerSpecification[] = conSatelite
    ? [{ id: 'satelite', type: 'raster', source: 'satelite' }]
    : [{ id: 'osm', type: 'raster', source: 'osm' }];
  const calles: maplibregl.LayerSpecification[] =
    capa === 'satelite-calles'
      ? [
          { id: 'calles', type: 'raster', source: 'calles' },
          { id: 'lugares', type: 'raster', source: 'lugares', paint: { 'raster-opacity': 0.9 } },
        ]
      : [];
  const sombras: maplibregl.LayerSpecification[] = relieve
    ? [{ id: 'sombras', type: 'hillshade', source: 'dem-sombras', paint: { 'hillshade-exaggeration': 0.35 } }]
    : [];

  return {
    version: 8,
    sources: {
      satelite: raster(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, MAX_ZOOM_SATELITE, ATRIB_ESRI),
      calles: raster(`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, MAX_ZOOM_SATELITE),
      lugares: raster(`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, MAX_ZOOM_SATELITE),
      osm: raster('https://tile.openstreetmap.org/{z}/{x}/{y}.png', 19, ATRIB_OSM),
      // Dos fuentes de elevación: MapLibre recomienda no compartir la del terreno con el sombreado.
      dem: { type: 'raster-dem', tiles: [TERRARIUM], tileSize: 256, maxzoom: 15, encoding: 'terrarium' },
      'dem-sombras': { type: 'raster-dem', tiles: [TERRARIUM], tileSize: 256, maxzoom: 15, encoding: 'terrarium' },
      'plan-perimetro': { type: 'geojson', data: capas.perimetro },
      'plan-zonas': { type: 'geojson', data: capas.zonas },
      'plan-vallas': { type: 'geojson', data: capas.vallas },
      'plan-dibujo': { type: 'geojson', data: dibujo },
    },
    ...(relieve ? { terrain: { source: 'dem', exaggeration: 1.3 } } : {}),
    layers: [
      ...fondo,
      ...sombras,
      ...calles,
      { id: 'zonas-relleno', type: 'fill', source: 'plan-zonas', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.25 } },
      { id: 'zonas-borde', type: 'line', source: 'plan-zonas', paint: { 'line-color': ['get', 'color'], 'line-width': 2 } },
      { id: 'perimetro-relleno', type: 'fill', source: 'plan-perimetro', paint: { 'fill-color': COLOR_PERIMETRO, 'fill-opacity': 0.08 } },
      {
        id: 'perimetro-borde',
        type: 'line',
        source: 'plan-perimetro',
        paint: { 'line-color': COLOR_PERIMETRO, 'line-width': 3, 'line-dasharray': [2, 1] },
      },
      {
        id: 'vallas',
        type: 'line',
        source: 'plan-vallas',
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': COLOR_VALLA, 'line-width': ['interpolate', ['linear'], ['zoom'], 16, 2, 20, 6] },
      },
      {
        id: 'dibujo-linea',
        type: 'line',
        source: 'plan-dibujo',
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': COLOR_DIBUJO, 'line-width': 2.5, 'line-dasharray': [1, 1] },
      },
      {
        id: 'dibujo-vertices',
        type: 'circle',
        source: 'plan-dibujo',
        filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-radius': 5, 'circle-color': COLOR_DIBUJO, 'circle-stroke-color': '#04151a', 'circle-stroke-width': 2 },
      },
    ],
  };
}
