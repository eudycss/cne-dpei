import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { RecintosService } from './recintos.service';
import { TiposEventoService } from './tipos-evento.service';

@Module({
  controllers: [CatalogController],
  providers: [RecintosService, TiposEventoService],
  exports: [RecintosService, TiposEventoService],
})
export class CatalogModule {}
