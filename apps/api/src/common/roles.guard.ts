import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { RoleName } from '@cne/shared-types';
import { esRolConfigurable, type ModuloWebId, type PermisoId } from '@cne/shared-validation';
import { MODULO_KEY } from '../permisos-modulos/modulo.guard';
import { PERMISO_KEY } from '../permisos-modulos/permiso.guard';
import { PermisosModulosService } from '../permisos-modulos/permisos-modulos.service';
import { LECTURA_CONFIGURABLE_KEY, ROLES_KEY, SOLO_ADMIN_KEY } from './roles.decorator';

const METODOS_LECTURA = new Set(['GET', 'HEAD']);

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permisos: PermisosModulosService,
  ) {}

  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    const destino = [context.getHandler(), context.getClass()];
    const required = this.reflector.getAllAndOverride<RoleName[]>(ROLES_KEY, destino);
    if (!required || required.length === 0) {
      return true;
    }
    const req = context.switchToHttp().getRequest();
    const userRoles: RoleName[] = req.user?.roles ?? [];
    if (required.some((r) => userRoles.includes(r))) return true;
    // Los roles configurables entran donde entra el administrador, pero solo a los
    // módulos que el administrador les activó y nunca a lo exclusivo del administrador.
    // El analista provincial también edita; los demás roles solo leen (GET/HEAD) lo marcado como lectura.
    const rolAlias = userRoles.find(esRolConfigurable);
    if (rolAlias && required.includes('ADMINISTRADOR')) {
      if (this.reflector.getAllAndOverride<boolean>(SOLO_ADMIN_KEY, destino)) {
        throw new ForbiddenException('Rol insuficiente');
      }
      if (!userRoles.includes('ANALISTA_PROVINCIAL') && !this.lecturaPermitida(req.method, destino)) {
        throw new ForbiddenException('Su rol solo puede consultar lo habilitado para consulta');
      }
      // Sin módulo declarado se cierra: un endpoint nuevo no queda abierto por olvido.
      const modulo = this.reflector.getAllAndOverride<ModuloWebId | undefined>(MODULO_KEY, destino);
      // Las acciones (@RequierePermiso) ya traen su módulo en el catálogo: valen como declaración.
      const acciones = this.reflector.getAllAndOverride<PermisoId[] | undefined>(PERMISO_KEY, destino);
      return this.moduloActivo(modulo, acciones, userRoles);
    }
    throw new ForbiddenException('Rol insuficiente');
  }

  /** Solo GET/HEAD y solo los marcados con @LecturaConfigurable (lista blanca). */
  private lecturaPermitida(metodo: string, destino: Parameters<Reflector['getAllAndOverride']>[1]): boolean {
    return METODOS_LECTURA.has(metodo) && !!this.reflector.getAllAndOverride<boolean>(LECTURA_CONFIGURABLE_KEY, destino);
  }

  private async moduloActivo(modulo: ModuloWebId | undefined, acciones: PermisoId[] | undefined, roles: RoleName[]): Promise<boolean> {
    if (modulo || acciones?.length) {
      const mios = await this.permisos.misModulos(roles);
      if (modulo ? mios.modulos.includes(modulo) : acciones!.some((a) => mios.permisos.includes(a))) return true;
    }
    throw new ForbiddenException('Módulo no habilitado para su rol');
  }
}
