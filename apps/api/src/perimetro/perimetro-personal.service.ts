import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CandidatoPerimetro, CargoPerimetro, PropuestaPersonalPerimetro } from '@cne/shared-types';
import {
  MAX_CANDIDATOS_PERIMETRO,
  type CandidatosPerimetroInput,
  type PropuestaPersonalPerimetroInput,
} from '@cne/shared-validation';
import { idsPorBusqueda } from '../common/busqueda-sql';
import { PrismaService } from '../db/prisma.service';
import { barajar, repartirPorSexo } from './reparto-personal';

/**
 * Personal CDA/CPE para los puestos del plan. De cada persona solo sale el id y
 * el nombre (y si ya está en otro plan del evento); el cargo y el centro sirven
 * para filtrar y el sexo solo para el reparto, dentro del servidor.
 */
@Injectable()
export class PerimetroPersonalService {
  constructor(private readonly prisma: PrismaService) {}

  async cargos(): Promise<CargoPerimetro[]> {
    const filas = await this.prisma.cargoCda.findMany({
      where: { activo: true },
      orderBy: [{ centro: 'asc' }, { orden: 'asc' }],
      select: { clave: true, nombre: true, centro: true },
    });
    return filas.map((f) => ({ ...f, centro: f.centro === 'CPE' ? 'CPE' : 'CDA' }));
  }

  /** Personal activo que se puede asignar a mano (sin quienes ya están en este plan). */
  async candidatos(planId: string, q: CandidatosPerimetroInput): Promise<CandidatoPerimetro[]> {
    const plan = await this.planBase(planId);
    const ids = await idsPorBusqueda(this.prisma, Prisma.sql`operadores_cda t`, [Prisma.raw('t.apellidos_nombres')], q.buscar);
    const filas = await this.prisma.operadorCda.findMany({
      where: {
        ...this.filtro(q.centro, q.cargo),
        ...(ids ? { id: { in: ids } } : {}),
        puestosPerimetro: { none: { planId } },
      },
      orderBy: { apellidosNombres: 'asc' },
      // Uno de más: así la web sabe que hay más resultados que los que muestra.
      take: MAX_CANDIDATOS_PERIMETRO + 1,
      select: { id: true, apellidosNombres: true, puestosPerimetro: { where: { plan: { eventoId: plan.eventoId } }, select: { id: true }, take: 1 } },
    });
    return filas.map((f) => ({ id: f.id, nombre: f.apellidosNombres, enOtroPlan: f.puestosPerimetro.length > 0 }));
  }

  /**
   * "Completar puestos vacíos": elige `total` personas según el % de mujeres.
   * Prefiere a quienes no están en otro plan del evento; nunca propone a quien
   * ya está en este plan (guardado) ni en el borrador (`excluir`).
   */
  async propuesta(planId: string, body: PropuestaPersonalPerimetroInput): Promise<PropuestaPersonalPerimetro> {
    const plan = await this.planBase(planId);
    const filas = await this.prisma.operadorCda.findMany({
      where: {
        ...this.filtro(body.centro, body.cargo),
        ...(body.excluir.length ? { id: { notIn: body.excluir } } : {}),
        puestosPerimetro: { none: { planId } },
      },
      orderBy: { apellidosNombres: 'asc' },
      select: {
        id: true,
        apellidosNombres: true,
        sexo: true,
        puestosPerimetro: { where: { plan: { eventoId: plan.eventoId } }, select: { id: true }, take: 1 },
      },
    });
    // Al azar dentro de cada grupo, pero primero quienes no están en otro plan del evento.
    const candidatos = barajar(
      filas.map((f) => ({ id: f.id, nombre: f.apellidosNombres, sexo: f.sexo, enOtroPlan: f.puestosPerimetro.length > 0 })),
    );
    return repartirPorSexo(candidatos, body.total, body.pctMujeres);
  }

  private filtro(centro?: 'CDA' | 'CPE', cargo?: string): Prisma.OperadorCdaWhereInput {
    return {
      activo: true,
      ...(cargo ? { grupo: cargo } : {}),
      ...(centro ? { cargoCda: { centro } } : {}),
    };
  }

  private async planBase(planId: string) {
    const plan = await this.prisma.planPerimetro.findUnique({ where: { id: planId }, select: { eventoId: true } });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    return plan;
  }
}
