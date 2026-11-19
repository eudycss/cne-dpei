import * as maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import type { PuestoPerimetro } from '@cne/shared-types';
import { useMapInstance } from '../../components/map';
import { moverConTecla } from './MarcadorArrastrable';

type Punto = [number, number];

interface PuestoMarkerProps {
  puesto: PuestoPerimetro;
  seleccionado: boolean;
  mostrarNombre: boolean;
  onSeleccionar: (id: string) => void;
  /** En edición: se arrastra, se mueve con las flechas y se quita con Supr. */
  editable?: boolean;
  onMover?: (id: string, p: Punto) => void;
  onQuitar?: (id: string) => void;
}

/** Nombre que se muestra del puesto: la persona, la etiqueta libre o "Sin asignar". */
export function nombrePuesto(p: Pick<PuestoPerimetro, 'persona' | 'etiqueta'>): string {
  return p.persona?.nombre ?? p.etiqueta ?? 'Sin asignar';
}

/**
 * Puesto en el mapa: un botón (se enfoca con Tab y se activa con Enter) con su
 * número y, si se pide, el nombre. El texto va por textContent, nunca como HTML.
 */
export function PuestoMarker({ puesto, seleccionado, mostrarNombre, onSeleccionar, editable = false, onMover, onQuitar }: PuestoMarkerProps) {
  const map = useMapInstance();
  const props = useRef({ puesto, onSeleccionar, editable, onMover, onQuitar });
  props.current = { puesto, onSeleccionar, editable, onMover, onQuitar };
  const boton = useRef<HTMLButtonElement | null>(null);
  const marcador = useRef<maplibregl.Marker | null>(null);
  const recienArrastrado = useRef(false);

  if (!boton.current) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pp-puesto';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      // Soltar después de arrastrar también dispara click: no cuenta como elegir.
      if (recienArrastrado.current) {
        recienArrastrado.current = false;
        return;
      }
      props.current.onSeleccionar(props.current.puesto.id);
    });
    b.addEventListener('keydown', (e) => {
      const { puesto: p, editable: ed, onMover: mover, onQuitar: quitar } = props.current;
      if (!ed) return;
      const nuevo = moverConTecla(e, [p.lat, p.lng], map.getBearing());
      if (nuevo && mover) mover(p.id, nuevo);
      else if (e.key === 'Delete' && quitar) {
        map.getCanvas().focus();
        quitar(p.id);
      } else return;
      e.preventDefault();
      e.stopPropagation();
    });
    boton.current = b;
  }

  useEffect(() => {
    const m = new maplibregl.Marker({ element: boton.current!, anchor: 'center' })
      .setLngLat([props.current.puesto.lng, props.current.puesto.lat])
      .addTo(map);
    m.on('dragend', () => {
      recienArrastrado.current = true;
      // En táctil no llega el click después del arrastre: no descartar el próximo toque.
      setTimeout(() => (recienArrastrado.current = false), 0);
      const ll = m.getLngLat();
      props.current.onMover?.(props.current.puesto.id, [ll.lat, ll.lng]);
    });
    marcador.current = m;
    return () => {
      m.remove();
    };
  }, [map]);

  useEffect(() => {
    marcador.current?.setLngLat([puesto.lng, puesto.lat]);
  }, [puesto.lat, puesto.lng]);

  useEffect(() => {
    marcador.current?.setDraggable(editable);
  }, [editable]);

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
    el.setAttribute('aria-label', `${puesto.orden} ${nombre}, puesto${editable ? ' (flechas para mover, Supr para quitar)' : ''}`);
    el.setAttribute('aria-pressed', String(seleccionado));
    el.classList.toggle('pp-puesto--sin-persona', !puesto.persona);
    el.classList.toggle('pp-puesto--seleccionado', seleccionado);
    el.classList.toggle('pp-puesto--editable', editable);
  }, [puesto, seleccionado, mostrarNombre, editable]);

  return null;
}
