import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import * as path from 'node:path';

import { PrismaModule } from './db/prisma.module';
import { AuditInterceptor } from './common/audit.interceptor';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { CatalogModule } from './catalog/catalog.module';
import { MilitaresModule } from './militares/militares.module';
import { EventosModule } from './eventos/eventos.module';
import { AsignacionesModule } from './asignaciones/asignaciones.module';
import { KitsModule } from './kits/kits.module';
import { StorageModule } from './storage/storage.module';
import { TrackingModule } from './tracking/tracking.module';
import { NotificationsModule } from './notifications/notifications.module';
import { IncidenciasModule } from './incidencias/incidencias.module';
import { AlertasModule } from './alertas/alertas.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.resolve(process.cwd(), '.env'),
        path.resolve(process.cwd(), '../../.env'),
      ],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined
            : { target: 'pino-pretty', options: { singleLine: true } },
        redact: ['req.headers.authorization', 'req.headers.cookie'],
      },
    }),
    ScheduleModule.forRoot(),
    // Límite global por IP; solo para frenar abuso/DoS, no tráfico normal.
    // Varios operadores pueden compartir una misma IP (red de un CDA, NAT de
    // datos móviles) haciendo tracking/polling simultáneo, así que se deja
    // holgado — los endpoints públicos sensibles (login, forgot-password)
    // usan @Throttle con límites mucho más estrictos en su propio controller.
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60_000,
        limit: 1000,
      },
    ]),
    PrismaModule,
    AuthModule,
    UsersModule,
    RolesModule,
    CatalogModule,
    MilitaresModule,
    EventosModule,
    AsignacionesModule,
    KitsModule,
    StorageModule,
    NotificationsModule,
    TrackingModule,
    IncidenciasModule,
    AlertasModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AuditInterceptor,
    },
  ],
})
export class AppModule {}
