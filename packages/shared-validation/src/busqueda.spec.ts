import { describe, expect, it } from 'vitest';
import { coincideBusqueda, normalizarBusqueda, palabrasBusqueda } from './busqueda';

const PERSONA = ['PÉREZ GÓMEZ JUAN', '1712345678'];

describe('normalizarBusqueda', () => {
  it('quita tildes, diéresis y la tilde de la ñ, y pasa a minúsculas', () => {
    expect(normalizarBusqueda('MUÑOZ Pérez Güilcapi')).toBe('munoz perez guilcapi');
  });
});

describe('palabrasBusqueda', () => {
  it('separa por cualquier espacio y descarta vacías', () => {
    expect(palabrasBusqueda('  Juan   PÉREZ\t')).toEqual(['juan', 'perez']);
  });
});

describe('coincideBusqueda', () => {
  it.each([
    ['perez', 'sin tilde'],
    ['PÉREZ', 'con tilde y en mayúsculas'],
    ['juan perez', 'nombre y apellido en otro orden'],
    ['Pérez Juan', 'saltando el segundo apellido'],
    ['perez gom', 'parte de una palabra'],
    ['gomez perez juan', 'nombre completo en otro orden'],
    ['171234', 'parte de la cédula'],
    ['juan 1712', 'nombre y cédula juntos'],
  ])('encuentra "%s" (%s)', (consulta) => {
    expect(coincideBusqueda(PERSONA, consulta)).toBe(true);
  });

  it('"munoz" encuentra a "MUÑOZ" y "muñoz" a "MUNOZ"', () => {
    expect(coincideBusqueda(['MUÑOZ ANA'], 'munoz')).toBe(true);
    expect(coincideBusqueda(['MUNOZ ANA'], 'muñoz')).toBe(true);
  });

  it('exige todas las palabras', () => {
    expect(coincideBusqueda(PERSONA, 'juan lopez')).toBe(false);
  });

  it('consulta vacía o solo espacios coincide con todo', () => {
    expect(coincideBusqueda(PERSONA, '')).toBe(true);
    expect(coincideBusqueda(PERSONA, '   ')).toBe(true);
  });

  it('ignora textos nulos o vacíos', () => {
    expect(coincideBusqueda([null, undefined, '', 'Ibarra'], 'ibarra')).toBe(true);
  });

  it('las palabras no se unen entre campos distintos', () => {
    // "juan1712" no existe: nombre y cédula se separan con un espacio.
    expect(coincideBusqueda(PERSONA, 'juan1712')).toBe(false);
  });
});
