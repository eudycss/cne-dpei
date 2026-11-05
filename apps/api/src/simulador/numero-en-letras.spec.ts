import { enCasilleros, numeroEnLetras } from './numero-en-letras';

describe('numeroEnLetras', () => {
  it.each([
    [0, 'Cero'],
    [1, 'Uno'],
    [9, 'Nueve'],
    [10, 'Diez'],
    [15, 'Quince'],
    [16, 'Dieciséis'],
    [20, 'Veinte'],
    [21, 'Veintiuno'],
    [22, 'Veintidós'],
    [29, 'Veintinueve'],
    [30, 'Treinta'],
    [34, 'Treinta y cuatro'],
    [50, 'Cincuenta'],
    [62, 'Sesenta y dos'],
    [71, 'Setenta y uno'],
    [99, 'Noventa y nueve'],
    [100, 'Cien'],
    [101, 'Ciento uno'],
    [115, 'Ciento quince'],
    [200, 'Doscientos'],
    [342, 'Trescientos cuarenta y dos'],
    [500, 'Quinientos'],
    [777, 'Setecientos setenta y siete'],
    [999, 'Novecientos noventa y nueve'],
  ])('%i → %s', (n, texto) => {
    expect(numeroEnLetras(n)).toBe(texto);
  });

  it('cubre todo 0..999 sin repetir un texto', () => {
    const textos = new Set(Array.from({ length: 1000 }, (_, i) => numeroEnLetras(i)));
    expect(textos.size).toBe(1000);
  });

  it.each([-1, 1000, 1.5, NaN])('rechaza %p', (n) => {
    expect(() => numeroEnLetras(n)).toThrow(RangeError);
  });

  it('casilleros con ceros a la izquierda', () => {
    expect(enCasilleros(0)).toBe('000');
    expect(enCasilleros(62)).toBe('062');
    expect(enCasilleros(342)).toBe('342');
  });
});
