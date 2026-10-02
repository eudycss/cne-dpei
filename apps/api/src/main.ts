import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { ZodValidationExceptionFilter } from './common/zod-validation.filter';
import { parseOriginPatterns, parseWebOrigins } from './common/web-origin.util';
import { configurarBodyParsers } from './common/body-parsers';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));
  configurarBodyParsers(app);

  app.use(helmet());

  const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
  app.enableCors({
    // Orígenes exactos (WEB_ORIGIN) + comodines opcionales (WEB_ORIGIN_PATTERNS),
    // p. ej. los previews de Vercel. Sin WEB_ORIGIN_PATTERNS no cambia nada.
    origin: [...parseWebOrigins(webOrigin), ...parseOriginPatterns(process.env.WEB_ORIGIN_PATTERNS)],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new ZodValidationExceptionFilter());

  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('CNE Imbabura — API')
      .setDescription('Sistema de Trazabilidad y Logística Electoral')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    const doc = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, doc);
  }

  const port = Number(process.env.API_PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}  (docs: /api/docs)`);
}

bootstrap();
