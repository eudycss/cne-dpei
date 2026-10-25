import { Module } from '@nestjs/common';
import { PermisosModulosController } from './permisos-modulos.controller';
import { PermisosModulosService } from './permisos-modulos.service';
import { ModuloGuard } from './modulo.guard';
import { PermisoGuard } from './permiso.guard';

@Module({
  controllers: [PermisosModulosController],
  providers: [PermisosModulosService, ModuloGuard, PermisoGuard],
  exports: [PermisosModulosService, ModuloGuard, PermisoGuard],
})
export class PermisosModulosModule {}
