import { cercaniaRetorno } from './cercania-retorno';

describe('cercaniaRetorno', () => {
  it('a más de 10 km del DPEI: lejos', () => {
    expect(cercaniaRetorno(10_001)).toBe('LEJOS');
    expect(cercaniaRetorno(43_000)).toBe('LEJOS');
  });

  it('entre 3 y 10 km (10 km incluido): cerca', () => {
    expect(cercaniaRetorno(10_000)).toBe('CERCA');
    expect(cercaniaRetorno(6_000)).toBe('CERCA');
    expect(cercaniaRetorno(3_001)).toBe('CERCA');
  });

  it('a 3 km o menos: muy cerca', () => {
    expect(cercaniaRetorno(3_000)).toBe('MUY_CERCA');
    expect(cercaniaRetorno(800)).toBe('MUY_CERCA');
    expect(cercaniaRetorno(0)).toBe('MUY_CERCA');
  });

  it('la misma distancia da el mismo color, sin importar el recinto de origen', () => {
    // Antes, 6 km desde Atuntaqui salía "Lejos" y 15 km desde Apuela "Cerca".
    expect(cercaniaRetorno(6_000)).toBe('CERCA');
    expect(cercaniaRetorno(15_000)).toBe('LEJOS');
  });

  it('sin una distancia válida devuelve null', () => {
    expect(cercaniaRetorno(null)).toBeNull();
    expect(cercaniaRetorno(Number.NaN)).toBeNull();
    expect(cercaniaRetorno(Number.POSITIVE_INFINITY)).toBeNull();
    expect(cercaniaRetorno(-5)).toBeNull();
  });
});
