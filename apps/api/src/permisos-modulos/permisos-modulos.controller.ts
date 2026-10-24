import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { actualizarModulosRolSchema, type ModuloWebId } from '@cne/shared-validation';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { CurrentUser, type AuthenticatedUser } from '../common/current-user.decorator';
import { PermisosModulosService } from './permisos-modulos.service';

@ApiTags('permisos-modulos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('permisos-modulos')
export class PermisosModulosController {
  constructor(private readonly permisos: PermisosModulosService) {}

  @Get()
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Ver qué módulos de la web ve cada rol' })
  matriz() {
    return this.permisos.matriz();
  }

  // Sin @Roles: cualquier usuario autenticado consulta sus propios módulos.
  @Get('mios')
  @ApiOperation({ summary: 'Módulos de la web visibles para el usuario actual' })
  misModulos(@CurrentUser() user: AuthenticatedUser) {
    return this.permisos.misModulos(user.roles);
  }

  @Put(':rol')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Cambiar los módulos de la web que ve un rol' })
  actualizar(
    @Param('rol') rol: string,
    @Body(new ZodValidationPipe(actualizarModulosRolSchema)) body: { modulos: ModuloWebId[] },
  ) {
    return this.permisos.actualizar(rol, body.modulos);
  }
}
