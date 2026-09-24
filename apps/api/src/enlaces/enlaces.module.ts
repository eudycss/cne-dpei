import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { EnlacesController } from './enlaces.controller';
import { EnlacesService } from './enlaces.service';
import { SheetsEnlacesClient } from './sheets-enlaces.client';
import { TelegramNotifier } from './telegram-notifier';

@Module({
  imports: [NotificationsModule],
  controllers: [EnlacesController],
  providers: [EnlacesService, SheetsEnlacesClient, TelegramNotifier],
  exports: [EnlacesService],
})
export class EnlacesModule {}
