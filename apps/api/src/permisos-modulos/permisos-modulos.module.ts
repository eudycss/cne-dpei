import { Module } from '@nestjs/common';
import { PermisosModulosController } from './permisos-modulos.controller';
import { PermisosModulosService } from './permisos-modulos.service';

@Module({
  controllers: [PermisosModulosController],
  providers: [PermisosModulosService],
})
export class PermisosModulosModule {}
