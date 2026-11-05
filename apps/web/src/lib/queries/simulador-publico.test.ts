import { describe, expect, it } from 'vitest';
import { espaciado, reloj, trazoDeFila } from './simulador-publico';

describe('ayudas del simulador público', () => {
  it('espaciado: letras separadas y palabras más separadas', () => {
    expect(espaciado('Sesenta y dos')).toBe('S e s e n t a   y   d o s');
    expect(espaciado('Cero')).toBe('C e r o');
  });

  it('trazoDeFila: estable para la misma fila y dentro de los rangos', () => {
    expect(trazoDeFila('acta-1', 3)).toEqual(trazoDeFila('acta-1', 3));
    for (let i = 0; i < 50; i++) {
      const t = trazoDeFila('acta-x', i);
      expect(t.giro).toBeGreaterThanOrEqual(-1.5);
      expect(t.giro).toBeLessThanOrEqual(1.5);
      expect(t.sangria).toBeGreaterThanOrEqual(0);
      expect(t.sangria).toBeLessThanOrEqual(24);
      expect(t.escala).toBeGreaterThanOrEqual(0.92);
      expect(t.escala).toBeLessThanOrEqual(1.08);
    }
  });

  it('reloj', () => {
    expect(reloj(0)).toBe('00:00');
    expect(reloj(-5000)).toBe('00:00');
    expect(reloj(61_000)).toBe('01:01');
    expect(reloj(59_001)).toBe('01:00');
    expect(reloj(3_600_000 + 5_000)).toBe('1:00:05');
  });
});
