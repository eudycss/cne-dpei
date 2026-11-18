import { describe, expect, it } from 'vitest';
import { capasDelPlan, desplazar, extremosValla, puntosDelPlan } from './geometria';

const ANILLO: [number, number][] = [
  [0.35, -78.11],
  [0.351, -78.11],
  [0.351, -78.111],
];
const AJUSTES = { pctMujeres: 50, largoValla: 2, mostrarNombres: true, alinearVallas: true };

/** Distancia aproximada en metros (equirectangular: basta para tramos cortos). */
function metros(a: [number, number], b: [number, number]) {
  const R = 6371008.8;
  const x = ((b[1] - a[1]) * Math.PI) / 180 * Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180);
  const y = ((b[0] - a[0]) * Math.PI) / 180;
  return Math.hypot(x, y) * R;
}

describe('geometría del plan', () => {
  it('desplazar mueve los metros pedidos al norte y al este', () => {
    const o: [number, number] = [0.35, -78.11];
    expect(metros(o, desplazar(o, 0, 100))).toBeCloseTo(100, 1);
    expect(metros(o, desplazar(o, 50, 0))).toBeCloseTo(50, 1);
    expect(desplazar(o, 0, 100)[1]).toBeCloseTo(o[1], 10);
  });

  it('una valla mide su largo y queda centrada; 0° va de sur a norte', () => {
    const v = { lat: 0.35, lng: -78.11, angulo: 0 };
    const [a, b] = extremosValla(v, 2.5);
    expect(metros(a, b)).toBeCloseTo(2.5, 3);
    expect(a[1]).toBeCloseTo(v.lng, 10);
    expect(b[0]).toBeGreaterThan(a[0]);
    expect((a[0] + b[0]) / 2).toBeCloseTo(v.lat, 10);
  });

  it('a 90° la valla va de oeste a este', () => {
    const [a, b] = extremosValla({ lat: 0.35, lng: -78.11, angulo: 90 }, 4);
    expect(a[0]).toBeCloseTo(b[0], 10);
    expect(b[1]).toBeGreaterThan(a[1]);
  });

  it('arma GeoJSON en [lng, lat] con anillos cerrados y el color de cada zona', () => {
    const capas = capasDelPlan({
      perimetro: ANILLO,
      zonas: [{ id: 'z', tipo: 'peligro', nombre: 'Tarima', coords: ANILLO }],
      vallas: [{ id: 'v', lat: 0.35, lng: -78.11, angulo: 0 }],
      ajustes: AJUSTES,
    });
    const anillo = (capas.perimetro.features[0].geometry as GeoJSON.Polygon).coordinates[0];
    expect(anillo[0]).toEqual([-78.11, 0.35]);
    expect(anillo).toHaveLength(4);
    expect(anillo[3]).toEqual(anillo[0]);
    expect(capas.zonas.features[0].properties).toEqual({ nombre: 'Tarima', color: '#ef4444' });
    expect((capas.vallas.features[0].geometry as GeoJSON.LineString).coordinates).toHaveLength(2);
  });

  it('un plan sin perímetro ni dibujo da colecciones vacías', () => {
    const capas = capasDelPlan({ perimetro: null, zonas: [], vallas: [], ajustes: AJUSTES });
    expect([capas.perimetro, capas.zonas, capas.vallas].map((c) => c.features.length)).toEqual([0, 0, 0]);
  });

  it('puntosDelPlan junta perímetro, zonas, vallas y puestos', () => {
    const puntos = puntosDelPlan({
      perimetro: ANILLO,
      zonas: [{ id: 'z', tipo: 'segura', nombre: 'Z', coords: ANILLO }],
      vallas: [{ id: 'v', lat: 1, lng: 2, angulo: 0 }],
      puestos: [{ id: 'p', orden: 1, lat: 3, lng: 4, etiqueta: null, persona: null }],
    });
    expect(puntos).toHaveLength(8);
    expect(puntos.slice(-2)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});
