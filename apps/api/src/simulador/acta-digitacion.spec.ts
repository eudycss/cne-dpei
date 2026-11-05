import { comoGuardado, digitoCambiado, filasIncorrectas, generarActa, type Azar } from './acta-digitacion';

/** Azar determinista: devuelve los valores en orden, limitados a [min, max]. */
const secuencia = (...vals: number[]): Azar => {
  let i = 0;
  return (min, max) => Math.min(max, Math.max(min, vals[i++ % vals.length]));
};

describe('generarActa', () => {
  it('sin % de dígitos distintos, los casilleros dicen lo mismo que las letras', () => {
    const acta = generarActa({ filasPorActa: 3, votoMin: 0, votoMax: 350, pctDigitosDistintos: 0 }, secuencia(62, 0, 34));
    expect(acta).toEqual({ valores: [62, 0, 34], digitos: [62, 0, 34] });
  });

  it('con 100 %, todas las filas muestran un número distinto al correcto', () => {
    const acta = generarActa({ filasPorActa: 50, votoMin: 0, votoMax: 999, pctDigitosDistintos: 100 });
    acta.valores.forEach((v, i) => {
      expect(acta.digitos[i]).not.toBe(v);
      expect(acta.digitos[i]).toBeGreaterThanOrEqual(0);
      expect(acta.digitos[i]).toBeLessThanOrEqual(999);
    });
  });

  it('respeta el rango de votos y la cantidad de filas', () => {
    const acta = generarActa({ filasPorActa: 40, votoMin: 10, votoMax: 20, pctDigitosDistintos: 30 });
    expect(acta.valores).toHaveLength(40);
    expect(acta.digitos).toHaveLength(40);
    for (const v of acta.valores) {
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(20);
    }
  });

  it('rango de un solo valor', () => {
    const acta = generarActa({ filasPorActa: 2, votoMin: 7, votoMax: 7, pctDigitosDistintos: 0 });
    expect(acta.valores).toEqual([7, 7]);
  });
});

describe('digitoCambiado', () => {
  it('cambia exactamente un casillero, para cualquier posición y salto', () => {
    for (let n = 0; n < 1000; n += 37) {
      for (let pos = 0; pos <= 2; pos++) {
        for (let salto = 1; salto <= 9; salto++) {
          const otro = digitoCambiado(n, secuencia(pos, salto));
          const a = String(n).padStart(3, '0');
          const b = String(otro).padStart(3, '0');
          expect([...a].filter((c, i) => c !== b[i])).toHaveLength(1);
        }
      }
    }
  });
});

describe('filasIncorrectas', () => {
  it('marca las distintas y las vacías', () => {
    expect(filasIncorrectas([62, 0, 50], [62, null, 51])).toEqual([1, 2]);
    expect(filasIncorrectas([62, 0], [62, 0])).toEqual([]);
  });

  it('una fila que falta en lo digitado cuenta como incorrecta', () => {
    expect(filasIncorrectas([1, 2, 3], [1, 2])).toEqual([2]);
  });

  it('comoGuardado: vacías y faltantes como -1, sobrantes fuera', () => {
    expect(comoGuardado(3, [5, null])).toEqual([5, -1, -1]);
    expect(comoGuardado(1, [5, 6])).toEqual([5]);
  });
});
