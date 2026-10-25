import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PermisoId } from '@cne/shared-validation';
import { PermisosModulosService } from './permisos-modulos.service';

export const PERMISO_KEY = 'permisoAccion';

/**
 * El endpoint solo responde si el administrador le dio alguna de estas
 * acciones a alguno de los roles del usuario, en un módulo que ese rol ve (el
 * ADMINISTRADOR siempre pasa). Va además de @Roles, que sigue siendo el techo.
 */
export const RequierePermiso = (...permisos: [PermisoId, ...PermisoId[]]) => SetMetadata(PERMISO_KEY, permisos);

@Injectable()
export class PermisoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permisos: PermisosModulosService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requeridos = this.reflector.getAllAndOverride<PermisoId[] | undefined>(PERMISO_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Sin acción declarada es un error de programación: cerrar, no abrir.
    if (!requeridos?.length) throw new ForbiddenException('Acción no permitida para su rol');
    const roles = context.switchToHttp().getRequest().user?.roles ?? [];
    const { permisos } = await this.permisos.misModulos(roles);
    if (!requeridos.some((p) => permisos.includes(p))) throw new ForbiddenException('Acción no permitida para su rol');
    return true;
  }
}
