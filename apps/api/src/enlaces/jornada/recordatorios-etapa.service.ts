import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../db/prisma.service';
import { diaDeJornada, JornadaService } from './jornada.service';
import { recordatoriosEtapa, TEXTO_RECORDATORIO } from './recordatorios-etapa';

/** A lo más estos recordatorios por vuelta: un arranque a media jornada no inunda las campanas. */
export const MAX_RECORDATORIOS_POR_VUELTA = 100;

/**
 * Recordatorios de etapa pendiente en la campana de la app del operador y su
 * pareja. Lo enviado queda en avisos_jornada (clave única): tras un reinicio no
 * se repite. Mismo interruptor que los demás crons de la jornada.
 */
@Injectable()
export class RecordatoriosEtapaService {
  private readonly log = new Logger('RecordatoriosEtapa');
  private enCurso = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jornada: JornadaService,
  ) {}

  @Cron('*/5 * * * *', { name: 'recordatorios-etapa', timeZone: 'America/Guayaquil' })
  async cadaCincoMinutos(): Promise<void> {
    if (process.env.ENLACES_CRON_ENABLED?.trim().toLowerCase() === 'false') return;
    if (this.enCurso) return;
    this.enCurso = true;
    try {
      await this.enviarPendientes();
    } catch (e) {
      this.log.error(`No se pudieron enviar los recordatorios de etapa: ${(e as Error)?.message ?? e}`);
    } finally {
      this.enCurso = false;
    }
  }

  async enviarPendientes(ahora = new Date()): Promise<number> {
    const jornada = await this.jornada.cargar(ahora.getTime());
    if (!jornada) return 0;

    const dia = diaDeJornada(ahora);
    const enviados = await this.prisma.avisoJornada.findMany({
      where: { eventoId: jornada.eventoId, dia: dia.fecha, clave: { startsWith: 'ETAPA:' } },
      select: { clave: true },
    });
    const pendientes = recordatoriosEtapa(jornada, ahora, new Set(enviados.map((e) => e.clave))).slice(
      0,
      MAX_RECORDATORIOS_POR_VUELTA,
    );

    let creados = 0;
    for (const r of pendientes) {
      // Se aparta antes de crear (la clave es única): si otra instancia ya lo tomó, no se duplica.
      const { count } = await this.prisma.avisoJornada.createMany({
        data: [{ eventoId: jornada.eventoId, dia: dia.fecha, clave: r.clave }],
        skipDuplicates: true,
      });
      if (count === 0) continue;
      try {
        await this.prisma.notificacion.createMany({
          data: r.destinatarios.map((usuarioId) => ({
            usuarioId,
            tipoEvento: TEXTO_RECORDATORIO[r.etapa],
            canal: 'PUSH' as const,
            payload: { etapa: r.etapa, minutosVencida: r.minutosVencida, eventoId: jornada.eventoId },
          })),
        });
        creados++;
      } catch (e) {
        // No se creó: se libera la clave para reintentar en la próxima vuelta y se sigue con los demás.
        this.log.error(`No se pudo crear el recordatorio ${r.clave}: ${(e as Error)?.message ?? e}`);
        await this.prisma.avisoJornada.deleteMany({
          where: { eventoId: jornada.eventoId, dia: dia.fecha, clave: r.clave },
        });
      }
    }
    return creados;
  }
}
