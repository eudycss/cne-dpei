import { distanciaMetros } from './geo';

const quito = { latitud: -0.1807, longitud: -78.4678 };

describe('distanciaMetros', () => {
  it('es 0 para el mismo punto', () => {
    expect(distanciaMetros(quito, quito)).toBeLessThan(0.01);
  });

  it('es simétrica', () => {
    const otro = { latitud: quito.latitud + 0.01, longitud: quito.longitud + 0.01 };
    expect(distanciaMetros(quito, otro)).toBeCloseTo(distanciaMetros(otro, quito), 6);
  });

  it('~111m por cada 0.001° de latitud en el ecuador', () => {
    const cercaDe1km = { latitud: quito.latitud + 0.009, longitud: quito.longitud };
    const d = distanciaMetros(quito, cercaDe1km);
    expect(d).toBeGreaterThan(950);
    expect(d).toBeLessThan(1050);
  });
});
