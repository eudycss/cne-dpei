import type maplibregl from 'maplibre-gl';
import type { Theme } from '../../theme/ThemeContext';

// Tiles raster, gratis y sin API key. Se usan raster y no vector tiles a
// propósito: con vector tiles el worker de MapLibre no terminaba de cargar en
// este entorno (ver MapView.tsx).
function estiloRaster(id: string, tiles: string[], attribution: string): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: { [id]: { type: 'raster', tiles, tileSize: 256, attribution } },
    layers: [{ id, type: 'raster', source: id }],
  };
}

const ATRIBUCION_OSM =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

export const ESTILO_CLARO = estiloRaster(
  'osm',
  ['a', 'b', 'c'].map((s) => `https://${s}.tile.openstreetmap.org/{z}/{x}/{y}.png`),
  ATRIBUCION_OSM,
);

// CARTO "Dark Matter" en raster: mismos datos de OpenStreetMap, fondo oscuro.
export const ESTILO_OSCURO = estiloRaster(
  'carto-dark',
  ['a', 'b', 'c', 'd'].map((s) => `https://${s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`),
  `${ATRIBUCION_OSM} &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>`,
);

export function estiloMapa(theme: Theme): maplibregl.StyleSpecification {
  return theme === 'dark' ? ESTILO_OSCURO : ESTILO_CLARO;
}
