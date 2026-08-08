import { Injectable, Logger } from '@nestjs/common';

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

@Injectable()
export class BrevoNotifier implements INotifier {
  private readonly log = new Logger('BrevoNotifier');
  private readonly apiKey: string;
  private readonly fromEmail: string;
  private readonly fromName: string;

  constructor() {
    this.apiKey = process.env.BREVO_API_KEY!;
    this.fromEmail = process.env.BREVO_FROM_EMAIL ?? 'euddyk@gmail.com';
    this.fromName = process.env.BREVO_FROM_NAME ?? 'CNE Imbabura';
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: { name: this.fromName, email: this.fromEmail },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Brevo ${res.status}: ${body}`);
    }
  }

  async sendPasswordResetLink(email: string, link: string): Promise<void> {
    await this.send(
      email,
      'Restablecimiento de contraseña - CNE Imbabura',
      `<p>Para restablecer tu contraseña haz clic aquí:</p><p><a href="${link}">${link}</a></p>`,
    );
    this.log.log(`[PASSWORD RESET] correo enviado a ${email}`);
  }

  async sendInitialPassword(email: string, password: string): Promise<void> {
    await this.send(
      email,
      'Tu contraseña temporal - CNE Imbabura',
      `
        <h2>CNE Imbabura — Acceso al sistema</h2>
        <p>El administrador ha restablecido tu contraseña. Tus credenciales temporales son:</p>
        <p><strong>Contraseña temporal:</strong> <code style="font-size:16px">${password}</code></p>
        <p>Deberás cambiarla en tu primer inicio de sesión.</p>
        <p style="color:#888;font-size:12px">Si no solicitaste este cambio, contacta al administrador.</p>
      `,
    );
    this.log.log(`[INITIAL PASSWORD] correo enviado a ${email}`);
  }
}

export function resolveNotifier(): INotifier {
  if (process.env.BREVO_API_KEY) {
    return new BrevoNotifier();
  }
  const log = new Logger('Notifier');
  const msg = 'BREVO_API_KEY no configurada — usando ConsoleNotifier (los correos de recuperación NO llegan a los usuarios, solo quedan en los logs)';
  // En producción esto es un error operativo, no una advertencia de desarrollo:
  // un usuario bloqueado que pide recuperar su contraseña no recibirá nada.
  if (process.env.NODE_ENV === 'production') {
    log.error(msg);
  } else {
    log.warn(msg);
  }
  return new ConsoleNotifier();
}
