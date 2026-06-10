import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { resolveNotifier, NOTIFIER } from '../auth/notifier';

@Module({
  controllers: [UsersController],
  providers: [
    UsersService,
    { provide: NOTIFIER, useFactory: resolveNotifier },
  ],
  exports: [UsersService],
})
export class UsersModule {}
