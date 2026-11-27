import { describe, expect, it } from 'vitest';

import { MAX_ASIGNAR_KITS, asignarKitsParejasCdaSchema } from './index';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('asignarKitsParejasCdaSchema (asignar kit en lote)', () => {
  it('acepta las parejas elegidas, con o sin justificación', () => {
    expect(asignarKitsParejasCdaSchema.safeParse({ ids: [id(1), id(2)] }).success).toBe(true);
    expect(asignarKitsParejasCdaSchema.safeParse({ ids: [id(1)], justificacion: 'Faltaban kits' }).success).toBe(true);
  });

  it.each([
    ['sin parejas', { ids: [] }],
    ['un id que no es UUID', { ids: ['abc'] }],
    ['parejas repetidas', { ids: [id(1), id(1)] }],
    [`más de ${MAX_ASIGNAR_KITS}`, { ids: Array.from({ length: MAX_ASIGNAR_KITS + 1 }, (_, i) => id(i)) }],
    ['campos de más', { ids: [id(1)], otro: true }],
  ])('rechaza %s', (_caso, body) => {
    expect(asignarKitsParejasCdaSchema.safeParse(body).success).toBe(false);
  });
});
