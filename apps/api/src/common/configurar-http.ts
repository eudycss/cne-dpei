import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

import { ZodValidationExceptionFilter } from './zod-validation.filter';
import { configurarBodyParsers } from './body-parsers';
import { TRUST_PROXY } from './trust-proxy';

/**
 * Configuración HTTP común: la usan main.ts y las pruebas de endpoints
 * (`*.http.spec.ts`), para que lo que se prueba sea lo mismo que corre en
 * producción (parsers, helmet, pipes y filtros). La app se crea con
 * `bodyParser: false` (ver configurarBodyParsers).
 */
export function configurarHttp(app: NestExpressApplication): void {
  configurarBodyParsers(app);

  app.use(helmet());

  // En Render la petición llega por Cloudflare y un proxy local: sin esto req.ip
  // no es la del cliente (bitácora) y los límites por IP (@Throttle del login y
  // de la página pública de foto) se comparten entre usuarios. Ver trust-proxy.ts.
  app.set('trust proxy', TRUST_PROXY);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new ZodValidationExceptionFilter());
}
