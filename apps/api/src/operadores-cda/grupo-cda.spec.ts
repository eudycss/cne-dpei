import { BadRequestException } from '@nestjs/common';
import { GRUPOS_CDA } from '@cne/shared-validation';

import { TEXTOS_GRUPO, parsearGrupo } from './grupo-cda';

describe('grupo-cda', () => {
  it('?grupo= ausente es OPERADOR (lo que había antes de los asistentes)', () => {
    expect(parsearGrupo(undefined)).toBe('OPERADOR');
    expect(parsearGrupo('ASISTENTE')).toBe('ASISTENTE');
    expect(parsearGrupo('OPERADOR_ESCANER_CPE')).toBe('OPERADOR_ESCANER_CPE');
    expect(parsearGrupo('ARCHIVADOR_ACTAS')).toBe('ARCHIVADOR_ACTAS');
  });

  it('rechaza con 400 valores desconocidos, en minúsculas o repetidos', () => {
    for (const v of ['asistente', 'TECNICO', ['ASISTENTE', 'OPERADOR'], '']) {
      expect(() => parsearGrupo(v)).toThrow(BadRequestException);
    }
  });

  it('acta y carnet dicen OPERADOR CDA o ASISTENTE CDA; archivos sin espacios', () => {
    expect(TEXTOS_GRUPO.OPERADOR.cargo).toBe('OPERADOR CDA');
    expect(TEXTOS_GRUPO.ASISTENTE.cargo).toBe('ASISTENTE CDA');
    for (const t of Object.values(TEXTOS_GRUPO)) expect(t.archivo).toMatch(/^[a-z0-9_]+$/);
  });

  it('los 9 cargos tienen textos propios, sin repetir cargo ni archivo', () => {
    expect(Object.keys(TEXTOS_GRUPO).sort()).toEqual([...GRUPOS_CDA].sort());
    const textos = Object.values(TEXTOS_GRUPO);
    expect(new Set(textos.map((t) => t.cargo)).size).toBe(9);
    expect(new Set(textos.map((t) => t.archivo)).size).toBe(9);
    expect(TEXTOS_GRUPO.ARCHIVADOR_ACTAS.cargo).toBe('ARCHIVADOR DE ACTAS CPE');
    expect(TEXTOS_GRUPO.OPERADOR_ESCANER_CPE.cargo).toBe('OPERADOR DE ESCÁNER CPE');
  });

  it('solo operadores y asistentes son CDA; el resto es CPE en actas, carnets y archivos', () => {
    for (const [grupo, t] of Object.entries(TEXTOS_GRUPO)) {
      const centro = grupo === 'OPERADOR' || grupo === 'ASISTENTE' ? 'CDA' : 'CPE';
      expect(t.cargo.endsWith(` ${centro}`)).toBe(true);
      expect(t.archivo.endsWith(`_${centro.toLowerCase()}`)).toBe(true);
    }
    expect(TEXTOS_GRUPO.DIGITADOR.cargo).toBe('DIGITADOR CPE');
    expect(TEXTOS_GRUPO.SUPERVISOR.cargo).toBe('SUPERVISOR CPE');
  });
});
