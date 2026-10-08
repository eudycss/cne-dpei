import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/roles.decorator';
import { BadRequestException } from '@nestjs/common';
import { cantonDelQuery, jornadaDelQuery, operadoresDelQuery, TrackingController } from './tracking.controller';

// Fija qué roles pueden usar cada endpoint de la verificación de retorno: el
// RolesGuard confía en estos metadatos, así que un cambio aquí es un cambio de
// permisos y debe romper un test.
const rolesDe = (metodo: keyof TrackingController): string[] =>
  new Reflector().get(ROLES_KEY, TrackingController.prototype[metodo] as () => unknown);

describe('TrackingController — roles de la verificación de kits al retorno', () => {
  it('solo el asistente transversal y el admin validan y verifican kits (ya no el técnico supervisor)', () => {
    for (const metodo of ['validarKitRetorno', 'verificarKitRetorno'] as const) {
      expect(rolesDe(metodo)).toEqual(['ASISTENTE_TRANSVERSAL', 'ADMINISTRADOR']);
    }
  });

  it('la lista de kits verificados la leen el asistente, el supervisor, el admin y el lector', () => {
    expect(rolesDe('kitsVerificadosRetorno')).toEqual([
      'ASISTENTE_TRANSVERSAL',
      'TECNICO_SUPERVISOR',
      'ADMINISTRADOR',
      'LECTOR',
    ]);
  });
});

describe('TrackingController — roles de la prueba de conexión', () => {
  it('solo el operador CDA registra la prueba de conexión', () => {
    expect(rolesDe('pruebaConexion')).toEqual(['OPERADOR_CDA']);
  });

  it('el informe del operador CDA (y elegir quién lo firma) es solo del administrador', () => {
    for (const metodo of ['responsablesInforme', 'informesOperadorPdf', 'informeOperadorPdf', 'reporteGeneralPdf'] as const) {
      expect(rolesDe(metodo)).toEqual(['ADMINISTRADOR']);
    }
    // El reporte de flujo en pantalla lo sigue viendo también el lector.
    expect(rolesDe('reporteFlujo')).toEqual(['ADMINISTRADOR', 'LECTOR']);
  });
});

describe('cantonDelQuery (filtro del informe masivo)', () => {
  it('sin cantón devuelve undefined (todos los cantones)', () => {
    expect(cantonDelQuery(undefined)).toBeUndefined();
    expect(cantonDelQuery('')).toBeUndefined();
  });

  it('acepta un id numérico', () => {
    expect(cantonDelQuery('7')).toBe(7);
  });

  it.each(['abc', '-1', '0', '1.5', '9999999'])('rechaza %p con 400 en vez de ignorarlo', (valor) => {
    expect(() => cantonDelQuery(valor)).toThrow(BadRequestException);
  });

  it('rechaza el parámetro repetido (arreglo)', () => {
    expect(() => cantonDelQuery(['1', '2'])).toThrow(BadRequestException);
  });
});

describe('jornadaDelQuery (incluir prueba de conexión y fotos)', () => {
  it('por defecto (ausente o false) no incluye la jornada', () => {
    expect(jornadaDelQuery(undefined)).toBe(false);
    expect(jornadaDelQuery('false')).toBe(false);
  });

  it('solo "true" la incluye', () => {
    expect(jornadaDelQuery('true')).toBe(true);
  });

  it.each(['1', 'si', 'TRUE'])('rechaza %p con 400', (valor) => {
    expect(() => jornadaDelQuery(valor)).toThrow(BadRequestException);
  });
});

describe('operadoresDelQuery (operadores elegidos)', () => {
  const A = '11111111-1111-1111-1111-111111111111';
  const B = '22222222-2222-2222-2222-222222222222';

  it('ausente = sin filtro', () => {
    expect(operadoresDelQuery(undefined)).toBeUndefined();
  });

  it('separa por coma y quita duplicados', () => {
    expect(operadoresDelQuery(`${A},${B},${A}`)).toEqual([A, B]);
  });

  it('rechaza un id inválido o el parámetro repetido', () => {
    expect(() => operadoresDelQuery(`${A},no-es-uuid`)).toThrow(BadRequestException);
    expect(() => operadoresDelQuery([A, B])).toThrow(BadRequestException);
  });
});
