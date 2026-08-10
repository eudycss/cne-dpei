import { createContext, useContext } from 'react';
import type * as maplibregl from 'maplibre-gl';

export const MapContext = createContext<maplibregl.Map | null>(null);

export function useMapInstance(): maplibregl.Map {
  const map = useContext(MapContext);
  if (!map) throw new Error('useMapInstance debe usarse dentro de <MapView>');
  return map;
}
