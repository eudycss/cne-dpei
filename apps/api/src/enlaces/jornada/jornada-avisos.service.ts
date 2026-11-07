import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../db/prisma.service';
import { TelegramNotifier } from '../telegram-notifier';
import { ALERTAS_REENVIADAS, avisosJornada, mensajesDeAvisos, type AlertaParaAviso } from './avisos-jornada';
import { diaDeJornada, esChatJornada, JornadaService } from './jornada.service';

/** Tras un envío fallido, no se reintenta antes de esto. */
const ESPERA_TRAS_FALLO_MS = 2 * 60_000;
/** A lo más estos avisos por vuelta: un arranque a media jornada no inunda el grupo (el resto, al minuto). */
export const MAX_AVISOS_POR_VUELTA = 20;
/**
 * Tras tantos fallos seguidos del mismo mensaje se da por perdido (queda
 * apartado y se registra el error): uno que Telegram rechaza siempre no debe
 * frenar a los que vienen detrás.
 */
export const FALLOS_PARA_DESCARTAR = 3;

/**
 * Avisos con sonido del grupo Jornada: retrasos (ida y vuelta) según el tiempo
 * de viaje de cada recinto, "✅ llegó", sin GPS en el camino y las alertas del
 * sistema reenviadas una vez. Lo enviado queda en avisos_jornada: tras un
 * reinicio no se repite. Mismo interruptor que los demás crons del bot.
 */
@Injectable()
export class JornadaAvisosService {
  private readonly log = new Logger('JornadaAvisos');
  private enCurso = false;
  private reintentarDesde = 0;
  /** Fallos seguidos por mensaje (sus claves juntas). */
  private readonly fallos = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jornada: JornadaService,
    private readonly telegram: TelegramNotifier,
  ) {}

  @Cron('* * * * *', { name: 'avisos-jornada', timeZone: 'America/Guayaquil' })
  async cadaMinuto(): Promise<void> {
    if (process.env.ENLACES_CRON_ENABLED?.trim().toLowerCase() === 'false') return;
    if (this.enCurso) return;
    this.enCurso = true;
    try {
      await this.enviarPendientes();
    } catch (e) {
      this.log.error(`No se pudieron revisar los avisos de la jornada: ${(e as Error)?.message ?? e}`);
    } finally {
      this.enCurso = false;
    }
  }

  async enviarPendientes(ahora = new Date()): Promise<void> {
    const chat = process.env.TELEGRAM_CHAT_ID_JORNADA?.trim();
    if (!chat || !esChatJornada(chat)) return;
    if (ahora.getTime() < this.reintentarDesde) return;
    const jornada = await this.jornada.cargar(ahora.getTime());
    if (!jornada) return;

    const dia = diaDeJornada(ahora);
    const enviados = await this.prisma.avisoJornada.findMany({
      where: { eventoId: jornada.eventoId, dia: dia.fecha },
      select: { clave: true },
    });
    const alertasEnviadas = enviados.filter((e) => e.clave.startsWith('ALERTA:')).map((e) => e.clave.slice('ALERTA:'.length));
    // Las ya reenviadas se excluyen en la consulta: con muchas alertas en el día, las nuevas no quedan fuera del límite.
    const alertas = await this.prisma.alerta.findMany({
      where: {
        eventoId: jornada.eventoId,
        tipo: { in: [...ALERTAS_REENVIADAS] },
        generadaEn: { gte: dia.desde },
        ...(alertasEnviadas.length ? { id: { notIn: alertasEnviadas } } : {}),
      },
      orderBy: { generadaEn: 'asc' },
      take: MAX_AVISOS_POR_VUELTA,
      select: { id: true, tipo: true, mensaje: true, generadaEn: true, operadorId: true },
    });
    const avisos = avisosJornada(
      jornada,
      ahora,
      new Set(enviados.map((e) => e.clave)),
      alertas as AlertaParaAviso[],
    ).slice(0, MAX_AVISOS_POR_VUELTA);
    if (avisos.length === 0) return;

    for (const m of mensajesDeAvisos(avisos)) {
      // Se aparta antes de enviar (la clave es única): si otra instancia ya lo tomó, no se duplica.
      const { count } = await this.prisma.avisoJornada.createMany({
        data: m.claves.map((clave) => ({ eventoId: jornada.eventoId, dia: dia.fecha, clave })),
        skipDuplicates: true,
      });
      if (count === 0) continue;
      const enviado = await this.telegram.responderEn(chat, () =>
        this.telegram.enviarHtml(m.texto, 'los avisos de la jornada', undefined, { silencioso: false }),
      );
      const id = m.claves.join('|');
      if (enviado) {
        this.fallos.delete(id);
        continue;
      }
      const fallos = (this.fallos.get(id) ?? 0) + 1;
      if (fallos >= FALLOS_PARA_DESCARTAR) {
        // Siempre rechazado: queda apartado (no se reintenta) y se sigue con los demás.
        this.fallos.delete(id);
        this.log.error(`Telegram rechazó ${FALLOS_PARA_DESCARTAR} veces un aviso de la jornada; se descarta: ${id}`);
        continue;
      }
      this.fallos.set(id, fallos);
      // Telegram no lo recibió: se libera para reintentar en unos minutos.
      await this.prisma.avisoJornada.deleteMany({
        where: { eventoId: jornada.eventoId, dia: dia.fecha, clave: { in: m.claves } },
      });
      this.reintentarDesde = ahora.getTime() + ESPERA_TRAS_FALLO_MS;
      return;
    }
  }
}
