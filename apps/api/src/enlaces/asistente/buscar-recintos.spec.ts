import { buscarRecintos, normalizarTexto, palabrasClave } from './buscar-recintos';

const recinto = (codigoRecinto: string, nombreRecinto: string, canton: string | null, parroquia = '') => ({
  codigoRecinto,
  nombreRecinto,
  canton,
  parroquia,
});

const RECINTOS = [
  recinto('28', 'Unidad Educativa Ibarra', 'Ibarra', 'SAGRARIO'),
  recinto('30', 'Colegio Teodoro Gómez de la Torre', 'Ibarra', 'SAN FRANCISCO'),
  recinto('1008', 'UE San Juan de Ilumán Bloque 2', 'Otavalo', 'SAN JUAN DE ILUMAN'),
  recinto('1009', 'UE San Juan de Iluman Bloque 1', 'Otavalo', 'SAN JUAN DE ILUMAN'),
  recinto('1961', 'Unidad Educativa García Moreno', 'Cotacachi', 'GARCIA MORENO'),
  recinto('2000', 'Escuela 28 de Septiembre', 'Pimampiro', ''),
];

const codigos = (texto: string) => buscarRecintos(texto, RECINTOS).map((r) => r.codigoRecinto);

describe('normalizarTexto / palabrasClave', () => {
  it('quita tildes, mayúsculas y signos', () => {
    expect(normalizarTexto('  UE San Juan de ILUMÁN — Bloque 2 ')).toBe('ue san juan de iluman bloque 2');
  });

  it('descarta las palabras que no distinguen un recinto', () => {
    expect(palabrasClave('el colegio de Ibarra')).toEqual(['ibarra']);
  });
});

describe('buscarRecintos', () => {
  it('"colegio Ibarra" prefiere los que se llaman Ibarra antes que todos los del cantón', () => {
    expect(codigos('colegio Ibarra')).toEqual(['28']);
  });

  it('sin importar tildes ni mayúsculas, y devuelve todos los empatados', () => {
    expect(codigos('SAN JUAN DE ILUMÁN')).toEqual(['1008', '1009']);
  });

  it('palabras incompletas coinciden con el inicio ("teodo gomez")', () => {
    expect(codigos('teodo gomez')).toEqual(['30']);
  });

  it('todas las palabras tienen que aparecer', () => {
    expect(codigos('ilumán bloque 1')).toEqual(['1009']);
    expect(codigos('ilumán quito')).toEqual([]);
  });

  it('el cantón o la parroquia sirven para acotar', () => {
    expect(codigos('garcía moreno cotacachi')).toEqual(['1961']);
  });

  it('un código exacto devuelve ese recinto', () => {
    expect(codigos('1008')).toEqual(['1008']);
  });

  it('un número que no es código se busca en los nombres ("28 de septiembre")', () => {
    expect(codigos('28 septiembre')).toEqual(['2000']);
    expect(codigos('2000')).toEqual(['2000']);
  });

  it('los números no coinciden por prefijo (10 ≠ 1008)', () => {
    expect(codigos('10')).toEqual([]);
  });

  it('sin palabras útiles no devuelve nada', () => {
    expect(codigos('el colegio')).toEqual([]);
    expect(codigos('   ')).toEqual([]);
  });
});
