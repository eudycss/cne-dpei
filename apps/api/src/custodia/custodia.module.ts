import { Module } from '@nestjs/common';
import { KitsModule } from '../kits/kits.module';
import { CustodiaController } from './custodia.controller';
import { CustodiaService } from './custodia.service';

@Module({
  imports: [KitsModule],
  controllers: [CustodiaController],
  providers: [CustodiaService],
})
export class CustodiaModule {}
