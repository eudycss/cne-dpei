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
    expect(nombreCoincide('Edwin Sebastian Cabascanfo Salazar', 'CABASCANGO SALAZAR EDWIN SEBASTIAN')).toBe(true);
    expect(nombreCoincide('Anna María Pérez López', 'PÉREZ LÓPEZ ANA MARÍA')).toBe(false);
    expect(nombreCoincide('Ana Mariq Pérez López', 'PÉREZ LÓPEZ ANA MARÍA')).toBe(false);
  });

  it('la letra de diferencia no vale en la última letra (otra persona u otra familia)', () => {
    expect(nombreCoincide('Fernanda Sofía Andrade Vega', 'ANDRADE VEGA FERNANDO SOFIA')).toBe(false);
    expect(nombreCoincide('Luis Alberto Martines Vega', 'MARTINEZ VEGA LUIS ALBERTO')).toBe(false);
  });

  it('la letra de diferencia se tolera en una sola palabra', () => {
    expect(nombreCoincide('Edwin Sebastien Cabascanfo Salazar', 'CABASCANGO SALAZAR EDWIN SEBASTIAN')).toBe(false);
  });

  it('nombres de 3 y de 5 palabras, y apellidos compuestos', () => {
    expect(nombreCoincide('Luis Vega Tapia', 'VEGA TAPIA LUIS')).toBe(true);
    expect(nombreCoincide('Luis Vega', 'VEGA TAPIA LUIS')).toBe(false);
    expect(nombreCoincide('María José Ana Pérez López', 'PÉREZ LÓPEZ MARÍA JOSÉ ANA')).toBe(true);
    expect(nombreCoincide('María José Pérez López', 'PÉREZ LÓPEZ MARÍA JOSÉ ANA')).toBe(false);
    expect(nombreCoincide('Ana María de la Torre Vega', 'DE LA TORRE VEGA ANA MARÍA')).toBe(true);
  });

  it('una sola palabra en el personal nunca coincide', () => {
    expect(nombreCoincide('Ana', 'ANA')).toBe(false);
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
