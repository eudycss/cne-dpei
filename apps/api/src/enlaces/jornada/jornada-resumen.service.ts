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

/** Si Telegram no recibió el resumen, se reintenta pasado este tiempo (no cada minuto). */
const ESPERA_TRAS_FALLO_MS = 2 * 60_000;

/**
 * Lo último que se mandó en el día de jornada y evento. En memoria: tras un
 * reinicio (deploy) se repite un resumen; si la jornada ya estaba cerrada, el
 * cierre se repite sin sonido.
 */
interface UltimoResumen {
  dia: string;
  evento: string;
  conteos: ConteosJornada | null;
  en: Date | null;
  cerrada: boolean;
}

/**
 * Resumen automático del grupo Jornada: a lo más uno cada N minutos (15 por
 * defecto; se cambia desde la web o con "⏱ Frecuencia" en el bot), sin sonido y
 * solo si algo cambió; al cerrar la jornada (todos en el DPEI, sin kits pendientes)
 * manda el cierre una vez, con sonido, y deja de mandar ese día.
 */
@Injectable()
export class JornadaResumenService {
  private readonly log = new Logger('JornadaResumen');
  private ultimo: UltimoResumen | null = null;
  private enCurso = false;
  /** Tras un envío fallido, no se reintenta antes de esta hora (Telegram caído no recibe uno por minuto). */
  private reintentarDesde = 0;

  constructor(
    private readonly jornada: JornadaService,
    private readonly telegram: TelegramNotifier,
  ) {}

  // Revisa cada minuto: así un cambio de frecuencia aplica enseguida y el cierre no espera.
  @Cron('* * * * *', { name: 'resumen-jornada', timeZone: 'America/Guayaquil' })
  async cadaMinuto(): Promise<void> {
    // Mismo interruptor que el cron de enlaces: en local está apagado y no escribe al grupo real.
    if (process.env.ENLACES_CRON_ENABLED?.trim().toLowerCase() === 'false') return;
    // Una vuelta lenta (Telegram tarda) no se pisa con la del minuto siguiente: duplicaría el resumen.
    if (this.enCurso) return;
    this.enCurso = true;
    try {
      await this.enviarSiCambio();
    } catch (e) {
      this.log.error(`No se pudo armar el resumen automático de la jornada: ${(e as Error)?.message ?? e}`);
    } finally {
      this.enCurso = false;
    }
  }

  async enviarSiCambio(ahora = new Date()): Promise<void> {
    const chat = process.env.TELEGRAM_CHAT_ID_JORNADA?.trim();
    if (!chat || !esChatJornada(chat)) return;
    if (ahora.getTime() < this.reintentarDesde) return;
    const jornada = await this.jornada.cargar(ahora.getTime());
    if (!jornada || !jornadaEmpezada(jornada)) return;

    const dia = diaDeJornada(ahora).fecha;
    // Otro día u otro evento activo: se empieza de cero (los "+N" no comparan eventos distintos).
    if (this.ultimo?.dia !== dia || this.ultimo.evento !== jornada.evento) {
      this.ultimo = { dia, evento: jornada.evento, conteos: null, en: null, cerrada: false };
    }
    if (this.ultimo.cerrada) return;

    const conteos = conteosJornada(jornada);
    const cerrada = jornadaCerrada(jornada);
    if (!cerrada && this.ultimo.conteos && mismosConteos(conteos, this.ultimo.conteos)) return;
    // El cierre sale apenas ocurre; los resúmenes, cuando pasó la frecuencia elegida desde el último.
    if (!cerrada && this.ultimo.en && ahora.getTime() - this.ultimo.en.getTime() < (await this.jornada.minutosResumen()) * 60_000) {
      return;
    }

    const anterior = this.ultimo.conteos && this.ultimo.en ? { conteos: this.ultimo.conteos, en: this.ultimo.en } : null;
    // El cierre suena solo si se vio la jornada en curso; al arrancar ya cerrada (reinicio) puede haberse mandado antes.
    const conSonido = cerrada && anterior !== null;
    const enviado = await this.telegram.responderEn(chat, () =>
      this.telegram.enviarHtml(
        formatearResumenAutomatico(jornada, ahora, anterior),
        cerrada ? 'el cierre de la jornada' : 'el resumen automático de la jornada',
        tecladoResumenAutomatico(),
        // Los resúmenes no suenan; el cierre sí.
        { silencioso: !conSonido },
      ),
    );
    // Si Telegram no lo recibió, se vuelve a intentar pasados unos minutos (también el cierre).
    if (enviado) this.ultimo = { ...this.ultimo, conteos, en: ahora, cerrada };
    else this.reintentarDesde = ahora.getTime() + ESPERA_TRAS_FALLO_MS;
  }
}
