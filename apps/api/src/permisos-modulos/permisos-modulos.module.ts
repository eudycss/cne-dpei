import { Global, Module } from '@nestjs/common';
import { PermisosModulosController } from './permisos-modulos.controller';
import { PermisosModulosService } from './permisos-modulos.service';
import { ModuloGuard } from './modulo.guard';
import { PermisoGuard } from './permiso.guard';

// Global: RolesGuard (en casi todos los controllers) consulta la matriz de módulos.
@Global()
@Module({
  controllers: [PermisosModulosController],
  providers: [PermisosModulosService, ModuloGuard, PermisoGuard],
  exports: [PermisosModulosService, ModuloGuard, PermisoGuard],
})
export class PermisosModulosModule {}
