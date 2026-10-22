import { describe, it, expect } from 'vitest';
import { PASOS_PREPARACION } from './flujo';

describe('PASOS_PREPARACION', () => {
  it('sigue el orden de trabajo de la preparación del evento', () => {
    expect(PASOS_PREPARACION.map((p) => p.id)).toEqual([
      'recintos',
      'usuarios',
      'militares',
      'evento',
      'asignaciones',
      'kits',
    ]);
  });

  it('cada requisito aparece antes que el paso que lo necesita', () => {
    const posicion = new Map(PASOS_PREPARACION.map((p, i) => [p.id, i]));
    for (const [i, paso] of PASOS_PREPARACION.entries()) {
      for (const req of paso.requisitos) {
        expect(posicion.has(req)).toBe(true);
        expect(posicion.get(req)).toBeLessThan(i);
      }
    }
  });

  it('no repite ids ni rutas (el botón "Siguiente" depende de ello)', () => {
    const ids = PASOS_PREPARACION.map((p) => p.id);
    const rutas = PASOS_PREPARACION.map((p) => p.ruta);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(rutas).size).toBe(rutas.length);
  });
});
