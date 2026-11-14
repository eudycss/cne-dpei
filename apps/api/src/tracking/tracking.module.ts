import { Module } from '@nestjs/common';
import { AlertasModule } from '../alertas/alertas.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { EnlacesModule } from '../enlaces/enlaces.module';
import { EstadisticasJornadaService } from './estadisticas-jornada.service';
import { InformeOperadorService } from './informe-operador.service';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';

@Module({
  imports: [NotificationsModule, AlertasModule, EnlacesModule],
  controllers: [TrackingController],
  providers: [TrackingService, InformeOperadorService, EstadisticasJornadaService],
})
export class TrackingModule {}
