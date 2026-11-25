import { describe, expect, it } from 'vitest';
import { porcentajeAvance, resumenLlegadaNoCda } from './llegada-no-cda';

const nc = (cantonNombre: string, juntas: number, llegado: boolean) => ({ cantonNombre, juntas, llegado });

describe('resumenLlegadaNoCda', () => {
  it('suma recintos y juntas llegados, en total y por cantón (ordenado)', () => {
    const r = resumenLlegadaNoCda([
      { noCdas: [nc('URCUQUI', 8, true), nc('IBARRA', 2, false)] },
      { noCdas: [nc('IBARRA', 13, true)] },
    ]);

    expect(r.recintos).toEqual({ hechos: 2, total: 3 });
    expect(r.juntas).toEqual({ hechos: 21, total: 23 });
    expect(r.porCanton).toEqual([
      { canton: 'IBARRA', recintos: { hechos: 1, total: 2 }, juntas: { hechos: 13, total: 15 } },
      { canton: 'URCUQUI', recintos: { hechos: 1, total: 1 }, juntas: { hechos: 8, total: 8 } },
    ]);
  });

  it('cuenta CDA completos y sin ninguna llegada; los CDA sin NO CDA no cuentan', () => {
    const r = resumenLlegadaNoCda([
      { noCdas: [nc('IBARRA', 1, true)] },
      { noCdas: [nc('IBARRA', 1, false), nc('IBARRA', 1, false)] },
      { noCdas: [nc('IBARRA', 1, true), nc('IBARRA', 1, false)] },
      { noCdas: [] },
    ]);

    expect(r.cdas).toEqual({ completos: 1, sinLlegadas: 1, total: 3 });
  });

  it('sin datos: todo en cero', () => {
    expect(resumenLlegadaNoCda([])).toEqual({
      recintos: { hechos: 0, total: 0 },
      juntas: { hechos: 0, total: 0 },
      cdas: { completos: 0, sinLlegadas: 0, total: 0 },
      porCanton: [],
    });
  });
});

describe('porcentajeAvance', () => {
  it.each([
    [{ hechos: 312, total: 483 }, 65],
    [{ hechos: 0, total: 0 }, 0],
    [{ hechos: 5, total: 5 }, 100],
  ])('%o → %i %', (avance, esperado) => {
    expect(porcentajeAvance(avance)).toBe(esperado);
  });
});
