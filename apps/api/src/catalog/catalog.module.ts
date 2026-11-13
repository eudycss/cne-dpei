import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { RecintosService } from './recintos.service';
import { RecintosSheetClient } from './recintos-sheet.client';
import { RecintosSyncService } from './recintos-sync.service';
import { ReporteRecintosCdaService } from './reporte-recintos-cda.service';
import { TiposEventoService } from './tipos-evento.service';
import { TiemposViajeService } from './tiempos-viaje.service';

@Module({
  controllers: [CatalogController],
  providers: [RecintosService, TiposEventoService, RecintosSheetClient, RecintosSyncService, TiemposViajeService, ReporteRecintosCdaService],
  exports: [RecintosService, TiposEventoService],
})
export class CatalogModule {}
