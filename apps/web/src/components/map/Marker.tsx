import maplibregl from 'maplibre-gl';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMapInstance } from './MapContext';

interface MarkerProps {
  /** [latitud, longitud] */
  position: [number, number];
  /** Anillo de pulso animado, reservado para posiciones "en vivo" (respeta prefers-reduced-motion). */
  pulse?: boolean;
  /** Contenido del popup que se abre al hacer click en el marcador. */
  children?: ReactNode;
}

export function Marker({ position, pulse, children }: MarkerProps) {
  const map = useMapInstance();
  const markerElRef = useRef<HTMLDivElement | null>(null);
  const popupElRef = useRef<HTMLDivElement | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  if (!markerElRef.current) {
    markerElRef.current = document.createElement('div');
    markerElRef.current.className = 'operador-marker';
  }
  if (!popupElRef.current) {
    popupElRef.current = document.createElement('div');
  }

  useEffect(() => {
    const popup = children
      ? new maplibregl.Popup({ offset: 14, closeButton: true }).setDOMContent(popupElRef.current!)
      : undefined;

    const marker = new maplibregl.Marker({ element: markerElRef.current! })
      .setLngLat([position[1], position[0]])
      .setPopup(popup)
      .addTo(map);

    markerRef.current = marker;
    return () => {
      marker.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    markerRef.current?.setLngLat([position[1], position[0]]);
  }, [position[0], position[1]]);

  return (
    <>
      {createPortal(
        <div className={`operador-marker-dot${pulse ? ' operador-marker-dot--pulse' : ''}`} />,
        markerElRef.current!,
      )}
      {children ? createPortal(<div className="operador-popup">{children}</div>, popupElRef.current!) : null}
    </>
  );
}
