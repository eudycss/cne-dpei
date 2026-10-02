import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import type { NextFunction, Request, Response } from 'express';

/**
 * Límite general del cuerpo JSON (el mismo que trae Express por defecto).
 * Las fotos viajan como multipart en casi todos los endpoints.
 */
export const LIMITE_JSON_GENERAL = '100kb';

/**
 * POST /incidencias recibe la foto como base64 dentro del JSON. La foto
 * decodificada puede pesar hasta 8 MB (tope de StorageService); en base64
 * ocupa ~4/3 de eso, más el resto del cuerpo.
 */
export const LIMITE_JSON_INCIDENCIAS = '12mb';

/**
 * Registra los parsers de cuerpo. Requiere crear la app con
 * `bodyParser: false` para que Nest no registre los suyos antes que estos.
 * El parser de POST /incidencias va primero: una vez que consume el cuerpo,
 * el parser general lo deja pasar sin volver a leerlo.
 */
export function configurarBodyParsers(app: NestExpressApplication): void {
  const jsonIncidencias = json({ limit: LIMITE_JSON_INCIDENCIAS });
  // El parser corre antes de los guards: solo POST /incidencias con token
  // Bearer recibe el límite amplio. Sin token cae al de 100 KB (413 si es
  // grande; si es pequeño, el guard responde 401).
  app.use('/incidencias', (req: Request, res: Response, next: NextFunction) => {
    const esCrear = req.method === 'POST' && (req.path === '/' || req.path === '');
    const conToken = /^Bearer\s+\S+/i.test(req.headers.authorization ?? '');
    if (esCrear && conToken) return jsonIncidencias(req, res, next);
    next();
  });
  app.use(json({ limit: LIMITE_JSON_GENERAL }));
  app.use(urlencoded({ extended: true, limit: LIMITE_JSON_GENERAL }));
}
