import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { MODULO_KEY, ModuloGuard } from './modulo.guard';
import { CustodiaController } from '../custodia/custodia.controller';

function contexto(roles: string[], modulo: string | undefined): ExecutionContext {
  const handler = () => undefined;
  if (modulo) Reflect.defineMetadata(MODULO_KEY, modulo, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user: { roles } }) }),
  } as unknown as ExecutionContext;
}

function guard(modulos: string[]) {
  const misModulos = jest.fn().mockResolvedValue({ modulos });
  return { g: new ModuloGuard(new Reflector(), { misModulos } as never), misModulos };
}

describe('ModuloGuard', () => {
  it('deja pasar si el admin le activó el módulo a alguno de los roles del usuario', async () => {
    const { g, misModulos } = guard(['cadena-custodia']);
    await expect(g.canActivate(contexto(['TECNICO_SUPERVISOR'], 'cadena-custodia'))).resolves.toBe(true);
    expect(misModulos).toHaveBeenCalledWith(['TECNICO_SUPERVISOR']);
  });

  it('responde 403 si el módulo no está activo para sus roles', async () => {
    const { g } = guard(['kits']);
    await expect(g.canActivate(contexto(['LECTOR'], 'cadena-custodia'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('sin usuario o sin roles no pasa', async () => {
    const { g } = guard([]);
    await expect(g.canActivate(contexto([], 'cadena-custodia'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('un endpoint sin @RequiereModulo se cierra en vez de abrirse', async () => {
    const { g, misModulos } = guard(['cadena-custodia']);
    await expect(g.canActivate(contexto(['ADMINISTRADOR'], undefined))).rejects.toBeInstanceOf(ForbiddenException);
    expect(misModulos).not.toHaveBeenCalled();
  });

  it.each(['informe', 'actas', 'actaKit'])('custodia.%s exige el módulo "cadena-custodia"', (metodo) => {
    const handler = (CustodiaController.prototype as any)[metodo];
    expect(Reflect.getMetadata(MODULO_KEY, handler)).toBe('cadena-custodia');
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(ModuloGuard);
  });
});
