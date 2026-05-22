import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ConsoleNotifier, NOTIFIER } from '../auth/notifier';

@Module({
  controllers: [UsersController],
  providers: [
    UsersService,
    { provide: NOTIFIER, useClass: ConsoleNotifier },
  ],
  exports: [UsersService],
})
export class UsersModule {}
