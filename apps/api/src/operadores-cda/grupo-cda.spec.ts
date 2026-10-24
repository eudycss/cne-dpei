import { BadRequestException } from '@nestjs/common';

import { TEXTOS_GRUPO, parsearGrupo } from './grupo-cda';

describe('grupo-cda', () => {
  it('?grupo= ausente es OPERADOR (lo que había antes de los asistentes)', () => {
    expect(parsearGrupo(undefined)).toBe('OPERADOR');
    expect(parsearGrupo('ASISTENTE')).toBe('ASISTENTE');
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
});
