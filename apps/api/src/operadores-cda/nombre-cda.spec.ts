import { partirNombre } from './nombre-cda';

describe('partirNombre', () => {
  it('dos primeras palabras = apellidos, el resto = nombres', () => {
    expect(partirNombre('CABASCANGO PEREZ JUAN SEBASTIAN')).toEqual({
      apellidos: 'CABASCANGO PEREZ',
      nombres: 'JUAN SEBASTIAN',
    });
  });

  it('con tres palabras deja un solo nombre', () => {
    expect(partirNombre('TORRES LOPEZ ANA')).toEqual({ apellidos: 'TORRES LOPEZ', nombres: 'ANA' });
  });

  it('con dos palabras: una para cada campo', () => {
    expect(partirNombre('TORRES ANA')).toEqual({ apellidos: 'TORRES', nombres: 'ANA' });
  });

  it('con una palabra: apellidos = esa y nombres = "-"', () => {
    expect(partirNombre('TORRES')).toEqual({ apellidos: 'TORRES', nombres: '-' });
  });

  it('ignora espacios repetidos y en los extremos', () => {
    expect(partirNombre('  TORRES   LOPEZ  ANA   MARIA ')).toEqual({
      apellidos: 'TORRES LOPEZ',
      nombres: 'ANA MARIA',
    });
  });

  it('respeta el máximo de 120 caracteres de cada campo', () => {
    const largo = 'A'.repeat(150);
    const { apellidos, nombres } = partirNombre(`${largo} B ${largo}`);
    expect(apellidos.length).toBeLessThanOrEqual(120);
    expect(nombres.length).toBeLessThanOrEqual(120);
  });
});
