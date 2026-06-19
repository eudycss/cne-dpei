import { Module } from '@nestjs/common';
import { IncidenciasController } from './incidencias.controller';
import { IncidenciasService } from './incidencias.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [IncidenciasController],
  providers: [IncidenciasService],
})
export class IncidenciasModule {}
