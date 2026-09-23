import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class TelegramNotifier {
  private readonly log = new Logger('TelegramNotifier');

  async enviarEnlaceCaido(codigoRecinto: string, nombreRecinto: string): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      this.log.warn(
        'TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID no configurados — se omite el aviso a Telegram',
      );
      return;
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `🔴 Enlace caído: ${codigoRecinto} — ${nombreRecinto}`,
        }),
      });
      if (!res.ok) {
        this.log.error(`Telegram respondió ${res.status} al enviar aviso de enlace caído`);
      }
    } catch (e) {
      this.log.error(`Error enviando aviso a Telegram: ${e}`);
    }
  }
}
