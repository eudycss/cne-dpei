import { Injectable, Logger } from '@nestjs/common';
import type { EnlaceCaido } from '../auth/notifier';

@Injectable()
export class TelegramNotifier {
  private readonly log = new Logger('TelegramNotifier');

  /** Manda siempre el estado COMPLETO de recintos caídos, marcando con 🆕 los que
   * pasaron de ACTIVO a FALLO en este ciclo (si los hay) — nunca un mensaje aislado
   * de un solo recinto, para que el grupo no crea que los demás ya se recuperaron. */
  async enviarListaActual(enlaces: EnlaceCaido[], nuevosCodigos?: Set<string>): Promise<void> {
    const texto =
      enlaces.length === 0
        ? '✅ No hay enlaces caídos en este momento.'
        : `🔴 Enlaces caídos ahora mismo (${enlaces.length}):\n` +
          enlaces
            .map((e) => {
              const prefijo = nuevosCodigos?.has(e.codigoRecinto) ? '🆕 ' : '';
              return `${prefijo}${e.codigoRecinto} — ${e.nombreRecinto}`;
            })
            .join('\n');
    await this.enviarMensaje(texto, 'la lista de enlaces caídos');
  }

  /** Avisa qué recintos volvieron a ACTIVO tras haber estado en FALLO — sin esto,
   * el grupo solo se entera de las caídas y tiene que revisar la web para saber
   * cuándo se recupera un recinto. */
  async enviarRecuperados(enlaces: EnlaceCaido[]): Promise<void> {
    if (enlaces.length === 0) return;
    const texto =
      `✅ Enlaces recuperados (${enlaces.length}):\n` +
      enlaces.map((e) => `${e.codigoRecinto} — ${e.nombreRecinto}`).join('\n');
    await this.enviarMensaje(texto, 'la lista de enlaces recuperados');
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
