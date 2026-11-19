import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { PuestoPerimetro } from '@cne/shared-types';

const { marcadores } = vi.hoisted(() => ({
  marcadores: [] as Array<{
    el: HTMLElement;
    lngLat: [number, number];
    arrastrable: boolean;
    eventos: Record<string, () => void>;
    getLngLat: () => { lng: number; lat: number };
  }>,
}));
vi.mock('maplibre-gl', () => ({
  Marker: class {
    el: HTMLElement;
    lngLat: [number, number] = [0, 0];
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
    arrastrable = false;
    eventos: Record<string, () => void> = {};
    remove() {}
    on(ev: string, cb: () => void) {
      this.eventos[ev] = cb;
      return this;
    }
    setDraggable(v: boolean) {
      this.arrastrable = v;
      return this;
    }
    getLngLat() {
      return { lng: this.lngLat[0], lat: this.lngLat[1] };
    }
  },
}));
vi.mock('../../components/map', () => ({ useMapInstance: () => ({ getBearing: () => 0, getCanvas: () => ({ focus() {} }) }) }));

import { PuestoMarker, nombrePuesto } from './PuestoMarker';

const PUESTO: PuestoPerimetro = {
  id: 'p1',
  orden: 3,
  lat: 0.35,
  lng: -78.11,
  etiqueta: null,
  persona: { id: 'o1', nombre: '<b>PÉREZ</b> JUAN', tieneFoto: false },
};

describe('PuestoMarker', () => {
  it('nombrePuesto: persona, etiqueta libre o "Sin asignar"', () => {
    expect(nombrePuesto(PUESTO)).toBe('<b>PÉREZ</b> JUAN');
    expect(nombrePuesto({ persona: null, etiqueta: 'Policía 1' })).toBe('Policía 1');
    expect(nombrePuesto({ persona: null, etiqueta: null })).toBe('Sin asignar');
  });

  it('es un botón accesible en [lng, lat] y el nombre va como texto, no como HTML', () => {
    const onSeleccionar = vi.fn();
    render(<PuestoMarker puesto={PUESTO} seleccionado={false} mostrarNombre onSeleccionar={onSeleccionar} />);
    const { el, lngLat } = marcadores.at(-1)!;
    expect(lngLat).toEqual([-78.11, 0.35]);
    expect(el.tagName).toBe('BUTTON');
    expect(el.getAttribute('aria-label')).toBe('3 <b>PÉREZ</b> JUAN, puesto');
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toBe('3<b>PÉREZ</b> JUAN');
    el.click();
    expect(onSeleccionar).toHaveBeenCalledWith('p1');
  });

  it('sin mostrar nombres solo lleva el número; marca selección y puesto vacío', () => {
    render(<PuestoMarker puesto={{ ...PUESTO, persona: null }} seleccionado mostrarNombre={false} onSeleccionar={() => {}} />);
    const { el } = marcadores.at(-1)!;
    expect(el.textContent).toBe('3');
    expect(el.getAttribute('aria-pressed')).toBe('true');
    expect(el.classList.contains('pp-puesto--sin-persona')).toBe(true);
  });

  it('en edición se arrastra, se mueve con las flechas y se quita con Supr', () => {
    const onMover = vi.fn();
    const onQuitar = vi.fn();
    const onSeleccionar = vi.fn();
    render(<PuestoMarker puesto={PUESTO} seleccionado={false} mostrarNombre editable onSeleccionar={onSeleccionar} onMover={onMover} onQuitar={onQuitar} />);
    const m = marcadores.at(-1)!;
    expect(m.arrastrable).toBe(true);
    expect(m.el.getAttribute('aria-label')).toContain('flechas para mover');

    m.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    const [id, [lat, lng]] = onMover.mock.calls[0];
    expect(id).toBe('p1');
    expect(lat).toBeGreaterThan(PUESTO.lat);
    expect(lng).toBeCloseTo(PUESTO.lng, 10);
    m.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(onQuitar).toHaveBeenCalledWith('p1');

    // Soltar tras arrastrar mueve el puesto y el click que sigue no lo "elige".
    m.lngLat = [-78.2, 0.4];
    m.eventos.dragend();
    expect(onMover).toHaveBeenLastCalledWith('p1', [0.4, -78.2]);
    m.el.click();
    expect(onSeleccionar).not.toHaveBeenCalled();
  });

  it('fuera de edición las flechas no mueven nada', () => {
    const onMover = vi.fn();
    render(<PuestoMarker puesto={PUESTO} seleccionado={false} mostrarNombre onSeleccionar={() => {}} onMover={onMover} />);
    const m = marcadores.at(-1)!;
    expect(m.arrastrable).toBe(false);
    m.el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(onMover).not.toHaveBeenCalled();
  });
});
