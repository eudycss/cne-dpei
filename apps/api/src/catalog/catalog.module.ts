import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { RecintosService } from './recintos.service';

@Module({
  controllers: [CatalogController],
  providers: [RecintosService],
  exports: [RecintosService],
})
export class CatalogModule {}
