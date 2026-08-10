import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MapContext } from './MapContext';

// Tiles raster OSM, gratis y sin API key. MapLibre GL nos da algo que Leaflet no podía:
// inclinación 3D (pitch) y renderizado WebGL suave. Se probó migrar a vector tiles
// (OpenFreeMap, gratis) para un look más "espectacular" tipo mapcn, pero el worker de
// MapLibre GL nunca terminó de cargar en este entorno (mismo bloqueo con maplibre-gl v4,
// v6 y hasta con el style oficial de demo de MapLibre) — queda pendiente de investigar
// aparte, no bloquea esta entrega.
const OSM_RASTER_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

interface MapViewProps {
  /** [latitud, longitud], para no invertir el orden usado en el resto de la app. */
  center: [number, number];
  zoom: number;
  scrollZoom?: boolean;
  /** Inclinación 3D inicial (grados). 0 = plano, ideal para lookups puntuales. */
  pitch?: number;
  className?: string;
  children?: ReactNode;
}

export function MapView({ center, zoom, scrollZoom = true, pitch = 0, className, children }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const instance = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_RASTER_STYLE,
      center: [center[1], center[0]],
      zoom,
      pitch,
      scrollZoom,
      attributionControl: { compact: false },
    });

    instance.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    instance.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), 'top-right');
    instance.addControl(new maplibregl.FullscreenControl(), 'top-right');

    instance.on('load', () => setMap(instance));

    return () => {
      instance.remove();
      setMap(null);
    };
    // Centrado/zoom/pitch iniciales; cambios posteriores se manejan vía FitBounds, no recreando el mapa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={containerRef} className={className}>
      {map && <MapContext.Provider value={map}>{children}</MapContext.Provider>}
    </div>
  );
}
