import * as maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useMapInstance } from '../../components/map';
import { desplazar } from './geometria';

type Punto = [number, number];

/** Metros que mueve una flecha (con Shift, 10 veces más). */
export const PASO_TECLADO_M = 0.5;

/**
 * Flechas → desplazamiento en metros (este, norte) relativo a la pantalla: con
 * el mapa girado, "arriba" sigue siendo arriba en lo que el usuario ve.
 */
export function pasoTeclado(e: Pick<KeyboardEvent, 'key' | 'shiftKey'>, giroMapa = 0): { dE: number; dN: number } | null {
  const paso = e.shiftKey ? PASO_TECLADO_M * 10 : PASO_TECLADO_M;
  const dir: Record<string, [number, number]> = {
    ArrowUp: [0, 1],
    ArrowDown: [0, -1],
    ArrowRight: [1, 0],
    ArrowLeft: [-1, 0],
  };
  const d = dir[e.key];
  if (!d) return null;
  const g = (giroMapa * Math.PI) / 180;
  // Girar el vector de pantalla al norte geográfico.
  const dE = d[0] * Math.cos(g) + d[1] * Math.sin(g);
  const dN = -d[0] * Math.sin(g) + d[1] * Math.cos(g);
  return { dE: dE * paso, dN: dN * paso };
}

/** Mueve `punto` según la tecla, o null si la tecla no es una flecha. */
export function moverConTecla(e: Pick<KeyboardEvent, 'key' | 'shiftKey'>, punto: Punto, giroMapa = 0): Punto | null {
  const paso = pasoTeclado(e, giroMapa);
  return paso ? desplazar(punto, paso.dE, paso.dN) : null;
}

interface MarcadorArrastrableProps {
  punto: Punto;
  /** Nombre accesible (lo lee el lector de pantalla). */
  etiqueta: string;
  className: string;
  /** Durante el arrastre (para ver la figura moverse). */
  onArrastrar?: (p: Punto) => void;
  /** Al soltar o al mover con las flechas. */
  onMover: (p: Punto) => void;
  /** Supr (no Retroceso: se pulsa por reflejo). */
  onQuitar?: () => void;
  /** Otras teclas (p. ej. R para girar una valla); devuelve true si la usó. */
  onTecla?: (e: KeyboardEvent) => boolean;
}

/**
 * Punto editable del plan (vértice o valla): se arrastra con el mouse o el dedo,
 * y con el teclado se enfoca (Tab), se mueve con las flechas y se quita con Supr.
 */
export function MarcadorArrastrable({ punto, etiqueta, className, onArrastrar, onMover, onQuitar, onTecla }: MarcadorArrastrableProps) {
  const map = useMapInstance();
  const props = useRef({ punto, onArrastrar, onMover, onQuitar, onTecla });
  props.current = { punto, onArrastrar, onMover, onQuitar, onTecla };
  const boton = useRef<HTMLButtonElement | null>(null);
  const marcador = useRef<maplibregl.Marker | null>(null);

  if (!boton.current) {
    const b = document.createElement('button');
    b.type = 'button';
    b.addEventListener('keydown', (e) => {
      const { punto: p, onMover: mover, onQuitar: quitar, onTecla: tecla } = props.current;
      const nuevo = moverConTecla(e, p, map.getBearing());
      let usada = true;
      if (nuevo) mover(nuevo);
      else if (e.key === 'Delete' && quitar) {
        // El marcador desaparece: el foco vuelve al mapa en vez de perderse.
        map.getCanvas().focus();
        quitar();
      } else usada = !!tecla?.(e);
      if (usada) {
        e.preventDefault();
        // Que el mapa no se desplace ni gire con la misma tecla.
        e.stopPropagation();
      }
    });
    // Un clic sobre el punto no debe llegar al mapa (agregaría un vértice).
    b.addEventListener('click', (e) => e.stopPropagation());
    boton.current = b;
  }

  useEffect(() => {
    const m = new maplibregl.Marker({ element: boton.current!, draggable: true, anchor: 'center' })
      .setLngLat([props.current.punto[1], props.current.punto[0]])
      .addTo(map);
    let cuadro = 0;
    const leer = (): Punto => {
      const ll = m.getLngLat();
      return [ll.lat, ll.lng];
    };
    m.on('drag', () => {
      if (!props.current.onArrastrar || cuadro) return;
      // Como mucho una actualización por cuadro de pantalla.
      cuadro = requestAnimationFrame(() => {
        cuadro = 0;
        props.current.onArrastrar?.(leer());
      });
    });
    m.on('dragend', () => {
      cancelAnimationFrame(cuadro);
      cuadro = 0;
      props.current.onMover(leer());
    });
    marcador.current = m;
    return () => {
      cancelAnimationFrame(cuadro);
      m.remove();
    };
  }, [map]);

  useEffect(() => {
    marcador.current?.setLngLat([punto[1], punto[0]]);
  }, [punto[0], punto[1]]);

  useEffect(() => {
    // Solo las clases propias: MapLibre pone las suyas (maplibregl-marker, que lo posiciona) en el mismo elemento.
    const propias = className.split(/\s+/).filter(Boolean);
    boton.current!.classList.add(...propias);
    return () => boton.current?.classList.remove(...propias);
  }, [className]);

  useEffect(() => {
    boton.current!.setAttribute('aria-label', etiqueta);
    boton.current!.title = etiqueta;
  }, [etiqueta]);

  return null;
}
