import pino from 'pino';
import { Writable } from 'stream';
import { CAMPOS_OCULTOS_LOG } from './log-redact';

describe('CAMPOS_OCULTOS_LOG', () => {
  it('oculta credenciales y el secreto del webhook de Telegram en los logs', () => {
    const lineas: string[] = [];
    const destino = new Writable({
      write(chunk, _enc, listo) {
        lineas.push(chunk.toString());
        listo();
      },
    });
    const log = pino({ redact: CAMPOS_OCULTOS_LOG }, destino);

    log.info({
      req: {
        url: '/enlaces/telegram/webhook',
        headers: {
          authorization: 'Bearer token-secreto',
          cookie: 'sesion=abc',
          'x-telegram-bot-api-secret-token': 'secreto-del-webhook',
          host: 'cne-imbabura-api.onrender.com',
        },
      },
    });

    const salida = lineas.join('');
    expect(salida).not.toContain('token-secreto');
    expect(salida).not.toContain('sesion=abc');
    expect(salida).not.toContain('secreto-del-webhook');
    expect(JSON.parse(salida).req.headers['x-telegram-bot-api-secret-token']).toBe('[Redacted]');
    // Lo que no es secreto se sigue viendo.
    expect(salida).toContain('cne-imbabura-api.onrender.com');
  });
});
