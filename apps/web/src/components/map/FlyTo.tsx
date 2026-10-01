import { useEffect } from 'react';
import { useMapInstance } from './MapContext';

interface FlyToProps {
  /** [latitud, longitud] a centrar, o null para no hacer nada. */
  target: [number, number] | null;
  /** Cambia en cada pedido para volver a centrar aunque el destino sea el mismo. */
  nonce: number;
  zoom?: number;
}

export function FlyTo({ target, nonce, zoom = 16 }: FlyToProps) {
  const map = useMapInstance();

  useEffect(() => {
    if (!target) return;
    map.flyTo({ center: [target[1], target[0]], zoom, duration: 800 });
    // Solo al pedirlo (nonce), no en cada refresco de la posición.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, nonce]);

  return null;
}
