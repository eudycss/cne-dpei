import { nombreCoincide, nombreCorto, nombreCortoDeApellidosNombres, palabrasNombre } from './nombre-evatics';

describe('nombre del certificado Evatics', () => {
  const ANA = 'PÉREZ LÓPEZ ANA MARÍA';

  it.each([
    ['el mismo nombre, sin tildes ni mayúsculas', 'perez lopez ana maria'],
    ['nombres antes de los apellidos (como en el certificado)', 'Ana María Pérez López'],
    ['con título y conector', 'Ing. Ana María de Pérez López'],
  ])('coincide: %s', (_caso, leido) => {
    expect(nombreCoincide(leido, ANA)).toBe(true);
  });

  it.each([
    ['falta un nombre', 'Ana Pérez López'],
    ['falta un apellido', 'Ana María Pérez'],
    ['solo un nombre y un apellido', 'Ana Pérez'],
    ['una palabra de más', 'Ana María Pérez López Vega'],
    ['otra persona con un apellido igual', 'Luis Pérez Tapia'],
    ['una sola palabra', 'Ana'],
    ['vacío', ''],
    ['nada leído', null],
    ['otra persona', 'Juan Carlos Vega Mora'],
    ['dos nombres de pila sin apellido', 'Ana María'],
    ['un apellido corto con una letra cambiada', 'Ana María Peres López'],
  ])('no coincide: %s', (_caso, leido) => {
    expect(nombreCoincide(leido, ANA)).toBe(false);
  });

  it('el certificado de la imagen de ejemplo coincide con el personal (apellidos primero)', () => {
    expect(nombreCoincide('EDWIN SEBASTIAN CABASCANGO SALAZAR', 'CABASCANGO SALAZAR EDWIN SEBASTIAN')).toBe(true);
    expect(nombreCoincide('EDWIN SEBASTIAN CABASCANGO SALAZAR', 'CABASCANGO SALAZAR EDWIN DAVID')).toBe(false);
  });

  it('una letra mal leída solo se tolera en palabras de 7 letras o más', () => {
    expect(nombreCoincide('Ana Gabriella Pérez López', 'PÉREZ LÓPEZ ANA GABRIELA')).toBe(true);
    expect(nombreCoincide('Edwin Sebastian Cabascanga Salazar', 'CABASCANGO SALAZAR EDWIN SEBASTIAN')).toBe(true);
    expect(nombreCoincide('Anna María Pérez López', 'PÉREZ LÓPEZ ANA MARÍA')).toBe(false);
    expect(nombreCoincide('Ana Mariq Pérez López', 'PÉREZ LÓPEZ ANA MARÍA')).toBe(false);
  });

  it('"Mario" no pasa por "María"', () => {
    expect(nombreCoincide('Mario Ana Pérez López', 'PÉREZ LÓPEZ ANA MARÍA')).toBe(false);
  });

  it('no se cuenta dos veces la misma palabra', () => {
    expect(nombreCoincide('Ana Ana Pérez López', 'PÉREZ LÓPEZ ANA MARÍA')).toBe(false);
    expect(nombreCoincide('Pérez Pérez Ana María', 'PÉREZ LÓPEZ ANA MARÍA')).toBe(false);
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
