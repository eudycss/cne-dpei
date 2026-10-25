import { describe, expect, it } from 'vitest';
import { MODULOS_WEB, actualizarModulosRolSchema } from './modulos';
import {
  PERMISOS,
  PERMISO_IDS,
  esPermisoId,
  permisosConModulo,
  permisosPermitidosParaRol,
  permisosPorDefecto,
} from './permisos';

describe('catálogo de acciones por rol', () => {
  it('tiene una acción por id, sin repetidos, y cada id cabe en la columna (40)', () => {
    expect(PERMISOS.map((p) => p.id)).toEqual([...PERMISO_IDS]);
    for (const id of PERMISO_IDS) expect(id.length).toBeLessThanOrEqual(40);
  });

  it('la fábrica no supera el techo de la acción, y el techo no supera el del módulo', () => {
    for (const p of PERMISOS) {
      for (const r of p.rolesPorDefecto) expect(p.rolesPermitidos).toContain(r);
      const modulo = MODULOS_WEB.find((m) => m.id === p.modulo)!;
      for (const r of p.rolesPermitidos) expect(modulo.rolesPermitidos).toContain(r);
    }
  });

  it('el administrador puede todo', () => {
    expect(permisosPorDefecto(['ADMINISTRADOR'])).toEqual([...PERMISO_IDS]);
  });

  it('de fábrica el asistente transversal toma asistencia pero no emite carnets', () => {
    const suyos = permisosPorDefecto(['ASISTENTE_TRANSVERSAL']);
    expect(suyos).toContain('cda.asistencia.marcar');
    expect(suyos).toContain('cda.asistencia.qr');
    expect(suyos).not.toContain('cda.carnets.emitir');
  });

  it('emitir carnets se le puede dar al técnico y al asistente, nunca al lector', () => {
    expect(permisosPermitidosParaRol('ASISTENTE_TRANSVERSAL')).toContain('cda.carnets.emitir');
    expect(permisosPermitidosParaRol('LECTOR')).toEqual([]);
  });

  it('sin el módulo visible, sus acciones no cuentan', () => {
    expect(permisosConModulo(['cda.asistencia.marcar'], ['kits'])).toEqual([]);
    expect(permisosConModulo(['cda.asistencia.marcar', 'otra'], ['operadores-cda'])).toEqual(['cda.asistencia.marcar']);
  });

  it('esPermisoId reconoce solo ids del catálogo', () => {
    expect(esPermisoId('cda.asistencia.qr')).toBe(true);
    expect(esPermisoId('cda.todo')).toBe(false);
    expect(esPermisoId(3)).toBe(false);
  });
});

describe('actualizarModulosRolSchema con acciones', () => {
  it('las acciones son opcionales (una web vieja solo manda módulos)', () => {
    expect(actualizarModulosRolSchema.parse({ modulos: [] })).toEqual({ modulos: [] });
  });

  it('acepta acciones conocidas y quita repetidas', () => {
    expect(
      actualizarModulosRolSchema.parse({ modulos: [], permisos: ['cda.asistencia.qr', 'cda.asistencia.qr'] }).permisos,
    ).toEqual(['cda.asistencia.qr']);
  });

  it('rechaza acciones desconocidas', () => {
    expect(actualizarModulosRolSchema.safeParse({ modulos: [], permisos: ['cda.borrar'] }).success).toBe(false);
  });
});
