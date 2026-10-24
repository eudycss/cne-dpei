import { Module } from '@nestjs/common';
import { PermisosModulosController } from './permisos-modulos.controller';
import { PermisosModulosService } from './permisos-modulos.service';
import { ModuloGuard } from './modulo.guard';

@Module({
  controllers: [PermisosModulosController],
  providers: [PermisosModulosService, ModuloGuard],
  exports: [PermisosModulosService, ModuloGuard],
})
export class PermisosModulosModule {}
