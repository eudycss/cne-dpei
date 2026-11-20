import {
  nombreCoincide,
  nombreCorto,
  nombreCortoDeApellidosNombres,
  nombreDeCuenta,
  palabrasNombre,
  separarApellidosNombres,
} from './nombre-evatics';

describe('nombre del certificado Evatics', () => {
  const ANA = 'PÉREZ LÓPEZ ANA MARÍA';

  it.each([
    ['el mismo nombre, sin tildes ni mayúsculas', 'perez lopez ana maria'],
    ['nombres antes de los apellidos (como en el certificado)', 'Ana María Pérez López'],
    ['con título y conector', 'Ing. Ana María de Pérez López'],
    ['basta un nombre y un apellido', 'Ana Pérez'],
    ['el segundo nombre y el segundo apellido', 'María López'],
    ['el certificado trae una palabra de más', 'Ana María Pérez López Vega'],
    ['falta un nombre', 'Ana Pérez López'],
    ['otra palabra mal leída no estorba', 'Ana Mariaa Pérez López'],
  ])('coincide: %s', (_caso, leido) => {
    expect(nombreCoincide(leido, ANA)).toBe(true);
  });

  it.each([
    ['solo apellidos (un hermano)', 'Luis Pérez López'],
    ['solo nombres', 'Ana María'],
    ['otra persona con un apellido igual', 'Luis Pérez Tapia'],
    ['una sola palabra', 'Ana'],
    ['vacío', ''],
    ['nada leído', null],
    ['otra persona', 'Juan Carlos Vega Mora'],
    ['un apellido corto con una letra cambiada', 'Ana Peres'],
  ])('no coincide: %s', (_caso, leido) => {
    expect(nombreCoincide(leido, ANA)).toBe(false);
  });

  it('los certificados del 20-nov: cuentas de Asistente Transversal con el nombre incompleto', () => {
    expect(nombreCoincide('CARLOS DANIEL CAÑARES DIAZ', nombreDeCuenta('Carlos', 'Cañares Diaz'))).toBe(true);
    expect(nombreCoincide('JAIRO HUMBERTO LEAL AVILÉS', nombreDeCuenta('Jairo Leal', 'Aviles'))).toBe(true);
    expect(nombreCoincide('CARLOS DANIEL VEGA MORA', nombreDeCuenta('Carlos', 'Cañares Diaz'))).toBe(false);
  });

  it('el ejemplo de la imagen y "DE LA TORRE"', () => {
    expect(nombreCoincide('EDWIN SEBASTIAN CABASCANGO SALAZAR', 'CABASCANGO SALAZAR EDWIN SEBASTIAN')).toBe(true);
    expect(nombreCoincide('Ana María de la Torre Vega', 'DE LA TORRE VEGA ANA MARÍA')).toBe(true);
  });

  it('tolerancia: una letra en una sola palabra de 7 o más, nunca en la última letra', () => {
    expect(nombreCoincide('Edwin Cabascanfo', 'CABASCANGO SALAZAR EDWIN SEBASTIAN')).toBe(true);
    expect(nombreCoincide('Sebastien Cabascanfo', 'CABASCANGO SALAZAR EDWIN SEBASTIAN')).toBe(false);
    expect(nombreCoincide('Fernanda Andrade', 'ANDRADE VEGA FERNANDO SOFIA')).toBe(false);
    expect(nombreCoincide('Luis Martines', 'MARTINEZ VEGA LUIS ALBERTO')).toBe(false);
    expect(nombreCoincide('Mario Pérez', ANA)).toBe(false);
  });

  it('el nombre y el apellido deben ser palabras distintas del certificado', () => {
    expect(nombreCoincide('Pérez Juan', { nombres: ['PEREZ'], apellidos: ['PEREZ'] })).toBe(false);
    expect(nombreCoincide('Pérez Pérez', { nombres: ['PEREZ'], apellidos: ['PEREZ'] })).toBe(true);
  });

  it('separa apellidos y nombres del personal (apellidos primero)', () => {
    expect(separarApellidosNombres(ANA)).toEqual({ apellidos: ['PEREZ', 'LOPEZ'], nombres: ['ANA', 'MARIA'] });
    expect(separarApellidosNombres('VEGA TAPIA LUIS')).toEqual({ apellidos: ['VEGA', 'TAPIA'], nombres: ['LUIS'] });
    expect(separarApellidosNombres('VEGA LUIS')).toEqual({ apellidos: ['VEGA'], nombres: ['LUIS'] });
    expect(nombreCoincide('Ana', 'ANA')).toBe(false);
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
