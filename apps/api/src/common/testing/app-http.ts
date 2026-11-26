import { Test } from '@nestjs/testing';
import type { Provider, Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { configurarHttp } from '../configurar-http';

/**
 * App Nest de prueba con los controladores reales y la MISMA configuración
 * HTTP que producción (parsers, helmet, pipes, filtros; ver configurarHttp).
 * Los servicios van como dobles: se prueba el camino HTTP completo —multer,
 * validación Zod, decoradores, cabeceras y códigos— sin base de datos.
 * Es la capa que no cubren los specs de servicio (así se escapó el
 * "Too many parts" del 26-nov).
 */
export async function crearAppHttp(controllers: Type<unknown>[], providers: Provider[]): Promise<NestExpressApplication> {
  const modulo = await Test.createTestingModule({ controllers, providers }).compile();
  const app = modulo.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: false });
  configurarHttp(app);
  await app.init();
  return app;
}
