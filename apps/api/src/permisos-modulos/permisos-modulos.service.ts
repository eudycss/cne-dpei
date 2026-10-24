import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { MisModulosResponse, ModulosRol, PermisosModulosResponse, RoleName } from '@cne/shared-types';
import {
  MODULOS_WEB,
  MODULO_WEB_IDS,
  ROLES_CONFIGURABLES,
  esRolConfigurable,
  modulosPermitidosParaRol,
  type RolConfigurable,
} from '@cne/shared-validation';
import { PrismaService } from '../db/prisma.service';

/** Ids en el orden del catálogo, sin los que superan el techo del rol. */
function dentroDelTecho(rol: RolConfigurable, modulos: readonly string[]): string[] {
  const permitidos = modulosPermitidosParaRol(rol);
  return permitidos.filter((id) => modulos.includes(id));
}

@Injectable()
export class PermisosModulosService {
  constructor(private readonly prisma: PrismaService) {}

  async matriz(): Promise<PermisosModulosResponse> {
    const filas = await this.prisma.rolModulo.findMany({
      where: { rol: { nombre: { in: [...ROLES_CONFIGURABLES] } } },
      select: { modulo: true, rol: { select: { nombre: true } } },
    });
    const roles: ModulosRol[] = ROLES_CONFIGURABLES.map((rol) => ({
      rol,
      modulos: dentroDelTecho(
        rol,
        filas.filter((f) => f.rol.nombre === rol).map((f) => f.modulo),
      ),
    }));
    return { roles };
  }

  /** Unión de los módulos visibles para los roles del usuario. */
  async misModulos(roles: readonly RoleName[]): Promise<MisModulosResponse> {
    if (roles.includes('ADMINISTRADOR')) return { modulos: [...MODULO_WEB_IDS] };
    const configurables = roles.filter(esRolConfigurable);
    if (configurables.length === 0) return { modulos: [] };
    const { roles: matriz } = await this.matriz();
    const visibles = new Set(
      matriz.filter((m) => (configurables as string[]).includes(m.rol)).flatMap((m) => m.modulos),
    );
    return { modulos: MODULOS_WEB.map((m) => m.id).filter((id) => visibles.has(id)) };
  }

  async actualizar(rol: string, modulos: readonly string[]): Promise<ModulosRol> {
    if (!esRolConfigurable(rol)) {
      throw new BadRequestException('Los módulos de este rol no se pueden configurar');
    }
    const permitidos = modulosPermitidosParaRol(rol);
    const fueraDelTecho = modulos.filter((id) => !(permitidos as string[]).includes(id));
    if (fueraDelTecho.length > 0) {
      throw new BadRequestException('Hay módulos que no están disponibles para este rol');
    }
    const fila = await this.prisma.rol.findUnique({ where: { nombre: rol }, select: { id: true } });
    if (!fila) throw new NotFoundException('Rol no encontrado');

    await this.prisma.$transaction([
      this.prisma.rolModulo.deleteMany({ where: { rolId: fila.id } }),
      this.prisma.rolModulo.createMany({ data: modulos.map((modulo) => ({ rolId: fila.id, modulo })) }),
    ]);
    return { rol, modulos: dentroDelTecho(rol, modulos) };
  }
}
