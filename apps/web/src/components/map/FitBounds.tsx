import maplibregl from 'maplibre-gl';
import { useEffect } from 'react';
import { useMapInstance } from './MapContext';

interface FitBoundsProps {
  /** Lista de [latitud, longitud] a encuadrar. */
  points: [number, number][];
}

export function FitBounds({ points }: FitBoundsProps) {
  const map = useMapInstance();

  useEffect(() => {
    if (points.length === 0) return;
    const start: [number, number] = [points[0][1], points[0][0]];
    const bounds = points.reduce(
      (acc, [lat, lng]) => acc.extend([lng, lat] as [number, number]),
      new maplibregl.LngLatBounds(start, start),
    );
    map.fitBounds(bounds, { padding: 50, maxZoom: 15, duration: 500 });
  }, [map, points]);

  return null;
}
