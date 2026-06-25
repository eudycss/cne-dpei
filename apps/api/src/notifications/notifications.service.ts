import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { NotificacionItem } from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * HU2-CA3: encola notificaciones (PUSH + EMAIL) para el supervisor asignado
   * y todos los administradores cuando el operador registra su salida del DPI.
   * El envío real (push/email) se implementa en HU19; aquí solo se persiste la
   * cola y se usa el canal PUSH como representación de la notificación in-app.
   */
  async encolarSalidaDpi(opts: {
    operadorId: string;
    eventoId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.encolarParaSupervisorYAdmins({
      operadorId: opts.operadorId,
      eventoId: opts.eventoId,
      tipoEvento: 'SALIDA_DPI',
      payload: opts.payload,
    });
  }

  /**
   * HU3-CA7: encola notificaciones (PUSH + EMAIL) para el supervisor asignado
   * y los administradores cuando el operador registra su llegada al recinto.
   */
  async encolarLlegadaRecinto(opts: {
    operadorId: string;
    eventoId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.encolarParaSupervisorYAdmins({
      operadorId: opts.operadorId,
      eventoId: opts.eventoId,
      tipoEvento: 'LLEGADA_RECINTO',
      payload: opts.payload,
    });
  }

  /**
   * HU4-CA4: encola notificaciones (PUSH + EMAIL) para el supervisor asignado
   * y los administradores cuando el operador registra su salida del recinto e
   * inicia el retorno al DPI.
   */
  async encolarSalidaRecinto(opts: {
    operadorId: string;
    eventoId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.encolarParaSupervisorYAdmins({
      operadorId: opts.operadorId,
      eventoId: opts.eventoId,
      tipoEvento: 'SALIDA_RECINTO',
      payload: opts.payload,
    });
  }

  /**
   * HU5-CA3: encola notificaciones (PUSH + EMAIL) para el supervisor asignado
   * y los administradores cuando el operador registra su llegada al DPI y
   * completa la jornada; con este evento finaliza el monitoreo en tiempo real.
   */
  async encolarLlegadaDpi(opts: {
    operadorId: string;
    eventoId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.encolarParaSupervisorYAdmins({
      operadorId: opts.operadorId,
      eventoId: opts.eventoId,
      tipoEvento: 'LLEGADA_DPI',
      payload: opts.payload,
    });
  }

  /**
   * HU14-CA1: encola notificaciones (PUSH + EMAIL) para el supervisor asignado
   * y los administradores cuando el operador reporta una incidencia.
   */
  async encolarIncidencia(opts: {
    operadorId: string;
    eventoId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await this.encolarParaSupervisorYAdmins({
      operadorId: opts.operadorId,
      eventoId: opts.eventoId,
      tipoEvento: 'INCIDENCIA',
      payload: opts.payload,
    });
  }

  /** HU18: notifica al supervisor y admins cuando se genera una alerta. */
  async encolarAlerta(opts: {
    operadorId: string;
    eventoId: string;
    alertaId: string;
    tipo: string;
    mensaje: string;
  }): Promise<void> {
    await this.encolarParaSupervisorYAdmins({
      operadorId: opts.operadorId,
      eventoId: opts.eventoId,
      tipoEvento: 'ALERTA_GENERADA',
      payload: { alertaId: opts.alertaId, tipo: opts.tipo, mensaje: opts.mensaje },
    });
  }

  private async encolarParaSupervisorYAdmins(opts: {
    operadorId: string;
    eventoId: string;
    tipoEvento: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const destinatarios = new Set<string>();

    const asignacion = await this.prisma.asignacionSupervisor.findUnique({
      where: { eventoId_operadorId: { eventoId: opts.eventoId, operadorId: opts.operadorId } },
      select: { supervisorId: true },
    });
    if (asignacion) destinatarios.add(asignacion.supervisorId);

    const admins = await this.prisma.usuario.findMany({
      where: {
        activo: true,
        roles: { some: { rol: { nombre: 'ADMINISTRADOR' } } },
      },
      select: { id: true },
    });
    for (const a of admins) destinatarios.add(a.id);

    if (destinatarios.size === 0) return;

    const filas = Array.from(destinatarios).flatMap((usuarioId) => [
      {
        usuarioId,
        tipoEvento: opts.tipoEvento,
        canal: 'PUSH' as const,
        payload: opts.payload as any,
      },
      {
        usuarioId,
        tipoEvento: opts.tipoEvento,
        canal: 'EMAIL' as const,
        payload: opts.payload as any,
      },
    ]);

    await this.prisma.notificacion.createMany({ data: filas });
  }

  /**
   * Lista las notificaciones in-app (canal PUSH) del usuario actual.
   * Si soloNoLeidas=true, devuelve únicamente las pendientes.
   */
  async listMine(opts: {
    usuarioId: string;
    soloNoLeidas?: boolean;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: NotificacionItem[]; total: number; noLeidas: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 20));
    const where: any = { usuarioId: opts.usuarioId, canal: 'PUSH' };
    if (opts.soloNoLeidas) where.leidaEn = null;

    const [total, items, noLeidas] = await this.prisma.$transaction([
      this.prisma.notificacion.count({ where }),
      this.prisma.notificacion.findMany({
        where,
        orderBy: { creadoEn: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.notificacion.count({
        where: { usuarioId: opts.usuarioId, canal: 'PUSH', leidaEn: null },
      }),
    ]);

    return {
      total,
      noLeidas,
      items: items.map((n) => ({
        id: n.id,
        tipoEvento: n.tipoEvento,
        canal: n.canal as 'PUSH' | 'EMAIL',
        payload: (n.payload as Record<string, unknown>) ?? null,
        creadoEn: n.creadoEn.toISOString(),
        leidaEn: n.leidaEn ? n.leidaEn.toISOString() : null,
      })),
    };
  }

  async markRead(id: string, usuarioId: string): Promise<void> {
    const n = await this.prisma.notificacion.findUnique({ where: { id } });
    if (!n) throw new NotFoundException('Notificación no encontrada');
    if (n.usuarioId !== usuarioId) {
      throw new ForbiddenException('No puedes modificar notificaciones de otro usuario');
    }
    if (n.leidaEn) return;
    await this.prisma.notificacion.update({
      where: { id },
      data: { leidaEn: new Date() },
    });
  }
}
