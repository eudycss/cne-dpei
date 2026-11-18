import { Module } from '@nestjs/common';
import { PermisosModulosModule } from '../permisos-modulos/permisos-modulos.module';
import { PerimetroController } from './perimetro.controller';
import { PerimetroService } from './perimetro.service';

@Module({
  imports: [PermisosModulosModule],
  controllers: [PerimetroController],
  providers: [PerimetroService],
})
export class PerimetroModule {}
