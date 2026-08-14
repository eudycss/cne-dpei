import { describe, expect, it } from 'vitest';
import { cedulaSchema, isValidCedulaEcuatoriana, telefonoSchema } from './index';

describe('isValidCedulaEcuatoriana / cedulaSchema', () => {
  // Cédulas construidas con el algoritmo módulo-10 oficial (coeficientes
  // [2,1,2,1,2,1,2,1,2], verificador = 10 - (suma % 10), o 0 si suma % 10 === 0)
  // y verificadas de forma independiente antes de usarse como fixtures.
  const casosValidos: Array<[string, string]> = [
    ['0100001007', 'provincia límite 01, tercer dígito 0'],
    ['2461234565', 'provincia límite 24, tercer dígito 6'],
    ['1034567899', 'provincia 10 (Imbabura), tercer dígito 3'],
    ['1750123455', 'provincia 17 (Pichincha), tercer dígito 5'],
  ];

  it.each(casosValidos)('acepta %s (%s)', (cedula) => {
    expect(isValidCedulaEcuatoriana(cedula)).toBe(true);
    expect(cedulaSchema.safeParse(cedula).success).toBe(true);
  });

  const casosInvalidos: Array<[string, string]> = [
    ['2500001007', 'provincia 25 fuera de rango (>24)'],
    ['0000001007', 'provincia 00 fuera de rango (<01)'],
    ['0170001007', 'tercer dígito 7 (fuera de 0-6)'],
    ['0190001007', 'tercer dígito 9 (fuera de 0-6)'],
    ['0100001001', 'dígito verificador incorrecto'],
    ['123456789', 'longitud corta (9 dígitos)'],
    ['12345678901', 'longitud larga (11 dígitos)'],
    ['abcdefghij', 'no numérica'],
    ['', 'cadena vacía'],
  ];

  it.each(casosInvalidos)('rechaza %s (%s)', (cedula) => {
    expect(isValidCedulaEcuatoriana(cedula)).toBe(false);
    expect(cedulaSchema.safeParse(cedula).success).toBe(false);
  });
});

describe('telefonoSchema', () => {
  const casosValidos: Array<[string, string]> = [
    ['0991234567', 'celular nacional sin formato'],
    ['+593991234567', 'celular con prefijo internacional'],
    ['099-123-4567', 'celular con guiones'],
    ['0991 234 567', 'celular con espacios'],
    ['(0991234567)', 'celular con paréntesis envolventes'],
    ['+593 99 123 4567', 'celular internacional con espacios'],
  ];

  it.each(casosValidos)('acepta %s (%s)', (telefono) => {
    const resultado = telefonoSchema.safeParse(telefono);
    expect(resultado.success).toBe(true);
  });

  const casosInvalidos: Array<[string, string]> = [
    ['022345678', 'fijo (código de área 02, no celular)'],
    ['062345678', 'fijo (código de área 06)'],
    ['099123456', 'celular corto (9 dígitos tras el 0)'],
    ['09912345678', 'celular largo (11 dígitos tras el 0)'],
    ['+59399123456', 'celular corto con prefijo internacional'],
    ['0891234567', 'no empieza con 09'],
    ['abcdefghij', 'no numérico'],
  ];

  it.each(casosInvalidos)('rechaza %s (%s)', (telefono) => {
    const resultado = telefonoSchema.safeParse(telefono);
    expect(resultado.success).toBe(false);
  });

  it('trata cadena vacía como ausente (opcional)', () => {
    const resultado = telefonoSchema.safeParse('');
    expect(resultado.success).toBe(true);
    expect(resultado.success && resultado.data).toBeUndefined();
  });

  it('trata null como ausente (opcional)', () => {
    const resultado = telefonoSchema.safeParse(null);
    expect(resultado.success).toBe(true);
    expect(resultado.success && resultado.data).toBeUndefined();
  });

  it('normaliza espacios/guiones/paréntesis antes de validar', () => {
    const resultado = telefonoSchema.safeParse('099-123 (4567)');
    expect(resultado.success).toBe(true);
    if (resultado.success) {
      expect(resultado.data).toBe('0991234567');
    }
  });
});
