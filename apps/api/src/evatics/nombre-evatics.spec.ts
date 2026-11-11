import { nombreCoincide, nombreCorto, nombreCortoDeApellidosNombres, palabrasNombre } from './nombre-evatics';

describe('nombre del certificado Evatics', () => {
  const ANA = 'PÉREZ LÓPEZ ANA MARÍA';

  it.each([
    ['el mismo nombre, sin tildes ni mayúsculas', 'perez lopez ana maria'],
    ['nombres antes de los apellidos', 'Ana María Pérez López'],
    ['solo un nombre y un apellido', 'Ana Pérez'],
    ['con título y conector', 'Ing. Ana María de Pérez López'],
    ['una letra mal leída en una palabra larga', 'Ana María Peres López'],
  ])('coincide: %s', (_caso, leido) => {
    expect(nombreCoincide(leido, ANA)).toBe(true);
  });

  it.each([
    ['otra persona con un apellido igual', 'Luis Pérez Tapia'],
    ['una sola palabra', 'Ana'],
    ['vacío', ''],
    ['nada leído', null],
    ['otra persona', 'Juan Carlos Vega Mora'],
  ])('no coincide: %s', (_caso, leido) => {
    expect(nombreCoincide(leido, ANA)).toBe(false);
  });

  it('no se cuenta dos veces la misma palabra', () => {
    expect(nombreCoincide('Ana Ana', 'PÉREZ LÓPEZ ANA MARÍA')).toBe(false);
  });

  it('quita símbolos y palabras que no identifican', () => {
    expect(palabrasNombre('Sr. José-Luis <b>Ñ</b> Y')).toEqual(['JOSE', 'LUIS']);
  });

  it('nombre corto para la página pública', () => {
    expect(nombreCortoDeApellidosNombres(ANA)).toBe('Ana P.');
    expect(nombreCortoDeApellidosNombres('VEGA TAPIA LUIS')).toBe('Luis V.');
    expect(nombreCortoDeApellidosNombres('VEGA LUIS')).toBe('Luis V.');
    expect(nombreCorto('carlos andrés', 'Pozo Ruiz')).toBe('Carlos P.');
  });
});
