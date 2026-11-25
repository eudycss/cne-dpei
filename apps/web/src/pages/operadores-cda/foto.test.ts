import { describe, expect, it } from 'vitest';
import { cumpleFoto } from './foto';

describe('filtro de foto del personal CDA', () => {
  const conFoto = { tieneFoto: true, fotoPendiente: false };
  const sinFoto = { tieneFoto: false, fotoPendiente: false };
  const pendiente = { tieneFoto: false, fotoPendiente: true };
  const cambiaFoto = { tieneFoto: true, fotoPendiente: true };

  it('sin filtro deja pasar a todos', () => {
    for (const o of [conFoto, sinFoto, pendiente, cambiaFoto]) expect(cumpleFoto(o, '')).toBe(true);
  });

  it('«Sin foto» solo muestra a quien aún no sube ninguna (la pendiente ya cuenta como subida)', () => {
    expect(cumpleFoto(sinFoto, 'SIN')).toBe(true);
    expect(cumpleFoto(pendiente, 'SIN')).toBe(false);
    expect(cumpleFoto(conFoto, 'SIN')).toBe(false);
  });

  it('«Con foto» y «Por revisar» siguen la foto aprobada y la pendiente', () => {
    expect(cumpleFoto(conFoto, 'CON')).toBe(true);
    expect(cumpleFoto(pendiente, 'CON')).toBe(false);
    expect(cumpleFoto(pendiente, 'REVISAR')).toBe(true);
    expect(cumpleFoto(cambiaFoto, 'REVISAR')).toBe(true);
    expect(cumpleFoto(conFoto, 'REVISAR')).toBe(false);
  });
});
