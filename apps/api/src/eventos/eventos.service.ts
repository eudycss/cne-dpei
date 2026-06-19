import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  configAlertasSchema,
  createEventoSchema,
  updateEventoSchema,
} from '@cne/shared-validation';
import type {
  ConfigAlertas,
  CreateEventoRequest,
  EventoElectoral,
  UpdateEventoRequest,
} from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';

@Injectable()
export class EventosService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<EventoElectoral[]> {
    const eventos = await this.prisma.eventoElectoral.findMany({
      orderBy: [{ estado: 'asc' }, { fechaJornada: 'desc' }],
    });
    return eventos.map(toEventoDto);
  }

  async getActive(): Promise<EventoElectoral | null> {
    const e = await this.prisma.eventoElectoral.findFirst({ where: { estado: 'ACTIVO' } });
    return e ? toEventoDto(e) : null;
  }

  async get(id: string): Promise<EventoElectoral> {
    const e = await this.prisma.eventoElectoral.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Evento no encontrado');
    const config = await this.prisma.configAlerta.findUnique({ where: { eventoId: id } });
    return { ...toEventoDto(e), configAlertas: config ? toConfigDto(config) : undefined };
  }

  async create(input: CreateEventoRequest): Promise<EventoElectoral> {
    const parsed = createEventoSchema.parse(input);
    const evento = await this.prisma.eventoElectoral.create({
      data: {
        nombre: parsed.nombre,
        tipo: parsed.tipo,
        fechaJornada: new Date(parsed.fechaJornada),
        descripcion: parsed.descripcion ?? null,
        estado: 'BORRADOR',
        // Config de alertas con umbrales por defecto (HU18-CA6)
        // (se crea junto al evento)
      },
    });
    await this.prisma.configAlerta.create({ data: { eventoId: evento.id } });
    return this.get(evento.id);
  }

  async update(id: string, input: UpdateEventoRequest): Promise<EventoElectoral> {
    const parsed = updateEventoSchema.parse(input);
    const existing = await this.prisma.eventoElectoral.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Evento no encontrado');
    if (existing.estado !== 'BORRADOR') {
      throw new BadRequestException(
        'Solo se pueden editar eventos en estado BORRADOR',
      );
    }
    await this.prisma.eventoElectoral.update({
      where: { id },
      data: {
        nombre: parsed.nombre ?? existing.nombre,
        tipo: parsed.tipo ?? existing.tipo,
        fechaJornada: parsed.fechaJornada ? new Date(parsed.fechaJornada) : existing.fechaJornada,
        descripcion: parsed.descripcion ?? existing.descripcion,
      },
    });
    return this.get(id);
  }

  async activate(id: string): Promise<EventoElectoral> {
    const evento = await this.prisma.eventoElectoral.findUnique({ where: { id } });
    if (!evento) throw new NotFoundException('Evento no encontrado');
    if (evento.estado === 'CERRADO') {
      throw new BadRequestException('Un evento cerrado no puede reactivarse');
    }
    if (evento.estado === 'ACTIVO') return this.get(id);

    // HU20-CA2: solo un evento ACTIVO a la vez
    const activo = await this.prisma.eventoElectoral.findFirst({ where: { estado: 'ACTIVO' } });
    if (activo) {
      throw new ConflictException(
        `Ya existe un evento activo: "${activo.nombre}". Ciérralo antes de activar otro.`,
      );
    }
    await this.prisma.eventoElectoral.update({
      where: { id },
      data: { estado: 'ACTIVO' },
    });
    return this.get(id);
  }

  /**
   * HU20-CA6/CA7: cierre con confirmación. Valida que todos los operadores
   * asignados hayan registrado llegada al DPI; si hay pendientes exige
   * justificación.
   */
  async close(
    id: string,
    confirmar: boolean,
    justificacion?: string,
  ): Promise<EventoElectoral> {
    if (!confirmar) {
      throw new BadRequestException('Debes confirmar el cierre del evento');
    }
    const evento = await this.prisma.eventoElectoral.findUnique({ where: { id } });
    if (!evento) throw new NotFoundException('Evento no encontrado');
    if (evento.estado !== 'ACTIVO') {
      throw new BadRequestException('Solo se puede cerrar un evento ACTIVO');
    }

    const pendientes = await this.operadoresSinLlegadaDpi(id);
    if (pendientes.length > 0 && !justificacion?.trim()) {
      throw new BadRequestException({
        message:
          'Hay operadores que no registraron su llegada al DPI. Proporciona una justificación para cerrar el evento.',
        pendientes,
      });
    }

    await this.prisma.eventoElectoral.update({
      where: { id },
      data: { estado: 'CERRADO', cerradoEn: new Date() },
    });
    return this.get(id);
  }

  async updateConfigAlertas(
    id: string,
    input: ConfigAlertas,
  ): Promise<ConfigAlertas> {
    const parsed = configAlertasSchema.parse(input);
    const evento = await this.prisma.eventoElectoral.findUnique({ where: { id } });
    if (!evento) throw new NotFoundException('Evento no encontrado');
    const config = await this.prisma.configAlerta.upsert({
      where: { eventoId: id },
      update: parsed,
      create: { eventoId: id, ...parsed },
    });
    return toConfigDto(config);
  }

  // ---- internos ----
  /** Operadores asignados al evento sin un evento de tracking LLEGADA_DPI. */
  private async operadoresSinLlegadaDpi(
    eventoId: string,
  ): Promise<Array<{ id: string; nombre: string }>> {
    const asignaciones = await this.prisma.asignacionSupervisor.findMany({
      where: { eventoId },
      select: { operadorId: true },
    });
    if (asignaciones.length === 0) return [];
    const operadorIds = asignaciones.map((a) => a.operadorId);

    const llegadas = await this.prisma.eventoTracking.findMany({
      where: { eventoId, tipo: 'LLEGADA_DPI', operadorId: { in: operadorIds } },
      select: { operadorId: true },
    });
    const conLlegada = new Set(llegadas.map((l) => l.operadorId));
    const pendientesIds = operadorIds.filter((id) => !conLlegada.has(id));
    if (pendientesIds.length === 0) return [];

    const operadores = await this.prisma.usuario.findMany({
      where: { id: { in: pendientesIds } },
      select: { id: true, nombres: true, apellidos: true },
    });
    return operadores.map((o) => ({ id: o.id, nombre: `${o.nombres} ${o.apellidos}` }));
  }
}

function toEventoDto(e: any): EventoElectoral {
  return {
    id: e.id,
    nombre: e.nombre,
    tipo: e.tipo,
    fechaJornada: e.fechaJornada?.toISOString?.().slice(0, 10) ?? String(e.fechaJornada),
    descripcion: e.descripcion ?? null,
    estado: e.estado,
    creadoEn: e.creadoEn?.toISOString?.() ?? String(e.creadoEn),
    cerradoEn: e.cerradoEn?.toISOString?.() ?? null,
  };
}

function toConfigDto(c: any): ConfigAlertas {
  return {
    umbralLlegadaRecintoMin: c.umbralLlegadaRecintoMin,
    umbralLlegadaDpiMin: c.umbralLlegadaDpiMin,
    umbralSinSyncMin: c.umbralSinSyncMin,
    margenLlegadaMetros: c.margenLlegadaMetros,
  };
}
