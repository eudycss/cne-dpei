import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RoleName } from '@cne/shared-types';

import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from './roles.decorator';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  const reflector = { getAllAndOverride: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  function contextWithRoles(userRoles: RoleName[] | undefined): ExecutionContext {
    const handler = () => undefined;
    const clazz = class {};
    return {
      getHandler: () => handler,
      getClass: () => clazz,
      switchToHttp: () => ({
        getRequest: () => ({ user: userRoles ? { roles: userRoles } : undefined }),
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
});
