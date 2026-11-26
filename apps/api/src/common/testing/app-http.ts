import { Test } from '@nestjs/testing';
import type { CanActivate, Provider, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { configurarHttp } from '../configurar-http';

/**
 * App Nest de prueba con los controladores reales y la MISMA configuración
 * HTTP que producción (parsers, helmet, pipes, filtros; ver configurarHttp).
 * Los servicios van como dobles: se prueba el camino HTTP completo —multer,
 * validación Zod, decoradores, cabeceras y códigos— sin base de datos.
 * Es la capa que no cubren los specs de servicio (así se escapó el
 * "Too many parts" del 26-nov).
 *
 * `guards`: guards de @UseGuards a reemplazar (p. ej. sesión simulada en vez
 * de JwtAuthGuard); los reales tienen sus propios specs.
 */
export async function crearAppHttp(
  controllers: Type<unknown>[],
  providers: Provider[],
  guards: [Type<unknown>, CanActivate][] = [],
): Promise<NestExpressApplication> {
  let builder = Test.createTestingModule({ controllers, providers });
  for (const [guard, doble] of guards) builder = builder.overrideGuard(guard).useValue(doble);
  const modulo = await builder.compile();
  const app = modulo.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configurarHttp(app);
  await app.init();
  return app;
}
