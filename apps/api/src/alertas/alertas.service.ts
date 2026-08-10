import { Injectable, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { updateEstadoAlertaSchema } from '@cne/shared-validation';
import type { Alerta, UpdateEstadoAlertaRequest } from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const TIPO_EVENTO_ALERTA = 'ALERTA_GENERADA';

@Injectable()
export class AlertasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(eventoId: string, tipo?: string, estado?: string): Promise<Alerta[]> {
    const rows = await this.prisma.alerta.findMany({
      where: {
        eventoId,
        ...(tipo ? { tipo: tipo as any } : {}),
        ...(estado ? { estado: estado as any } : {}),
      },
      orderBy: { generadaEn: 'desc' },
    });
    return this.enrichWithOperadorNombre(rows);
  }

  async updateEstado(id: string, body: UpdateEstadoAlertaRequest): Promise<Alerta> {
    const parsed = updateEstadoAlertaSchema.parse(body);
    const existing = await this.prisma.alerta.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Alerta no encontrada');
    const updated = await this.prisma.alerta.update({
      where: { id },
      data: { estado: parsed.estado },
    });
    const [dto] = await this.enrichWithOperadorNombre([updated]);
    return dto;
  }

  private async enrichWithOperadorNombre(rows: any[]): Promise<Alerta[]> {
    const ids = [...new Set(rows.map((r) => r.operadorId).filter(Boolean))];
    const usuarios =
      ids.length > 0
        ? await this.prisma.usuario.findMany({
            where: { id: { in: ids } },
            select: { id: true, nombres: true, apellidos: true },
          })
        : [];
    const byId = new Map<string, string>(
      usuarios.map((u): [string, string] => [u.id, `${u.nombres} ${u.apellidos}`.trim()]),
    );
    return rows.map((r) => toDto(r, byId.get(r.operadorId ?? '') ?? null));
  }

  // Llamado inline desde TrackingService al confirmar recepción de kit
  async generarKitNoCorresponde(opts: {
    eventoId: string;
    operadorId: string;
    kitId: string;
    codigoKit: string;
    operadorAsignadoNombre: string;
  }): Promise<void> {
    await this.generarSiNoExiste({
      eventoId: opts.eventoId,
      operadorId: opts.operadorId,
      kitId: opts.kitId,
      tipo: 'KIT_NO_CORRESPONDE',
      mensaje: `Kit ${opts.codigoKit} fue recibido por un operador distinto al asignado (${opts.operadorAsignadoNombre}).`,
    });
  }

  // ─── Cron: CA1, CA2, CA3 ─────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_5_MINUTES)
  async evaluarAnomalias(): Promise<void> {
    const eventos = await this.prisma.eventoElectoral.findMany({
      where: { estado: 'ACTIVO' },
      select: { id: true },
    });
    for (const evento of eventos) {
      const cfg = await this.prisma.configAlerta.findUnique({ where: { eventoId: evento.id } });
      const umbralRecinto = cfg?.umbralLlegadaRecintoMin ?? 120;
      const umbralDpi = cfg?.umbralLlegadaDpiMin ?? 120;
      const umbralSync = cfg?.umbralSinSyncMin ?? 30;
      await Promise.all([
        this.evaluarCA1(evento.id, umbralRecinto),
        this.evaluarCA2(evento.id, umbralDpi),
        this.evaluarCA3(evento.id, umbralSync),
      ]);
    }
  }

  // CA1: SALIDA_DPI sin LLEGADA_RECINTO tras umbral
  private async evaluarCA1(eventoId: string, umbralMin: number): Promise<void> {
    const corte = new Date(Date.now() - umbralMin * 60_000);
    const salidasDpi = await this.prisma.eventoTracking.findMany({
      where: { eventoId, tipo: 'SALIDA_DPI', ocurridoEn: { lt: corte } },
      select: { operadorId: true, ocurridoEn: true },
    });
    for (const salida of salidasDpi) {
      const llegada = await this.prisma.eventoTracking.findFirst({
        where: { eventoId, operadorId: salida.operadorId, tipo: 'LLEGADA_RECINTO' },
      });
      if (llegada) continue;
      const mins = Math.round((Date.now() - salida.ocurridoEn.getTime()) / 60_000);
      await this.generarSiNoExiste({
        eventoId,
        operadorId: salida.operadorId,
        tipo: 'NO_LLEGO_RECINTO',
        mensaje: `Operador salió del DPI hace ${mins} min y no registró llegada al recinto (umbral: ${umbralMin} min).`,
      });
    }
  }

  // CA2: SALIDA_RECINTO sin LLEGADA_DPI tras umbral
  private async evaluarCA2(eventoId: string, umbralMin: number): Promise<void> {
    const corte = new Date(Date.now() - umbralMin * 60_000);
    const salidasRecinto = await this.prisma.eventoTracking.findMany({
      where: { eventoId, tipo: 'SALIDA_RECINTO', ocurridoEn: { lt: corte } },
      select: { operadorId: true, ocurridoEn: true },
    });
    for (const salida of salidasRecinto) {
      const llegada = await this.prisma.eventoTracking.findFirst({
        where: { eventoId, operadorId: salida.operadorId, tipo: 'LLEGADA_DPI' },
      });
      if (llegada) continue;
      const mins = Math.round((Date.now() - salida.ocurridoEn.getTime()) / 60_000);
      await this.generarSiNoExiste({
        eventoId,
        operadorId: salida.operadorId,
        tipo: 'NO_LLEGO_DPI',
        mensaje: `Operador salió del recinto hace ${mins} min y no registró llegada al DPI (umbral: ${umbralMin} min).`,
      });
    }
  }

  // CA3: operador en tránsito sin posición GPS reciente
  private async evaluarCA3(eventoId: string, umbralMin: number): Promise<void> {
    const corte = new Date(Date.now() - umbralMin * 60_000);

    // Operadores que salieron del DPI pero aún no registran LLEGADA_RECINTO
    const enTransitoIda = await this.prisma.$queryRaw<{ operador_id: string }[]>`
      SELECT DISTINCT t.operador_id
      FROM eventos_tracking t
      WHERE t.evento_id = ${eventoId}::uuid
        AND t.tipo = 'SALIDA_DPI'
        AND NOT EXISTS (
          SELECT 1 FROM eventos_tracking t2
          WHERE t2.evento_id = t.evento_id
            AND t2.operador_id = t.operador_id
            AND t2.tipo = 'LLEGADA_RECINTO'
        )
    `;
    // Operadores en retorno (SALIDA_RECINTO sin LLEGADA_DPI)
    const enTransitoVuelta = await this.prisma.$queryRaw<{ operador_id: string }[]>`
      SELECT DISTINCT t.operador_id
      FROM eventos_tracking t
      WHERE t.evento_id = ${eventoId}::uuid
        AND t.tipo = 'SALIDA_RECINTO'
        AND NOT EXISTS (
          SELECT 1 FROM eventos_tracking t2
          WHERE t2.evento_id = t.evento_id
            AND t2.operador_id = t.operador_id
            AND t2.tipo = 'LLEGADA_DPI'
        )
    `;

    const operadoresEnTransito = new Set([
      ...enTransitoIda.map((r) => r.operador_id),
      ...enTransitoVuelta.map((r) => r.operador_id),
    ]);

    for (const operadorId of operadoresEnTransito) {
      const ultimaPos = await this.prisma.posicionGps.findFirst({
        where: { eventoId, operadorId },
        orderBy: { capturadoEn: 'desc' },
        select: { capturadoEn: true },
      });
      if (ultimaPos && ultimaPos.capturadoEn > corte) continue;
      const mins = ultimaPos
        ? Math.round((Date.now() - ultimaPos.capturadoEn.getTime()) / 60_000)
        : null;
      await this.generarSiNoExiste({
        eventoId,
        operadorId,
        tipo: 'SIN_SINCRONIZAR',
        mensaje: mins
          ? `Operador sin sincronización GPS hace ${mins} min (umbral: ${umbralMin} min).`
          : `Operador en tránsito sin posición GPS registrada (umbral: ${umbralMin} min).`,
      });
    }
  }

  // ─── helpers ─────────────────────────────────────────────────────────────

  private async generarSiNoExiste(opts: {
    eventoId: string;
    operadorId?: string | null;
    kitId?: string | null;
    tipo: string;
    mensaje: string;
  }): Promise<void> {
    const existe = await this.prisma.alerta.findFirst({
      where: {
        eventoId: opts.eventoId,
        operadorId: opts.operadorId ?? null,
        tipo: opts.tipo as any,
        estado: { in: ['GENERADA', 'VISTA'] },
      },
    });
    if (existe) return;

    const alerta = await this.prisma.alerta.create({
      data: {
        eventoId: opts.eventoId,
        operadorId: opts.operadorId ?? null,
        kitId: opts.kitId ?? null,
        tipo: opts.tipo as any,
        mensaje: opts.mensaje,
      },
    });

    if (opts.operadorId) {
      await this.notifications.encolarAlerta({
        eventoId: opts.eventoId,
        operadorId: opts.operadorId,
        alertaId: alerta.id,
        tipo: opts.tipo,
        mensaje: opts.mensaje,
      });
    }
  }
}

function toDto(row: any, operadorNombre: string | null = null): Alerta {
  return {
    id: row.id,
    eventoId: row.eventoId,
    operadorId: row.operadorId ?? null,
    operadorNombre,
    kitId: row.kitId ?? null,
    tipo: row.tipo,
    mensaje: row.mensaje,
    estado: row.estado,
    generadaEn: row.generadaEn.toISOString(),
  };
}
