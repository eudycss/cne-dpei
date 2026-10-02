import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';

const instancias: Array<{
  opciones: { style: unknown };
  setStyle: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}> = [];

const urlsWorker: string[] = [];

vi.mock('maplibre-gl', () => {
  class FakeMap {
    opciones: { style: unknown };
    setStyle = vi.fn();
    remove = vi.fn();
    addControl = vi.fn();
    constructor(opciones: { style: unknown }) {
      this.opciones = opciones;
      instancias.push(this);
    }
    on(evento: string, cb: () => void) {
      if (evento === 'load') cb();
    }
  }
  class Control {}
  return {
    setWorkerUrl: (url: string) => urlsWorker.push(url),
    Map: FakeMap,
    NavigationControl: Control,
    GeolocateControl: Control,
    FullscreenControl: Control,
  };
});
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: '/worker-maplibre.js' }));

let temaActual: 'light' | 'dark' = 'light';
vi.mock('../../theme/ThemeContext', () => ({
  useTheme: () => ({ theme: temaActual, toggle: () => {} }),
}));

import { MapView } from './MapView';
import { ESTILO_CLARO, ESTILO_OSCURO } from './estilos';

describe('MapView', () => {
  beforeEach(() => {
    instancias.length = 0;
    temaActual = 'light';
  });

  it('registra el worker empaquetado por Vite (MapLibre v6 no lo encuentra solo)', () => {
    expect(urlsWorker).toEqual(['/worker-maplibre.js']);
  });

  it('crea el mapa con el estilo del tema actual', () => {
    temaActual = 'dark';
    render(<MapView center={[0.35, -78.12]} zoom={11} />);
    expect(instancias).toHaveLength(1);
    expect(instancias[0].opciones.style).toBe(ESTILO_OSCURO);
    // Ya nace con el estilo correcto: no se vuelve a aplicar al terminar de cargar.
    expect(instancias[0].setStyle).not.toHaveBeenCalled();
  });

  it('al cambiar el tema reemplaza el estilo sin recrear el mapa', () => {
    const { rerender } = render(<MapView center={[0.35, -78.12]} zoom={11} />);
    expect(instancias[0].opciones.style).toBe(ESTILO_CLARO);

    temaActual = 'dark';
    act(() => {
      rerender(<MapView center={[0.35, -78.12]} zoom={11} />);
    });

    expect(instancias).toHaveLength(1);
    expect(instancias[0].setStyle).toHaveBeenLastCalledWith(ESTILO_OSCURO);
  });
});
