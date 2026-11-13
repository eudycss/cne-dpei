import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RoleName } from '@cne/shared-types';

import { PermisosModulosService } from '../permisos-modulos/permisos-modulos.service';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from './roles.decorator';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  const reflector = { getAllAndOverride: jest.fn() };
  const permisos = { misModulos: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new RolesGuard(reflector as unknown as Reflector, permisos as unknown as PermisosModulosService);
  });

  function contextWithRoles(userRoles: RoleName[] | undefined, method = 'POST'): ExecutionContext {
    const handler = () => undefined;
    const clazz = class {};
    return {
      getHandler: () => handler,
      getClass: () => clazz,
      switchToHttp: () => ({
        getRequest: () => ({ method, user: userRoles ? { roles: userRoles } : undefined }),
      }),
    } as unknown as ExecutionContext;
  }

  it('permite el paso si el endpoint no declara @Roles(...)', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    expect(guard.canActivate(contextWithRoles(['OPERADOR_CDA']))).toBe(true);
  });

  it('permite el paso si el usuario tiene alguno de los roles requeridos', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMINISTRADOR', 'TECNICO_SUPERVISOR']);
    expect(guard.canActivate(contextWithRoles(['TECNICO_SUPERVISOR']))).toBe(true);
  });

  it('lanza ForbiddenException si el usuario no tiene ninguno de los roles requeridos', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMINISTRADOR']);
    expect(() => guard.canActivate(contextWithRoles(['TECNICO_SUPERVISOR']))).toThrow(
      ForbiddenException,
    );
  });

  it('lanza ForbiddenException si no hay usuario autenticado en la request', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMINISTRADOR']);
    expect(() => guard.canActivate(contextWithRoles(undefined))).toThrow(ForbiddenException);
  });

  // Casos específicos del rol LECTOR (solo lectura, agregado 2026-09-15).
  it('LECTOR pasa en un endpoint de lectura que lo incluye en @Roles(...)', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'LECTOR']);
    expect(guard.canActivate(contextWithRoles(['LECTOR']))).toBe(true);
  });

  it('LECTOR es rechazado en un endpoint de escritura que no lo incluye en @Roles(...)', () => {
    reflector.getAllAndOverride.mockReturnValue(['ADMINISTRADOR']);
    expect(() => guard.canActivate(contextWithRoles(['LECTOR']))).toThrow(ForbiddenException);
  });

  it('reflector.getAllAndOverride se consulta con la clave ROLES_KEY sobre handler y clase', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = contextWithRoles(['LECTOR']);
    guard.canActivate(context);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
  });

  describe('ANALISTA_PROVINCIAL (actúa como administrador en los módulos activados)', () => {
    /** Responde por clave: roles requeridos, solo-admin y módulo del endpoint. */
    const endpoint = (opts: { roles: RoleName[]; soloAdmin?: boolean; modulo?: string }) =>
      reflector.getAllAndOverride.mockImplementation((key: string) =>
        key === ROLES_KEY ? opts.roles : key === 'soloAdministrador' ? opts.soloAdmin : opts.modulo,
      );

    it('pasa en un endpoint de administrador si el módulo está activado', async () => {
      endpoint({ roles: ['ADMINISTRADOR'], modulo: 'kits' });
      permisos.misModulos.mockResolvedValue({ modulos: ['kits'], permisos: [] });
      await expect(guard.canActivate(contextWithRoles(['ANALISTA_PROVINCIAL']))).resolves.toBe(true);
      expect(permisos.misModulos).toHaveBeenCalledWith(['ANALISTA_PROVINCIAL']);
    });

    it('se rechaza si el administrador le quitó el módulo', async () => {
      endpoint({ roles: ['ADMINISTRADOR'], modulo: 'kits' });
      permisos.misModulos.mockResolvedValue({ modulos: ['eventos'], permisos: [] });
      await expect(guard.canActivate(contextWithRoles(['ANALISTA_PROVINCIAL']))).rejects.toThrow(ForbiddenException);
    });

    it('se rechaza en un endpoint sin módulo declarado (cierra, no abre)', async () => {
      endpoint({ roles: ['ADMINISTRADOR'] });
      await expect(guard.canActivate(contextWithRoles(['ANALISTA_PROVINCIAL']))).rejects.toThrow(ForbiddenException);
      expect(permisos.misModulos).not.toHaveBeenCalled();
    });

    it('nunca pasa en lo exclusivo del administrador, aunque tenga el módulo', () => {
      endpoint({ roles: ['ADMINISTRADOR'], soloAdmin: true, modulo: 'usuarios' });
      expect(() => guard.canActivate(contextWithRoles(['ANALISTA_PROVINCIAL']))).toThrow(ForbiddenException);
      expect(permisos.misModulos).not.toHaveBeenCalled();
    });

    it('no pasa donde el administrador tampoco entra (endpoint de otro rol)', () => {
      endpoint({ roles: ['OPERADOR_CDA'], modulo: 'kits' });
      expect(() => guard.canActivate(contextWithRoles(['ANALISTA_PROVINCIAL']))).toThrow(ForbiddenException);
    });

    it('un técnico supervisor no puede editar aunque tenga el módulo', () => {
      endpoint({ roles: ['ADMINISTRADOR'], modulo: 'kits' });
      permisos.misModulos.mockResolvedValue({ modulos: ['kits'], permisos: [] });
      for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(() => guard.canActivate(contextWithRoles(['TECNICO_SUPERVISOR'], metodo))).toThrow(ForbiddenException);
      }
      expect(permisos.misModulos).not.toHaveBeenCalled();
    });
  });

  describe('roles configurables que no son analista (solo ven lo marcado como lectura)', () => {
    const endpoint = (opts: { soloAdmin?: boolean; modulo?: string; lectura?: boolean }) =>
      reflector.getAllAndOverride.mockImplementation((key: string) =>
        key === ROLES_KEY
          ? ['ADMINISTRADOR']
          : key === 'soloAdministrador'
            ? opts.soloAdmin
            : key === 'lecturaConfigurable'
              ? opts.lectura
              : opts.modulo,
      );
    const ROLES_LECTURA = ['TECNICO_SUPERVISOR', 'LECTOR', 'ASISTENTE_TRANSVERSAL'] as RoleName[];

    it.each(ROLES_LECTURA)('%s lee (GET y HEAD) una lectura marcada si el módulo está activado', async (rol) => {
      endpoint({ modulo: 'alertas', lectura: true });
      permisos.misModulos.mockResolvedValue({ modulos: ['alertas'], permisos: [] });
      await expect(guard.canActivate(contextWithRoles([rol], 'GET'))).resolves.toBe(true);
      await expect(guard.canActivate(contextWithRoles([rol], 'HEAD'))).resolves.toBe(true);
    });

    it.each(ROLES_LECTURA)('%s no edita aunque el módulo esté activado', (rol) => {
      endpoint({ modulo: 'alertas', lectura: true });
      for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(() => guard.canActivate(contextWithRoles([rol], metodo))).toThrow(ForbiddenException);
      }
      expect(permisos.misModulos).not.toHaveBeenCalled();
    });

    it.each(ROLES_LECTURA)('%s no lee un GET de administrador que no está marcado como lectura', (rol) => {
      endpoint({ modulo: 'monitoreo' });
      expect(() => guard.canActivate(contextWithRoles([rol], 'GET'))).toThrow(ForbiddenException);
      expect(permisos.misModulos).not.toHaveBeenCalled();
    });

    it('se rechaza la lectura si el módulo no está activado para su rol', async () => {
      endpoint({ modulo: 'alertas', lectura: true });
      permisos.misModulos.mockResolvedValue({ modulos: ['kits'], permisos: [] });
      await expect(guard.canActivate(contextWithRoles(['LECTOR'], 'GET'))).rejects.toThrow(ForbiddenException);
    });

    it('se rechaza la lectura en un endpoint sin módulo declarado', async () => {
      endpoint({ lectura: true });
      await expect(guard.canActivate(contextWithRoles(['LECTOR'], 'GET'))).rejects.toThrow(ForbiddenException);
    });

    it('nunca pasa en lo exclusivo del administrador, ni leyendo', () => {
      endpoint({ soloAdmin: true, modulo: 'usuarios', lectura: true });
      expect(() => guard.canActivate(contextWithRoles(['LECTOR'], 'GET'))).toThrow(ForbiddenException);
    });

    it('con analista y lector a la vez, manda el analista (edita)', async () => {
      endpoint({ modulo: 'kits' });
      permisos.misModulos.mockResolvedValue({ modulos: ['kits'], permisos: [] });
      await expect(guard.canActivate(contextWithRoles(['LECTOR', 'ANALISTA_PROVINCIAL'], 'POST'))).resolves.toBe(true);
    });
  });
});
