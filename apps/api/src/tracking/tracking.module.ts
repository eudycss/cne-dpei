import { Module } from '@nestjs/common';
import { AlertasModule } from '../alertas/alertas.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';

@Module({
  imports: [NotificationsModule, AlertasModule],
  controllers: [TrackingController],
  providers: [TrackingService],
})
export class TrackingModule {}
