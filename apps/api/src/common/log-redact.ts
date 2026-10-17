/**
 * Encabezados que nunca deben quedar en los logs de pino-http (Render los guarda):
 * credenciales de usuarios y el secreto con que Telegram firma el webhook del bot.
 */
export const CAMPOS_OCULTOS_LOG = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-telegram-bot-api-secret-token"]',
];
