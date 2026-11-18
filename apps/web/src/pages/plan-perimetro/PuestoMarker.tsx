import * as maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import type { PuestoPerimetro } from '@cne/shared-types';
import { useMapInstance } from '../../components/map';

interface PuestoMarkerProps {
  puesto: PuestoPerimetro;
  seleccionado: boolean;
  mostrarNombre: boolean;
  onSeleccionar: (id: string) => void;
}

/** Nombre que se muestra del puesto: la persona, la etiqueta libre o "Sin asignar". */
export function nombrePuesto(p: Pick<PuestoPerimetro, 'persona' | 'etiqueta'>): string {
  return p.persona?.nombre ?? p.etiqueta ?? 'Sin asignar';
}

/**
 * Puesto en el mapa: un botón (se enfoca con Tab y se activa con Enter) con su
 * número y, si se pide, el nombre. El texto va por textContent, nunca como HTML.
 */
export function PuestoMarker({ puesto, seleccionado, mostrarNombre, onSeleccionar }: PuestoMarkerProps) {
  const map = useMapInstance();
  const boton = useRef<HTMLButtonElement | null>(null);
  const alSeleccionar = useRef(onSeleccionar);
  alSeleccionar.current = onSeleccionar;

  if (!boton.current) {
    boton.current = document.createElement('button');
    boton.current.type = 'button';
    boton.current.className = 'pp-puesto';
    boton.current.addEventListener('click', (e) => {
      e.stopPropagation();
      alSeleccionar.current(puesto.id);
    });
  }

  useEffect(() => {
    const marcador = new maplibregl.Marker({ element: boton.current!, anchor: 'center' })
      .setLngLat([puesto.lng, puesto.lat])
      .addTo(map);
    return () => {
      marcador.remove();
    };
  }, [map, puesto.lat, puesto.lng]);

  useEffect(() => {
    const el = boton.current!;
    const nombre = nombrePuesto(puesto);
    el.replaceChildren();
    const numero = document.createElement('span');
    numero.className = 'pp-puesto-numero';
    numero.textContent = String(puesto.orden);
    el.append(numero);
    if (mostrarNombre) {
      const etiqueta = document.createElement('span');
      etiqueta.className = 'pp-puesto-nombre';
      etiqueta.textContent = nombre;
      el.append(etiqueta);
    }
    // Empieza por lo que se ve (el número y el nombre), como pide WCAG 2.5.3.
    el.setAttribute('aria-label', `${puesto.orden} ${nombre}, puesto`);
    el.setAttribute('aria-pressed', String(seleccionado));
    el.classList.toggle('pp-puesto--sin-persona', !puesto.persona);
    el.classList.toggle('pp-puesto--seleccionado', seleccionado);
  }, [puesto, seleccionado, mostrarNombre]);

  return null;
}
