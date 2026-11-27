import { describe, expect, it } from 'vitest';

import { FOTO_INFORME_PEQUENA, fotoInformeTieneTamano } from './index';

describe('fotoInformeTieneTamano', () => {
  it.each([
    [800, 600],
    [600, 800],
    [1600, 1200],
  ])('%i × %i alcanza la medida mínima en cualquier orientación', (ancho, alto) => {
    expect(fotoInformeTieneTamano(ancho, alto)).toBe(true);
  });

  it.each([
    [799, 600],
    [800, 599],
    [1600, 400],
    [500, 500],
  ])('%i × %i es muy pequeña', (ancho, alto) => {
    expect(fotoInformeTieneTamano(ancho, alto)).toBe(false);
  });

  it('el mensaje dice la medida mínima', () => {
    expect(FOTO_INFORME_PEQUENA).toContain('800 × 600');
  });
});
