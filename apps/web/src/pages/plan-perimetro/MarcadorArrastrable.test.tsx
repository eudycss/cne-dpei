import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const { marcadores, mapa } = vi.hoisted(() => ({
  marcadores: [] as Array<{ el: HTMLElement; lngLat: [number, number]; eventos: Record<string, () => void>; quitado: boolean }>,
  mapa: { bearing: 0, enfocado: 0, getBearing() { return this.bearing; }, getCanvas() { return { focus: () => (mapa.enfocado += 1) }; } },
}));
vi.mock('maplibre-gl', () => ({
  Marker: class {
    el: HTMLElement;
    lngLat: [number, number] = [0, 0];
    eventos: Record<string, () => void> = {};
    quitado = false;
    constructor({ element }: { element: HTMLElement }) {
      this.el = element;
      marcadores.push(this);
    }
    setLngLat(ll: [number, number]) {
      this.lngLat = ll;
      return this;
    }
    addTo() {
      return this;
    }
    on(ev: string, cb: () => void) {
      this.eventos[ev] = cb;
      return this;
    }
    getLngLat() {
      return { lng: this.lngLat[0], lat: this.lngLat[1] };
    }
    remove() {
      this.quitado = true;
    }
  },
}));
vi.mock('../../components/map', () => ({ useMapInstance: () => mapa }));

import { MarcadorArrastrable, PASO_TECLADO_M, pasoTeclado } from './MarcadorArrastrable';
import { distancia } from './geometria';

const P: [number, number] = [0.35849, -78.11886];
const tecla = (key: string, shiftKey = false) => new KeyboardEvent('keydown', { key, shiftKey, bubbles: true });

describe('pasoTeclado', () => {
  it('flechas: medio metro, con Shift cinco; otras teclas nada', () => {
    expect(pasoTeclado({ key: 'ArrowUp', shiftKey: false })).toEqual({ dE: 0, dN: PASO_TECLADO_M });
    const izquierda = pasoTeclado({ key: 'ArrowLeft', shiftKey: true })!;
    expect(izquierda.dE).toBeCloseTo(-PASO_TECLADO_M * 10, 10);
    expect(izquierda.dN).toBeCloseTo(0, 10);
    expect(pasoTeclado({ key: 'a', shiftKey: false })).toBeNull();
  });

  it('con el mapa girado, "arriba" es arriba en la pantalla', () => {
    // Mapa girado 90°: la pantalla mira al este.
    const p = pasoTeclado({ key: 'ArrowUp', shiftKey: false }, 90)!;
    expect(p.dE).toBeCloseTo(PASO_TECLADO_M, 10);
    expect(p.dN).toBeCloseTo(0, 10);
  });
});

describe('MarcadorArrastrable', () => {
  it('se mueve con flechas, se quita con Supr y usa otras teclas si se le piden', () => {
    const onMover = vi.fn();
    const onQuitar = vi.fn();
    const onTecla = vi.fn((e: KeyboardEvent) => e.key === 'r');
    render(<MarcadorArrastrable punto={P} etiqueta="Vértice 1" className="pp-manija" onMover={onMover} onQuitar={onQuitar} onTecla={onTecla} />);
    const { el } = marcadores.at(-1)!;
    expect(el.tagName).toBe('BUTTON');
    expect(el.getAttribute('aria-label')).toBe('Vértice 1');

    el.dispatchEvent(tecla('ArrowRight', true));
    expect(distancia(P, onMover.mock.calls[0][0])).toBeCloseTo(PASO_TECLADO_M * 10, 2);
    el.dispatchEvent(tecla('Delete'));
    expect(onQuitar).toHaveBeenCalled();
    // El foco vuelve al mapa: el marcador va a desaparecer.
    expect(mapa.enfocado).toBe(1);
    // Retroceso no borra (se pulsa por reflejo).
    el.dispatchEvent(tecla('Backspace'));
    expect(onQuitar).toHaveBeenCalledTimes(1);
    el.dispatchEvent(tecla('r'));
    expect(onTecla).toHaveBeenCalled();
  });

  it('agrega sus clases sin borrar las que pone MapLibre (las que lo posicionan)', () => {
    const { rerender } = render(<MarcadorArrastrable punto={P} etiqueta="V" className="pp-manija" onMover={() => {}} />);
    const { el } = marcadores.at(-1)!;
    el.classList.add('maplibregl-marker');
    rerender(<MarcadorArrastrable punto={P} etiqueta="V" className="pp-manija pp-manija--valla" onMover={() => {}} />);
    expect([...el.classList].sort()).toEqual(['maplibregl-marker', 'pp-manija', 'pp-manija--valla']);
  });

  it('al soltar informa el punto final y al desmontar quita el marcador', () => {
    const onMover = vi.fn();
    const { unmount } = render(<MarcadorArrastrable punto={P} etiqueta="Valla 1" className="pp-manija" onMover={onMover} />);
    const m = marcadores.at(-1)!;
    expect(m.lngLat).toEqual([P[1], P[0]]);
    m.lngLat = [-78.2, 0.4];
    m.eventos.dragend();
    expect(onMover).toHaveBeenCalledWith([0.4, -78.2]);
    unmount();
    expect(m.quitado).toBe(true);
  });

  it('sin onQuitar, Supr no hace nada (un polígono no baja de 3 esquinas)', () => {
    const onMover = vi.fn();
    render(<MarcadorArrastrable punto={P} etiqueta="V" className="pp-manija" onMover={onMover} />);
    expect(() => marcadores.at(-1)!.el.dispatchEvent(tecla('Delete'))).not.toThrow();
    expect(onMover).not.toHaveBeenCalled();
  });

  it('las teclas que usa no llegan al mapa (no lo desplazan ni lo giran)', () => {
    render(<MarcadorArrastrable punto={P} etiqueta="V" className="pp-manija" onMover={() => {}} />);
    const { el } = marcadores.at(-1)!;
    const padre = document.createElement('div');
    padre.append(el);
    const alMapa = vi.fn();
    padre.addEventListener('keydown', alMapa);
    el.dispatchEvent(tecla('ArrowUp'));
    expect(alMapa).not.toHaveBeenCalled();
    el.dispatchEvent(tecla('x'));
    expect(alMapa).toHaveBeenCalledTimes(1);
  });
});
