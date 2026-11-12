import { nombreCoincide, nombreCorto, nombreCortoDeApellidosNombres, palabrasNombre } from './nombre-evatics';

describe('nombre del certificado Evatics', () => {
  const ANA = 'PÉREZ LÓPEZ ANA MARÍA';

  it.each([
    ['el mismo nombre, sin tildes ni mayúsculas', 'perez lopez ana maria'],
    ['nombres antes de los apellidos', 'Ana María Pérez López'],
    ['solo un nombre y un apellido', 'Ana Pérez'],
    ['solo el segundo apellido y un nombre', 'María López'],
    ['con título y conector', 'Ing. Ana María de Pérez López'],
  ])('coincide: %s', (_caso, leido) => {
    expect(nombreCoincide(leido, ANA)).toBe(true);
  });

  it.each([
    ['otra persona con un apellido igual', 'Luis Pérez Tapia'],
    ['una sola palabra', 'Ana'],
    ['vacío', ''],
    ['nada leído', null],
    ['otra persona', 'Juan Carlos Vega Mora'],
    ['dos nombres de pila sin apellido', 'Ana María'],
    ['dos apellidos sin nombre', 'Pérez López'],
    ['un apellido con una letra cambiada no cuenta como exacto', 'Ana Peres'],
  ])('no coincide: %s', (_caso, leido) => {
    expect(nombreCoincide(leido, ANA)).toBe(false);
  });

  it('homónimo: "Juan Pérez" es de Pérez Gómez Juan Carlos, no de otro Juan ni de otro Pérez', () => {
    expect(nombreCoincide('JUAN PEREZ', 'PEREZ GOMEZ JUAN CARLOS')).toBe(true);
    expect(nombreCoincide('JUAN PEREZ', 'PEREZ GOMEZ LUIS CARLOS')).toBe(false);
    expect(nombreCoincide('JUAN PEREZ', 'VEGA GOMEZ JUAN CARLOS')).toBe(false);
  });

  it('"Mario" no pasa por "María"', () => {
    expect(nombreCoincide('Mario Pérez', 'PÉREZ LÓPEZ MARÍA')).toBe(false);
  });

  it('una letra mal leída solo se tolera en palabras de 7 letras o más y nunca en el primer nombre', () => {
    // GABRIELLA por GABRIELA, pero es el primer nombre: no.
    expect(nombreCoincide('Gabriella Pérez', 'PÉREZ LÓPEZ GABRIELA ANA')).toBe(false);
    // El segundo nombre, largo, con una letra de más: sí.
    expect(nombreCoincide('Ana Gabriella Pérez', 'PÉREZ LÓPEZ ANA GABRIELA')).toBe(true);
    // Palabra corta con una letra cambiada: no cuenta (aquí siguen coincidiendo 3 de 4).
    expect(nombreCoincide('Ana Mariq Pérez López', 'PÉREZ LÓPEZ ANA MARÍA')).toBe(true);
    expect(nombreCoincide('Anna Pérez', 'PÉREZ LÓPEZ ANA MARÍA')).toBe(false);
  });

  it('no se cuenta dos veces la misma palabra', () => {
    expect(nombreCoincide('Ana Ana', 'PÉREZ LÓPEZ ANA MARÍA')).toBe(false);
    expect(nombreCoincide('Pérez Pérez', 'PÉREZ LÓPEZ ANA MARÍA')).toBe(false);
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
