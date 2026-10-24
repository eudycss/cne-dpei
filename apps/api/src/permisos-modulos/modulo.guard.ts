import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ModuloWebId } from '@cne/shared-validation';
import { PermisosModulosService } from './permisos-modulos.service';

export const MODULO_KEY = 'moduloWeb';

/**
 * El endpoint solo responde si el administrador le activó ese módulo a alguno
 * de los roles del usuario (el ADMINISTRADOR siempre pasa). Va además de
 * @Roles: @Roles es el techo, esto es lo que el administrador eligió.
 */
export const RequiereModulo = (modulo: ModuloWebId) => SetMetadata(MODULO_KEY, modulo);

@Injectable()
export class ModuloGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permisos: PermisosModulosService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const modulo = this.reflector.getAllAndOverride<ModuloWebId | undefined>(MODULO_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Sin módulo declarado es un error de programación: cerrar, no abrir.
    if (!modulo) throw new ForbiddenException('Módulo no habilitado para su rol');
    const roles = context.switchToHttp().getRequest().user?.roles ?? [];
    const { modulos } = await this.permisos.misModulos(roles);
    if (!modulos.includes(modulo)) throw new ForbiddenException('Módulo no habilitado para su rol');
    return true;
  }
}
