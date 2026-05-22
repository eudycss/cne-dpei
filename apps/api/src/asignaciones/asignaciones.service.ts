import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { upsertAsignacionSchema } from '@cne/shared-validation';
import type { Asignacion, UpsertAsignacionRequest } from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';

@Injectable()
export class AsignacionesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(eventoId: string): Promise<Asignacion[]> {
    const rows = await this.prisma.asignacionSupervisor.findMany({
      where: { eventoId },
      orderBy: { creadoEn: 'asc' },
    });
    if (rows.length === 0) return [];

    const userIds = [
      ...new Set([...rows.map((r) => r.operadorId), ...rows.map((r) => r.supervisorId)]),
    ];
    const users = await this.prisma.usuario.findMany({
      where: { id: { in: userIds } },
      select: { id: true, nombres: true, apellidos: true, cedula: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    return rows.map((r) => toDto(r, byId));
  }

  async upsert(input: UpsertAsignacionRequest): Promise<Asignacion> {
    const parsed = upsertAsignacionSchema.parse(input);

    const evento = await this.prisma.eventoElectoral.findUnique({
      where: { id: parsed.eventoId },
    });
    if (!evento) throw new NotFoundException('Evento no encontrado');

    const operador = await this.prisma.usuario.findFirst({
      where: {
        id: parsed.operadorId,
        roles: { some: { rol: { nombre: 'OPERADOR_CDA' } } },
      },
      select: { id: true, nombres: true, apellidos: true, cedula: true },
    });
    if (!operador) throw new BadRequestException('El usuario no tiene rol OPERADOR_CDA');

    const supervisor = await this.prisma.usuario.findFirst({
      where: {
        id: parsed.supervisorId,
        roles: { some: { rol: { nombre: 'TECNICO_SUPERVISOR' } } },
      },
      select: { id: true, nombres: true, apellidos: true, cedula: true },
    });
    if (!supervisor) throw new BadRequestException('El usuario no tiene rol TECNICO_SUPERVISOR');

    const row = await this.prisma.asignacionSupervisor.upsert({
      where: {
        eventoId_operadorId: { eventoId: parsed.eventoId, operadorId: parsed.operadorId },
      },
      create: {
        eventoId: parsed.eventoId,
        operadorId: parsed.operadorId,
        supervisorId: parsed.supervisorId,
      },
      update: { supervisorId: parsed.supervisorId },
    });

    const byId = new Map([
      [operador.id, operador],
      [supervisor.id, supervisor],
    ]);
    return toDto(row, byId);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.asignacionSupervisor.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Asignación no encontrada');
    await this.prisma.asignacionSupervisor.delete({ where: { id } });
  }
}

function toDto(
  r: { id: string; eventoId: string; operadorId: string; supervisorId: string; creadoEn: Date },
  byId: Map<string, { id: string; nombres: string; apellidos: string; cedula: string }>,
): Asignacion {
  const op = byId.get(r.operadorId);
  const sv = byId.get(r.supervisorId);
  return {
    id: r.id,
    eventoId: r.eventoId,
    operadorId: r.operadorId,
    operadorNombre: op ? `${op.nombres} ${op.apellidos}` : r.operadorId,
    operadorCedula: op?.cedula ?? '',
    supervisorId: r.supervisorId,
    supervisorNombre: sv ? `${sv.nombres} ${sv.apellidos}` : r.supervisorId,
    creadoEn: r.creadoEn.toISOString(),
  };
}
