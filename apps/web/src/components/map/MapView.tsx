import 'maplibre-gl/dist/maplibre-gl.css';
import * as maplibregl from 'maplibre-gl';
import './worker';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MapContext } from './MapContext';
import { estiloMapa } from './estilos';
import { useTheme } from '../../theme/ThemeContext';

// Tiles raster (ver estilos.ts), gratis y sin API key. MapLibre GL nos da algo que Leaflet
// no podía: inclinación 3D (pitch) y renderizado WebGL suave. Se probó migrar a vector tiles
// (OpenFreeMap, gratis) para un look más "espectacular" tipo mapcn, pero el worker de
// MapLibre GL nunca terminó de cargar en este entorno (mismo bloqueo con maplibre-gl v4,
// v6 y hasta con el style oficial de demo de MapLibre) — queda pendiente de investigar
// aparte, no bloquea esta entrega.

interface MapViewProps {
  /** [latitud, longitud], para no invertir el orden usado en el resto de la app. */
  center: [number, number];
  zoom: number;
  scrollZoom?: boolean;
  /** Inclinación 3D inicial (grados). 0 = plano, ideal para lookups puntuales. */
  pitch?: number;
  /** Inclinación 3D máxima (grados). MapLibre trae 60; un mapa tipo Google Earth usa hasta 85. */
  maxPitch?: number;
  /**
   * Estilo propio (p. ej. satélite + capas dibujadas). Si viene, reemplaza al del
   * tema y cada cambio se aplica con setStyle, que solo actualiza la diferencia.
   */
  estilo?: maplibregl.StyleSpecification;
  className?: string;
  children?: ReactNode;
}

export function MapView({ center, zoom, scrollZoom = true, pitch = 0, maxPitch, estilo, className, children }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<maplibregl.Map | null>(null);
  const { theme } = useTheme();

  useEffect(() => {
    if (!containerRef.current) return;

    const instance = new maplibregl.Map({
      container: containerRef.current,
      style: estilo ?? estiloMapa(theme),
      center: [center[1], center[0]],
      zoom,
      pitch,
      ...(maxPitch !== undefined ? { maxPitch } : {}),
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

  // Cambio de tema (o de estilo propio) sin recrear el mapa: solo se reemplaza el
  // estilo. Los marcadores y popups son DOM (maplibregl.Marker), no capas, así que no se pierden.
  const estiloActual = estilo ?? estiloMapa(theme);
  const estiloAplicado = useRef(estiloActual);
  useEffect(() => {
    if (!map || estiloAplicado.current === estiloActual) return;
    estiloAplicado.current = estiloActual;
    map.setStyle(estiloActual);
  }, [map, estiloActual]);

  return (
    <div ref={containerRef} className={className}>
      {map && <MapContext.Provider value={map}>{children}</MapContext.Provider>}
    </div>
  );
}
