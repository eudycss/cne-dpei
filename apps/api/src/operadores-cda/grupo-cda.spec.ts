import { BadRequestException } from '@nestjs/common';
import { GRUPOS_CDA } from '@cne/shared-validation';

import { TEXTOS_GRUPO, cargoActivo, claveParaNombre, parsearGrupo, registrarCargos, textosGrupo } from './grupo-cda';

/** Los 9 cargos originales, como los carga la migración. */
const BASE = GRUPOS_CDA.map((clave, i) => ({
  clave,
  nombre: TEXTOS_GRUPO[clave].titulo,
  centro: (clave === 'OPERADOR' || clave === 'ASISTENTE' ? 'CDA' : 'CPE') as 'CDA' | 'CPE',
  activo: true,
}));

describe('grupo-cda', () => {
  afterEach(() => registrarCargos(BASE));

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

  it('acepta un cargo agregado por el administrador (también desactivado: su historial se consulta)', () => {
    registrarCargos([...BASE, { clave: 'COORDINADORES', nombre: 'Coordinadores', centro: 'CPE', activo: false }]);
    expect(parsearGrupo('COORDINADORES')).toBe('COORDINADORES');
    expect(cargoActivo('COORDINADORES')).toBe(false);
    expect(cargoActivo('OPERADOR')).toBe(true);
    expect(cargoActivo('NO_EXISTE')).toBe(false);
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

  it('un cargo original renombrado cambia su título, no el texto de actas, carnets ni archivos', () => {
    registrarCargos(BASE.map((c) => (c.clave === 'RECEPTOR_ACTAS' ? { ...c, nombre: 'Recepción de actas' } : c)));
    expect(textosGrupo('RECEPTOR_ACTAS')).toEqual({ ...TEXTOS_GRUPO.RECEPTOR_ACTAS, titulo: 'Recepción de actas' });
  });

  it('un cargo nuevo arma sus textos con el nombre y el centro', () => {
    registrarCargos([...BASE, { clave: 'TECNICOS_DE_SALA', nombre: 'Técnicos de sala', centro: 'CPE', activo: true }]);
    expect(textosGrupo('TECNICOS_DE_SALA')).toEqual({
      titulo: 'Técnicos de sala',
      contador: 'Técnicos de sala',
      cargo: 'TÉCNICOS DE SALA CPE',
      archivo: 'tecnicos_de_sala_cpe',
      singular: 'persona',
    });
  });

  it('clave de un cargo nuevo: sin tildes ni símbolos, y sin chocar con las que ya existen', () => {
    expect(claveParaNombre('Técnicos de sala', new Set())).toBe('TECNICOS_DE_SALA');
    expect(claveParaNombre('Receptores (turno 2)', new Set())).toBe('RECEPTORES_TURNO_2');
    expect(claveParaNombre('Operadores CDA', new Set(GRUPOS_CDA))).toBe('OPERADORES_CDA');
    expect(claveParaNombre('Supervisor', new Set(GRUPOS_CDA))).toBe('SUPERVISOR_2');
    expect(claveParaNombre('Supervisor', new Set([...GRUPOS_CDA, 'SUPERVISOR_2']))).toBe('SUPERVISOR_3');
    expect(claveParaNombre('2.º turno', new Set())).toBe('C_2_TURNO');
    const larga = claveParaNombre('x'.repeat(80), new Set());
    expect(larga).toMatch(/^[A-Z][A-Z0-9_]{0,39}$/);
    expect(claveParaNombre('x'.repeat(80), new Set([larga]))).toMatch(/^[A-Z][A-Z0-9_]{0,39}$/);
  });
});
