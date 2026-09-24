import { Injectable, Logger } from '@nestjs/common';

export interface EnlaceCaido {
  codigoRecinto: string;
  nombreRecinto: string;
}

export interface INotifier {
  sendPasswordResetLink(email: string, link: string): Promise<void>;
  sendInitialPassword(email: string, password: string): Promise<void>;
  sendEnlaceCaido(destinatarios: string[], enlaces: EnlaceCaido[]): Promise<void>;
}

export const NOTIFIER = 'NOTIFIER';

function escapeHtml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Injectable()
export class ConsoleNotifier implements INotifier {
  private readonly log = new Logger('ConsoleNotifier');

  async sendPasswordResetLink(email: string, link: string): Promise<void> {
    this.log.warn(`[PASSWORD RESET] ${email}  →  ${link}`);
  }

  async sendInitialPassword(email: string, password: string): Promise<void> {
    this.log.warn(`[INITIAL PASSWORD] ${email}  →  ${password}`);
  }

  async sendEnlaceCaido(destinatarios: string[], enlaces: EnlaceCaido[]): Promise<void> {
    const detalle = enlaces.map((e) => `${e.codigoRecinto} - ${e.nombreRecinto}`).join('; ');
    this.log.warn(`[ENLACE CAIDO] ${detalle} → ${destinatarios.join(', ')}`);
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

  async sendEnlaceCaido(destinatarios: string[], enlaces: EnlaceCaido[]): Promise<void> {
    const esPlural = enlaces.length > 1;
    const asunto = esPlural
      ? `${enlaces.length} enlaces caídos - CNE Imbabura`
      : `Enlace caído: ${escapeHtml(enlaces[0].codigoRecinto)} - ${escapeHtml(enlaces[0].nombreRecinto)}`;
    const filas = enlaces
      .map((e) => `<li><strong>${escapeHtml(e.codigoRecinto)}</strong> — ${escapeHtml(e.nombreRecinto)}</li>`)
      .join('');
    const html = `
      <h2>CNE Imbabura — Enlace${esPlural ? 's' : ''} caído${esPlural ? 's' : ''}</h2>
      <p>${esPlural ? 'Los siguientes recintos pasaron' : 'El siguiente recinto pasó'} a estado <strong>FALLO</strong>:</p>
      <ul>${filas}</ul>
    `;

    const fallidos: string[] = [];
    for (const to of destinatarios) {
      try {
        await this.send(to, asunto, html);
      } catch (e) {
        fallidos.push(to);
        this.log.error(`Error enviando correo de enlaces caídos a ${to}: ${e}`);
      }
    }
    const enviados = destinatarios.length - fallidos.length;
    this.log.log(`[ENLACE CAIDO] correo enviado a ${enviados}/${destinatarios.length} destinatario(s)`);
    if (fallidos.length > 0) {
      throw new Error(`No se pudo enviar el correo de enlace caído a: ${fallidos.join(', ')}`);
    }
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
