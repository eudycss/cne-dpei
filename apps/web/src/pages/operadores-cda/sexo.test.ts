import { describe, expect, it } from 'vitest';
import { contarSexo, cumpleSexo, textoSexo } from './sexo';

describe('sexo del personal CDA', () => {
  it('filtra por hombres, mujeres, sin registrar o todos', () => {
    expect(cumpleSexo({ sexo: 'M' }, '')).toBe(true);
    expect(cumpleSexo({ sexo: 'M' }, 'M')).toBe(true);
    expect(cumpleSexo({ sexo: 'F' }, 'M')).toBe(false);
    expect(cumpleSexo({ sexo: null }, 'SIN')).toBe(true);
    expect(cumpleSexo({ sexo: 'F' }, 'SIN')).toBe(false);
  });

  it('cuenta solo activos y arma el texto en singular o plural', () => {
    const c = contarSexo([
      { sexo: 'M', activo: true },
      { sexo: 'F', activo: true },
      { sexo: 'F', activo: true },
      { sexo: null, activo: true },
      { sexo: 'M', activo: false },
    ]);
    expect(c).toEqual({ hombres: 1, mujeres: 2, sinRegistrar: 1 });
    expect(textoSexo(c)).toBe('1 hombre · 2 mujeres · 1 sin sexo registrado');
    expect(textoSexo({ hombres: 27, mujeres: 36, sinRegistrar: 0 })).toBe('27 hombres · 36 mujeres');
  });
});
