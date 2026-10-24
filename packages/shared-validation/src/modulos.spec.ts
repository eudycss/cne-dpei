import { describe, expect, it } from 'vitest';
import {
  MODULOS_WEB,
  MODULO_WEB_IDS,
  actualizarModulosRolSchema,
  esRolConfigurable,
  modulosPermitidosParaRol,
  modulosPorDefecto,
} from './modulos';

describe('catálogo de módulos web', () => {
  it('tiene un módulo por id, sin repetidos', () => {
    expect(MODULOS_WEB.map((m) => m.id)).toEqual([...MODULO_WEB_IDS]);
  });

  it('la visibilidad de fábrica nunca supera el techo del API', () => {
    for (const m of MODULOS_WEB) {
      for (const r of m.rolesPorDefecto) expect(m.rolesPermitidos).toContain(r);
    }
  });

  it('el administrador ve todos los módulos', () => {
    expect(modulosPorDefecto(['ADMINISTRADOR'])).toEqual([...MODULO_WEB_IDS]);
  });

  it('el asistente transversal solo ve CDAs y Cadena de custodia de fábrica', () => {
    expect(modulosPorDefecto(['ASISTENTE_TRANSVERSAL'])).toEqual(['operadores-cda', 'cadena-custodia']);
  });

  it('combina los módulos de varios roles', () => {
    const ids = modulosPorDefecto(['TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL']);
    expect(ids).toContain('alertas');
    expect(ids).toContain('cadena-custodia');
  });

  it('solo el técnico supervisor puede tener Alertas', () => {
    expect(modulosPermitidosParaRol('TECNICO_SUPERVISOR')).toContain('alertas');
    expect(modulosPermitidosParaRol('LECTOR')).not.toContain('alertas');
  });

  it('el administrador y el operador CDA no son configurables', () => {
    expect(esRolConfigurable('ADMINISTRADOR')).toBe(false);
    expect(esRolConfigurable('OPERADOR_CDA')).toBe(false);
    expect(esRolConfigurable('LECTOR')).toBe(true);
  });
});

describe('actualizarModulosRolSchema', () => {
  it('acepta ids conocidos y quita repetidos', () => {
    expect(actualizarModulosRolSchema.parse({ modulos: ['kits', 'kits', 'alertas'] })).toEqual({
      modulos: ['kits', 'alertas'],
    });
  });

  it('acepta la lista vacía (rol sin módulos)', () => {
    expect(actualizarModulosRolSchema.safeParse({ modulos: [] }).success).toBe(true);
  });

  it('rechaza ids desconocidos', () => {
    expect(actualizarModulosRolSchema.safeParse({ modulos: ['bitacora'] }).success).toBe(false);
  });
});
