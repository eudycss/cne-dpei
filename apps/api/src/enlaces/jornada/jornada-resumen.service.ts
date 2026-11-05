import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TelegramNotifier } from '../telegram-notifier';
import {
  conteosJornada,
  formatearResumenAutomatico,
  jornadaCerrada,
  jornadaEmpezada,
  mismosConteos,
  tecladoResumenAutomatico,
  type ConteosJornada,
} from './jornada';
import { diaDeJornada, esChatJornada, JornadaService } from './jornada.service';

/** Lo último que se mandó en el día de jornada (en memoria: tras un reinicio se repite un resumen, sin más). */
interface UltimoResumen {
  dia: string;
  conteos: ConteosJornada | null;
  en: Date | null;
  cerrada: boolean;
}

/**
 * Resumen automático del grupo Jornada: cada 15 minutos, sin sonido y solo si
 * algo cambió; al cerrar la jornada (todos en el DPEI, sin kits pendientes)
 * manda el cierre una vez, con sonido, y deja de mandar ese día.
 */
@Injectable()
export class JornadaResumenService {
  private readonly log = new Logger('JornadaResumen');
  private ultimo: UltimoResumen | null = null;

  constructor(
    private readonly jornada: JornadaService,
    private readonly telegram: TelegramNotifier,
  ) {}

  @Cron('*/15 * * * *', { name: 'resumen-jornada', timeZone: 'America/Guayaquil' })
  async cadaQuinceMinutos(): Promise<void> {
    // Mismo interruptor que el cron de enlaces: en local está apagado y no escribe al grupo real.
    if (process.env.ENLACES_CRON_ENABLED?.trim().toLowerCase() === 'false') return;
    try {
      await this.enviarSiCambio();
    } catch (e) {
      this.log.error(`No se pudo armar el resumen automático de la jornada: ${(e as Error)?.message ?? e}`);
    }
  }

  async enviarSiCambio(ahora = new Date()): Promise<void> {
    const chat = process.env.TELEGRAM_CHAT_ID_JORNADA?.trim();
    if (!chat || !esChatJornada(chat)) return;
    const jornada = await this.jornada.cargar(ahora.getTime());
    if (!jornada || !jornadaEmpezada(jornada)) return;

    const dia = diaDeJornada(ahora).fecha;
    if (this.ultimo?.dia !== dia) this.ultimo = { dia, conteos: null, en: null, cerrada: false };
    if (this.ultimo.cerrada) return;

    const conteos = conteosJornada(jornada);
    const cerrada = jornadaCerrada(jornada);
    if (!cerrada && this.ultimo.conteos && mismosConteos(conteos, this.ultimo.conteos)) return;

    const anterior = this.ultimo.conteos && this.ultimo.en ? { conteos: this.ultimo.conteos, en: this.ultimo.en } : null;
    await this.telegram.responderEn(chat, () =>
      this.telegram.enviarHtml(
        formatearResumenAutomatico(jornada, ahora, anterior),
        cerrada ? 'el cierre de la jornada' : 'el resumen automático de la jornada',
        tecladoResumenAutomatico(),
        // Los resúmenes no suenan; el cierre sí.
        { silencioso: !cerrada },
      ),
    );
    this.ultimo = { dia, conteos, en: ahora, cerrada };
  }
}
