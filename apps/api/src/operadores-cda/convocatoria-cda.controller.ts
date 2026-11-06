import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { GuardarConvocatoriaCdaRequest } from '@cne/shared-types';
import { guardarConvocatoriaCdaSchema } from '@cne/shared-validation';

import { ConvocatoriaCdaService } from './convocatoria-cda.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthenticatedUser } from '../common/current-user.decorator';
import { PermisoGuard, RequierePermiso } from '../permisos-modulos/permiso.guard';
import { ModuloGuard, RequiereModulo } from '../permisos-modulos/modulo.guard';

/** Solo texto: un parámetro repetido (?fecha=a&fecha=b) llega como arreglo. */
const texto = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** Convocatoria del día (personal CDA y CPE): la ve quien ve el módulo; la cambia quien tiene el permiso. */
@ApiTags('operadores-cda')
@ApiBearerAuth()
@Controller('operadores-cda')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
export class ConvocatoriaCdaController {
  constructor(private readonly convocatoria: ConvocatoriaCdaService) {}

  @Get('convocatoria')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @ApiOperation({ summary: 'Convocatoria de un día (?fecha=AAAA-MM-DD): todo el personal y quién está convocado' })
  dia(@Query('fecha') fecha?: unknown) {
    return this.convocatoria.dia(texto(fecha));
  }

  @Put('convocatoria/:fecha')
  @RequierePermiso('cda.convocatoria.gestionar')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Guardar los convocados a mano de un día (los de Parejas cuentan solos)' })
  guardar(
    @Param('fecha') fecha: string,
    @Body(new ZodValidationPipe(guardarConvocatoriaCdaSchema)) body: GuardarConvocatoriaCdaRequest,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.convocatoria.guardar(fecha, body, user?.sub);
  }
}
