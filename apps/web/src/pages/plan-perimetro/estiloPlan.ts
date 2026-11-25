import type * as maplibregl from 'maplibre-gl';
import type { capasDelPlan } from './geometria';

// Estilo del mapa del plan: satélite Esri + calles y nombres, relieve 3D y las
// capas dibujadas del plan. Todo raster/GeoJSON (sin vector tiles: ver MapView.tsx).
// Gratis y sin API key. Se arma entero en cada cambio y MapLibre aplica solo la
// diferencia (setStyle con diff), así cambiar de capa no pierde el dibujo.

export type CapaBase = 'ortofoto' | 'satelite' | 'satelite-calles' | 'calles';

export const CAPAS_BASE: { id: CapaBase; etiqueta: string }[] = [
  { id: 'ortofoto', etiqueta: 'Ortofoto IGM y calles' },
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

/**
 * Ortofotos del Instituto Geográfico Militar (IGM) del Ecuador: 30 cm por píxel,
 * más nítidas que Esri. Servicio WMS público (GeoServer). Solo responde hasta el
 * zoom 18 y con teselas de 256 px (con 512 px o zoom 19+ devuelve error), por eso
 * maxzoom 18: más cerca MapLibre amplía la del 18. Fuera de su cobertura se ve
 * Esri debajo (PNG transparente). Orden: la más reciente queda arriba.
 */
export const ORTOFOTOS_IGM: { id: string; toma: string; capa: string; bounds: [number, number, number, number]; zona: string }[] = [
  {
    id: 'igm-ibarra-2020',
    toma: 'toma2020',
    capa: 'otf_uxp_20200229_ibarra_30cm_5k',
    bounds: [-78.16149, 0.31488, -77.97275, 0.5155],
    zona: 'Ibarra, Salinas, Pusir, Ambuquí, Imbaya (feb. 2020)',
  },
  {
    id: 'igm-san-pablo-2020',
    toma: 'toma2020',
    capa: 'otf_uxp_20201108_san_pablo_30cm_5k',
    bounds: [-78.28481, 0.02171, -78.09688, 0.36773],
    zona: 'Atuntaqui, Cotacachi, Otavalo, San Pablo, Cayambe (nov. 2020)',
  },
  {
    id: 'igm-otavalo-2021',
    toma: 'toma2021',
    capa: 'otf_uxp_20210927_otavalo_30cm_5k',
    bounds: [-78.41283, 0.04018, -78.2189, 0.29863],
    zona: 'Otavalo, Eugenio Espejo, San Rafael, Quichinche (sep. 2021)',
  },
];
const ATRIB_IGM = 'Ortofotos © Instituto Geográfico Militar del Ecuador';
/** Por debajo de este zoom no se piden ortofotos (teselas enormes para el servidor del IGM): se ve Esri. */
export const MIN_ZOOM_IGM = 12;

/** URL de tesela WMS: MapLibre reemplaza {bbox-epsg-3857} por el recuadro de cada tesela. */
export function urlOrtofotoIgm(toma: string, capa: string): string {
  const params = new URLSearchParams({
    service: 'WMS',
    version: '1.3.0',
    request: 'GetMap',
    layers: capa,
    styles: '',
    crs: 'EPSG:3857',
    width: '256',
    height: '256',
    format: 'image/png',
    transparent: 'true',
  });
  // {bbox-epsg-3857} va sin codificar: es el comodín que reemplaza MapLibre.
  return `https://www.geoportaligm.gob.ec/orto/${toma}/wms?${params}&bbox={bbox-epsg-3857}`;
}

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
  const ortofotos: maplibregl.LayerSpecification[] =
    capa === 'ortofoto' ? ORTOFOTOS_IGM.map((o) => ({ id: o.id, type: 'raster', source: o.id, minzoom: MIN_ZOOM_IGM })) : [];
  const calles: maplibregl.LayerSpecification[] =
    capa === 'satelite-calles' || capa === 'ortofoto'
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
      ...Object.fromEntries(
        ORTOFOTOS_IGM.map((o, i) => [
          o.id,
          {
            ...raster(urlOrtofotoIgm(o.toma, o.capa), MAX_ZOOM_SATELITE, i === 0 ? ATRIB_IGM : undefined),
            minzoom: MIN_ZOOM_IGM,
            // Fuera de su recuadro no se piden teselas.
            bounds: o.bounds,
          } satisfies maplibregl.RasterSourceSpecification,
        ]),
      ),
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
      ...ortofotos,
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
