import { Module } from '@nestjs/common';
import { PermisosModulosModule } from '../permisos-modulos/permisos-modulos.module';
import { PerimetroController } from './perimetro.controller';
import { PerimetroService } from './perimetro.service';
import { PerimetroPersonalController } from './perimetro-personal.controller';
import { PerimetroPersonalService } from './perimetro-personal.service';

@Module({
  imports: [PermisosModulosModule],
  controllers: [PerimetroController, PerimetroPersonalController],
  providers: [PerimetroService, PerimetroPersonalService],
})
export class PerimetroModule {}
