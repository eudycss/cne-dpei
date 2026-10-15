import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { DistributivoTecnicosClient } from './distributivo-tecnicos.client';
import { EncargadosRecintosClient } from './encargados-recintos.client';
import { EnlacesController } from './enlaces.controller';
import { EnlacesEscalamientoService } from './enlaces-escalamiento.service';
import { EnlacesEstadisticasService } from './enlaces-estadisticas.service';
import { EnlacesService } from './enlaces.service';
import { SheetsEnlacesClient } from './sheets-enlaces.client';
import { TelegramNotifier } from './telegram-notifier';

@Module({
  imports: [NotificationsModule],
  controllers: [EnlacesController],
  providers: [
    EnlacesService,
    EnlacesEstadisticasService,
    EnlacesEscalamientoService,
    EncargadosRecintosClient,
    SheetsEnlacesClient,
    DistributivoTecnicosClient,
    TelegramNotifier,
  ],
  exports: [EnlacesService],
})
export class EnlacesModule {}
