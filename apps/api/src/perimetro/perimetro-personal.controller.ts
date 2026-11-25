import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  candidatosPerimetroSchema,
  propuestaPersonalPerimetroSchema,
  type CandidatosPerimetroInput,
  type PropuestaPersonalPerimetroInput,
} from '@cne/shared-validation';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { RequiereModulo } from '../permisos-modulos/modulo.guard';
import { PermisoGuard, RequierePermiso } from '../permisos-modulos/permiso.guard';
import { PerimetroPersonalService } from './perimetro-personal.service';

/**
 * Personal CDA/CPE para los puestos del plan. Solo para quien edita planes
 * (acción 'perimetro.planes.editar'): de cada persona sale el id y el nombre.
 */
@ApiTags('plan-perimetro')
@ApiBearerAuth()
@Controller('perimetro')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
@RequiereModulo('plan-perimetro')
export class PerimetroPersonalController {
  constructor(private readonly personal: PerimetroPersonalService) {}

  @Get('cargos')
  @RequierePermiso('perimetro.planes.editar')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Cargos CDA/CPE activos, para filtrar el personal' })
  cargos() {
    return this.personal.cargos();
  }

  @Get('planes/:id/candidatos')
  @RequierePermiso('perimetro.planes.editar')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Personal activo que se puede asignar (id y nombre; máx. 100)' })
  candidatos(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(candidatosPerimetroSchema)) q: CandidatosPerimetroInput) {
    return this.personal.candidatos(id, q);
  }

  @Post('planes/:id/propuesta')
  @HttpCode(200)
  @RequierePermiso('perimetro.planes.editar')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Propone personas para los puestos vacíos según el % de mujeres (no guarda nada)' })
  propuesta(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(propuestaPersonalPerimetroSchema)) body: PropuestaPersonalPerimetroInput,
  ) {
    return this.personal.propuesta(id, body);
  }
}
