import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { MisModulosResponse, ModulosRol, PermisosModulosResponse, RoleName } from '@cne/shared-types';
import {
  MODULOS_WEB,
  MODULO_WEB_IDS,
  PERMISO_IDS,
  ROLES_CONFIGURABLES,
  esRolConfigurable,
  modulosPermitidosParaRol,
  permisosConModulo,
  permisosPermitidosParaRol,
  type RolConfigurable,
} from '@cne/shared-validation';
import { PrismaService } from '../db/prisma.service';

/** Ids en el orden del catálogo, sin los que superan el techo del rol. */
function dentroDelTecho(rol: RolConfigurable, modulos: readonly string[]): string[] {
  const permitidos = modulosPermitidosParaRol(rol);
  return permitidos.filter((id) => modulos.includes(id));
}

function permisosDentroDelTecho(rol: RolConfigurable, permisos: readonly string[]): string[] {
  return permisosPermitidosParaRol(rol).filter((id) => permisos.includes(id));
}

@Injectable()
export class PermisosModulosService {
  constructor(private readonly prisma: PrismaService) {}

  async matriz(): Promise<PermisosModulosResponse> {
    const delRol = { rol: { nombre: { in: [...ROLES_CONFIGURABLES] } } };
    const [filas, acciones] = await Promise.all([
      this.prisma.rolModulo.findMany({ where: delRol, select: { modulo: true, rol: { select: { nombre: true } } } }),
      this.prisma.rolPermiso.findMany({ where: delRol, select: { permiso: true, rol: { select: { nombre: true } } } }),
    ]);
    const roles: ModulosRol[] = ROLES_CONFIGURABLES.map((rol) => ({
      rol,
      modulos: dentroDelTecho(
        rol,
        filas.filter((f) => f.rol.nombre === rol).map((f) => f.modulo),
      ),
      permisos: permisosDentroDelTecho(
        rol,
        acciones.filter((a) => a.rol.nombre === rol).map((a) => a.permiso),
      ),
    }));
    return { roles };
  }

  /**
   * Unión de los módulos visibles para los roles del usuario, y de las
   * acciones de cada rol en los módulos que ese mismo rol ve.
   */
  async misModulos(roles: readonly RoleName[]): Promise<MisModulosResponse> {
    if (roles.includes('ADMINISTRADOR')) return { modulos: [...MODULO_WEB_IDS], permisos: [...PERMISO_IDS] };
    const configurables = roles.filter(esRolConfigurable);
    if (configurables.length === 0) return { modulos: [], permisos: [] };
    const { roles: matriz } = await this.matriz();
    const suyas = matriz.filter((m) => (configurables as string[]).includes(m.rol));
    const visibles = new Set(suyas.flatMap((m) => m.modulos));
    const permitidas = new Set(suyas.flatMap((m) => permisosConModulo(m.permisos, m.modulos)));
    return {
      modulos: MODULOS_WEB.map((m) => m.id).filter((id) => visibles.has(id)),
      permisos: PERMISO_IDS.filter((id) => permitidas.has(id)),
    };
  }

  /** Reemplaza los módulos del rol y, si vienen, también sus acciones. */
  async actualizar(rol: string, modulos: readonly string[], permisos?: readonly string[]): Promise<ModulosRol> {
    if (!esRolConfigurable(rol)) {
      throw new BadRequestException('Los módulos de este rol no se pueden configurar');
    }
    const permitidos = modulosPermitidosParaRol(rol);
    const fueraDelTecho = modulos.filter((id) => !(permitidos as string[]).includes(id));
    if (fueraDelTecho.length > 0) {
      throw new BadRequestException('Hay módulos que no están disponibles para este rol');
    }
    if (permisos) {
      const accionesPermitidas = permisosPermitidosParaRol(rol) as string[];
      if (permisos.some((id) => !accionesPermitidas.includes(id))) {
        throw new BadRequestException('Hay acciones que no están disponibles para este rol');
      }
    }
    const fila = await this.prisma.rol.findUnique({ where: { nombre: rol }, select: { id: true } });
    if (!fila) throw new NotFoundException('Rol no encontrado');

    await this.prisma.$transaction([
      this.prisma.rolModulo.deleteMany({ where: { rolId: fila.id } }),
      this.prisma.rolModulo.createMany({ data: modulos.map((modulo) => ({ rolId: fila.id, modulo })) }),
      ...(permisos
        ? [
            this.prisma.rolPermiso.deleteMany({ where: { rolId: fila.id } }),
            this.prisma.rolPermiso.createMany({ data: permisos.map((permiso) => ({ rolId: fila.id, permiso })) }),
          ]
        : []),
    ]);
    const guardadas =
      permisos ??
      (await this.prisma.rolPermiso.findMany({ where: { rolId: fila.id }, select: { permiso: true } })).map((p) => p.permiso);
    return { rol, modulos: dentroDelTecho(rol, modulos), permisos: permisosDentroDelTecho(rol, guardadas) };
  }
}
