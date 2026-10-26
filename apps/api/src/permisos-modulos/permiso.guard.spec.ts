import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { PERMISOS, PERMISO_IDS, type PermisoId } from '@cne/shared-validation';
import { ROLES_KEY } from '../common/roles.decorator';
import { PERMISO_KEY, PermisoGuard } from './permiso.guard';
import { AsistenciaCdaController } from '../operadores-cda/asistencia-cda.controller';
import { AtrasosCdaController } from '../operadores-cda/atrasos-cda.controller';
import { CredencialQrCdaController } from '../operadores-cda/credencial-qr-cda.controller';
import { ActasCdaController } from '../operadores-cda/actas-cda.controller';
import { FotoCdaController } from '../operadores-cda/foto-cda.controller';
import { OperadoresCdaController } from '../operadores-cda/operadores-cda.controller';
import { MODULO_KEY, ModuloGuard } from './modulo.guard';

function contexto(roles: string[], permisos: PermisoId[] | undefined): ExecutionContext {
  const handler = () => undefined;
  if (permisos) Reflect.defineMetadata(PERMISO_KEY, permisos, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
  } as unknown as ExecutionContext;
}

function guard(permisos: string[]) {
  const misModulos = jest.fn().mockResolvedValue({ modulos: [], permisos });
  return { g: new PermisoGuard(new Reflector(), { misModulos } as never), misModulos };
}

describe('PermisoGuard', () => {
  it('deja pasar si el rol del usuario tiene la acción', async () => {
    const { g, misModulos } = guard(['cda.asistencia.qr']);
    await expect(g.canActivate(contexto(['ASISTENTE_TRANSVERSAL'], ['cda.asistencia.qr']))).resolves.toBe(true);
    expect(misModulos).toHaveBeenCalledWith(['ASISTENTE_TRANSVERSAL']);
  });

  it('con varias acciones declaradas, basta con tener una', async () => {
    const { g } = guard(['cda.carnets.emitir']);
    await expect(
      g.canActivate(contexto(['TECNICO_SUPERVISOR'], ['cda.asistencia.qr', 'cda.carnets.emitir'])),
    ).resolves.toBe(true);
  });

  it('responde 403 si el administrador no le dio la acción', async () => {
    const { g } = guard(['cda.asistencia.marcar']);
    await expect(g.canActivate(contexto(['ASISTENTE_TRANSVERSAL'], ['cda.carnets.emitir']))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('un endpoint sin @RequierePermiso se cierra en vez de abrirse', async () => {
    const { g, misModulos } = guard([...PERMISO_IDS]);
    await expect(g.canActivate(contexto(['ADMINISTRADOR'], undefined))).rejects.toBeInstanceOf(ForbiddenException);
    expect(misModulos).not.toHaveBeenCalled();
  });
});

/**
 * Qué acción exige cada endpoint de CDAs. Si se agrega uno que cambia datos,
 * va aquí; y cada acción del catálogo debe usarse en al menos un endpoint.
 */
const ENDPOINTS: [controlador: any, metodo: string, permiso: PermisoId][] = [
  [AsistenciaCdaController, 'marcar', 'cda.asistencia.marcar'],
  [AsistenciaCdaController, 'masiva', 'cda.asistencia.marcar'],
  [AsistenciaCdaController, 'deshacer', 'cda.asistencia.marcar'],
  [AsistenciaCdaController, 'corregir', 'cda.asistencia.corregir'],
  [AsistenciaCdaController, 'exportar', 'cda.asistencia.exportar'],
  [AsistenciaCdaController, 'exportarPdf', 'cda.asistencia.exportar'],
  [AtrasosCdaController, 'exportar', 'cda.asistencia.exportar'],
  [AtrasosCdaController, 'exportarPdf', 'cda.asistencia.exportar'],
  [CredencialQrCdaController, 'consultar', 'cda.asistencia.qr'],
  [CredencialQrCdaController, 'marcar', 'cda.asistencia.qr'],
  [CredencialQrCdaController, 'vigentes', 'cda.carnets.emitir'],
  [CredencialQrCdaController, 'carnets', 'cda.carnets.emitir'],
  [CredencialQrCdaController, 'revocar', 'cda.carnets.emitir'],
  [ActasCdaController, 'generar', 'cda.actas.gestionar'],
  [ActasCdaController, 'zip', 'cda.actas.gestionar'],
  [ActasCdaController, 'word', 'cda.actas.gestionar'],
  [ActasCdaController, 'pdf', 'cda.actas.gestionar'],
  [ActasCdaController, 'firmar', 'cda.actas.gestionar'],
  [FotoCdaController, 'crearEnlace', 'cda.fotos.enlace'],
];

// Lo mismo que resuelve RolesGuard: primero el método, luego la clase.
const rolesDe = (controlador: any, metodo: string) =>
  new Reflector().getAllAndOverride<string[]>(ROLES_KEY, [controlador.prototype[metodo], controlador]);

describe('Acciones de CDAs en los endpoints', () => {
  it.each(ENDPOINTS.map(([c, m, p]) => [`${c.name}.${m}`, c, m, p] as const))(
    '%s exige su acción con PermisoGuard',
    (_n, controlador, metodo, permiso) => {
      const handler = controlador.prototype[metodo];
      expect(handler).toBeDefined();
      expect(Reflect.getMetadata(PERMISO_KEY, handler)).toEqual([permiso]);
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(PermisoGuard);
    },
  );

  it('corregir días pasados: @Roles del método deja fuera al Asistente Transversal', () => {
    const roles = rolesDe(AsistenciaCdaController, 'corregir');
    expect(roles).toEqual(['ADMINISTRADOR', 'TECNICO_SUPERVISOR']);
    expect(roles).not.toContain('ASISTENTE_TRANSVERSAL');
  });

  it.each(ENDPOINTS.map(([c, m, p]) => [`${c.name}.${m}`, c, m, p] as const))(
    '%s: @Roles deja pasar a todos los roles a los que se les puede dar la acción',
    (_n, controlador, metodo, permiso) => {
      const roles = rolesDe(controlador, metodo);
      const techo = PERMISOS.find((p) => p.id === permiso)!.rolesPermitidos;
      for (const rol of ['ADMINISTRADOR', ...techo]) expect(roles).toContain(rol);
    },
  );

  it('cada acción del catálogo protege al menos un endpoint', () => {
    const usadas = new Set(ENDPOINTS.map(([, , p]) => p));
    expect(PERMISO_IDS.filter((id) => !usadas.has(id))).toEqual([]);
  });

  it('la migración precarga exactamente las acciones de fábrica del catálogo', () => {
    const dir = join(__dirname, '../../prisma/migrations');
    const carpeta = readdirSync(dir).find((d) => d.endsWith('_rol_permisos'));
    expect(carpeta).toBeDefined();
    const sql = readFileSync(join(dir, carpeta!, 'migration.sql'), 'utf8');
    const delSql = [...sql.matchAll(/\('([A-Z_]+)',\s*'([a-z.]+)'\)/g)].map(([, rol, p]) => `${rol}:${p}`).sort();
    const deFabrica = PERMISOS.flatMap((p) => p.rolesPorDefecto.map((rol) => `${rol}:${p.id}`)).sort();
    expect(delSql).toEqual(deFabrica);
  });
});

/**
 * Red de seguridad: un endpoint nuevo de CDAs no puede quedar abierto por
 * olvido. Cada uno exige una acción, es solo del administrador, o es una
 * lectura (GET) que exige ver el módulo.
 */
describe('Ningún endpoint de CDAs queda sin control', () => {
  const CONTROLADORES = [
    OperadoresCdaController,
    AsistenciaCdaController,
    AtrasosCdaController,
    CredencialQrCdaController,
    ActasCdaController,
    FotoCdaController,
  ];
  const metodos = CONTROLADORES.flatMap((c: any) =>
    Object.getOwnPropertyNames(c.prototype)
      .filter((m) => m !== 'constructor' && Reflect.getMetadata(METHOD_METADATA, c.prototype[m]) !== undefined)
      .map((m) => [`${c.name}.${m}`, c, m] as const),
  );

  it('encuentra los endpoints (si no, el test no prueba nada)', () => {
    expect(metodos.length).toBeGreaterThan(25);
  });

  it.each(metodos)('%s', (_n, controlador: any, metodo) => {
    const handler = controlador.prototype[metodo];
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) ?? [];
    const conAccion = guards.includes(PermisoGuard) && Reflect.getMetadata(PERMISO_KEY, handler)?.length > 0;
    const soloAdmin = JSON.stringify(rolesDe(controlador, metodo)) === JSON.stringify(['ADMINISTRADOR']);
    const lecturaDelModulo =
      Reflect.getMetadata(METHOD_METADATA, handler) === RequestMethod.GET &&
      guards.includes(ModuloGuard) &&
      Reflect.getMetadata(MODULO_KEY, handler) === 'operadores-cda';
    expect({ conAccion, soloAdmin, lecturaDelModulo }).not.toEqual({ conAccion: false, soloAdmin: false, lecturaDelModulo: false });
  });
});
