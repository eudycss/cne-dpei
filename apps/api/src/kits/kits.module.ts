import { Module } from '@nestjs/common';
import { KitsController } from './kits.controller';
import { KitsService } from './kits.service';
import { ItemsKitController } from './items-kit.controller';
import { ItemsKitService } from './items-kit.service';
import { MochilasKitController } from './mochilas-kit.controller';
import { MochilasKitService } from './mochilas-kit.service';

@Module({
  controllers: [KitsController, ItemsKitController, MochilasKitController],
  providers: [KitsService, ItemsKitService, MochilasKitService],
  exports: [KitsService],
})
export class KitsModule {}
