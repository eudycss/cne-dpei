import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { RecintosService } from './recintos.service';
import { RecintosSheetClient } from './recintos-sheet.client';
import { RecintosSyncService } from './recintos-sync.service';
import { TiposEventoService } from './tipos-evento.service';

@Module({
  controllers: [CatalogController],
  providers: [RecintosService, TiposEventoService, RecintosSheetClient, RecintosSyncService],
  exports: [RecintosService, TiposEventoService],
})
export class CatalogModule {}
