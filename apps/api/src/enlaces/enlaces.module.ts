import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AsistenteService } from './asistente/asistente.service';
import { LlmClient } from './asistente/llm.client';
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
    AsistenteService,
    LlmClient,
  ],
  // El distributivo de técnicos también lo usa el reporte por técnico de Parejas CDA.
  exports: [EnlacesService, DistributivoTecnicosClient],
})
export class EnlacesModule {}
