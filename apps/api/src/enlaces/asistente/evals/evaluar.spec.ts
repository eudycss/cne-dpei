import { CASOS } from './casos';
import { CODIGOS_PRUEBA, ENCARGADOS_PRUEBA, ENLACES_PRUEBA } from './datos-prueba';
import { codigosEn, evaluarCaso, textoVisible } from './evaluar';

const CONOCIDOS = ['9101', '9102', '9105'];

describe('evaluarCaso', () => {
  it('lee el texto visible: sin etiquetas y sin escapes', () => {
    expect(textoVisible('<b>UE &lt;A&gt; &amp; B</b>')).toBe('UE <A> & B');
  });

  it('los códigos se cuentan solo como número suelto, no dentro de un teléfono', () => {
    expect(codigosEn('• 9101 — Escuela · 📞 0990009102', CONOCIDOS)).toEqual(['9101']);
  });

  it('codigos: exige exactamente esos, y dice cuáles faltan y cuáles sobran', () => {
    expect(evaluarCaso('9101, 9102', { codigos: ['9101', '9102'] }, CONOCIDOS).ok).toBe(true);
    expect(evaluarCaso('9101, 9105', { codigos: ['9101', '9102'] }, CONOCIDOS).fallas).toEqual([
      'faltan códigos: 9102',
      'sobran códigos: 9105',
    ]);
  });

  it('cantidad y pertenencia de códigos', () => {
    expect(evaluarCaso('9101 9102', { cantidadCodigos: 2, codigosDentroDe: ['9101', '9102'] }, CONOCIDOS).ok).toBe(true);
    const r = evaluarCaso('9101 9102 9105', { cantidadCodigos: 2, codigosDentroDe: ['9101', '9102'] }, CONOCIDOS);
    expect(r.fallas).toEqual(['esperaba 2 códigos y hubo 3', 'códigos que no corresponden: 9105']);
  });

  it('contiene / noContiene sin importar mayúsculas ni tildes', () => {
    expect(evaluarCaso('Técnico: WILLY', { contiene: ['willy', 'tecnico'], noContiene: ['Jairo'] }, CONOCIDOS).ok).toBe(true);
    expect(evaluarCaso('Jairo', { noContiene: ['jairo'] }, CONOCIDOS).fallas).toEqual(['no debía decir "jairo"']);
  });

  it('numeros: el conteo debe aparecer como número suelto', () => {
    expect(evaluarCaso('Recintos: 21', { numeros: [21] }, CONOCIDOS).ok).toBe(true);
    expect(evaluarCaso('Recintos: 210', { numeros: [21] }, CONOCIDOS).fallas).toEqual(['falta el número 21']);
  });
});

describe('banco de preguntas', () => {
  it('los datos de prueba son ficticios: códigos 9xxx y teléfonos 09900…', () => {
    expect(ENLACES_PRUEBA).toHaveLength(21);
    expect(CODIGOS_PRUEBA.every((c) => /^9\d{3}$/.test(c))).toBe(true);
    expect([...ENCARGADOS_PRUEBA.values()].every((e) => e.telefono.startsWith('09900'))).toBe(true);
  });

  it('cada caso usa solo códigos que existen en los datos de prueba', () => {
    for (const { esperado } of CASOS) {
      for (const c of [...(esperado.codigos ?? []), ...(esperado.codigosDentroDe ?? [])]) {
        expect(CODIGOS_PRUEBA).toContain(c);
      }
    }
  });
});
