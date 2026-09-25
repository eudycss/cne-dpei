import { Module } from '@nestjs/common';
import { KitsController } from './kits.controller';
import { KitsService } from './kits.service';
import { ItemsKitController } from './items-kit.controller';
import { ItemsKitService } from './items-kit.service';

@Module({
  controllers: [KitsController, ItemsKitController],
  providers: [KitsService, ItemsKitService],
})
export class KitsModule {}
