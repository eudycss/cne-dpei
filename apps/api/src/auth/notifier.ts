import { Injectable, Logger } from '@nestjs/common';

/**
 * Notifier abstracto. En Fase 1 imprime los mensajes en consola.
 * Cuando entre SMTP/FCM se sustituye la implementación vía DI.
 */
export interface INotifier {
  sendPasswordResetLink(email: string, link: string): Promise<void>;
  sendInitialPassword(email: string, password: string): Promise<void>;
}

export const NOTIFIER = 'NOTIFIER';

@Injectable()
export class ConsoleNotifier implements INotifier {
  private readonly log = new Logger('ConsoleNotifier');

  async sendPasswordResetLink(email: string, link: string): Promise<void> {
    this.log.warn(`[PASSWORD RESET] ${email}  →  ${link}`);
  }

  async sendInitialPassword(email: string, password: string): Promise<void> {
    this.log.warn(`[INITIAL PASSWORD] ${email}  →  ${password}`);
  }
}
