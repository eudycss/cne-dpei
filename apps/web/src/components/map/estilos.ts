import type maplibregl from 'maplibre-gl';
import type { Theme } from '../../theme/ThemeContext';

// Tiles raster de OpenStreetMap, gratis y sin API key. Se usan raster y no
// vector tiles a propósito: con vector tiles el worker de MapLibre no
// terminaba de cargar en este entorno (ver MapView.tsx).
const TILES_OSM = ['a', 'b', 'c'].map((s) => `https://${s}.tile.openstreetmap.org/{z}/{x}/{y}.png`);
const ATRIBUCION_OSM =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';

type PaintRaster = maplibregl.RasterLayerSpecification['paint'];

function estiloOsm(paint?: PaintRaster): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: { type: 'raster', tiles: TILES_OSM, tileSize: 256, attribution: ATRIBUCION_OSM },
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm', ...(paint ? { paint } : {}) }],
  };
}

export const ESTILO_CLARO = estiloOsm();

// Mismas teselas, oscurecidas en el render: invertir el brillo (min/max
// cruzados) y girar el tono 180° para que el agua siga azul y la vegetación
// verde. Se evita así depender de un proveedor de mapas oscuros: CARTO pasó a
// exigir API key (muestra "API KEY REQUIRED" en cada tesela).
export const ESTILO_OSCURO = estiloOsm({
  'raster-brightness-min': 1,
  'raster-brightness-max': 0.08,
  'raster-hue-rotate': 180,
  'raster-saturation': -0.35,
  'raster-contrast': 0.1,
});

export function estiloMapa(theme: Theme): maplibregl.StyleSpecification {
  return theme === 'dark' ? ESTILO_OSCURO : ESTILO_CLARO;
}
