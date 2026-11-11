import { cercaniaRetorno } from './cercania-retorno';

describe('cercaniaRetorno', () => {
  it('le falta más de la mitad del camino: lejos', () => {
    expect(cercaniaRetorno(30_000, 40_000)).toBe('LEJOS');
  });

  it('se alejó del DPEI (más lejos que su recinto): lejos', () => {
    expect(cercaniaRetorno(45_000, 40_000)).toBe('LEJOS');
  });

  it('justo en la mitad o entre 50 % y 15 %: cerca', () => {
    expect(cercaniaRetorno(20_000, 40_000)).toBe('CERCA');
    expect(cercaniaRetorno(10_000, 40_000)).toBe('CERCA');
  });

  it('le falta 15 % o menos: muy cerca', () => {
    expect(cercaniaRetorno(6_000, 40_000)).toBe('MUY_CERCA');
  });

  it('a 2 km o menos del DPEI siempre es muy cerca, aunque el recinto esté al lado', () => {
    expect(cercaniaRetorno(1_800, 2_500)).toBe('MUY_CERCA');
    expect(cercaniaRetorno(2_000, null)).toBe('MUY_CERCA');
  });

  it('recinto a menos de 2 km: lejos de él cuenta por el umbral fijo', () => {
    expect(cercaniaRetorno(3_000, 1_500)).toBe('LEJOS');
  });

  it('sin datos para medir devuelve null', () => {
    expect(cercaniaRetorno(null, 40_000)).toBeNull();
    expect(cercaniaRetorno(10_000, null)).toBeNull();
    expect(cercaniaRetorno(10_000, 0)).toBeNull();
    expect(cercaniaRetorno(Number.NaN, 40_000)).toBeNull();
  });
});
