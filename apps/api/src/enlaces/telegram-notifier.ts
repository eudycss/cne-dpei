import { Injectable, Logger } from '@nestjs/common';
import type { EnlaceCaido } from '../auth/notifier';

@Injectable()
export class TelegramNotifier {
  private readonly log = new Logger('TelegramNotifier');

  async enviarEnlaceCaido(codigoRecinto: string, nombreRecinto: string): Promise<void> {
    await this.enviarMensaje(
      `🔴 Enlace caído: ${codigoRecinto} — ${nombreRecinto}`,
      'aviso de enlace caído',
    );
  }

  /** Reenvía bajo demanda el estado actual completo (a diferencia de enviarEnlaceCaido,
   * que solo avisa de transiciones nuevas) — para cuando se reconfigura el bot/grupo o
   * se agrega gente y hay que ponerlos al día con lo que ya está caído. */
  async enviarListaActual(enlaces: EnlaceCaido[]): Promise<void> {
    const texto =
      enlaces.length === 0
        ? '✅ No hay enlaces caídos en este momento.'
        : `📋 Enlaces caídos ahora mismo (${enlaces.length}):\n` +
          enlaces.map((e) => `🔴 ${e.codigoRecinto} — ${e.nombreRecinto}`).join('\n');
    await this.enviarMensaje(texto, 'la lista de enlaces caídos');
  }

  private async enviarMensaje(text: string, descripcion: string): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      this.log.warn(
        `TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID no configurados — se omite el envío de ${descripcion}`,
      );
      return;
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!res.ok) {
        this.log.error(`Telegram respondió ${res.status} al enviar ${descripcion}`);
      }
    } catch (e) {
      this.log.error(`Error enviando ${descripcion} a Telegram: ${e}`);
    }
  }
}
