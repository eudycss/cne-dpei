import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { UpdateEstadoAlertaRequest } from '@cne/shared-types';
import { updateEstadoAlertaSchema } from '@cne/shared-validation';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { AlertasService } from './alertas.service';

@ApiTags('alertas')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('alertas')
export class AlertasController {
  constructor(private readonly alertas: AlertasService) {}

  @Get()
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  @ApiOperation({ summary: 'HU18: listar alertas de un evento' })
  list(
    @Query('eventoId') eventoId: string,
    @Query('tipo') tipo?: string,
    @Query('estado') estado?: string,
  ) {
    return this.alertas.list(eventoId, tipo, estado);
  }

  @Patch(':id')
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  @ApiOperation({ summary: 'HU18: marcar alerta como VISTA o ATENDIDA' })
  updateEstado(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateEstadoAlertaSchema)) body: UpdateEstadoAlertaRequest,
  ) {
    return this.alertas.updateEstado(id, body);
  }
}
