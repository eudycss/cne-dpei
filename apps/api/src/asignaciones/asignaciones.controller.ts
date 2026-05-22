import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { UpsertAsignacionRequest } from '@cne/shared-types';
import { upsertAsignacionSchema } from '@cne/shared-validation';

import { AsignacionesService } from './asignaciones.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';

@ApiTags('asignaciones')
@ApiBearerAuth()
@Controller('asignaciones')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AsignacionesController {
  constructor(private readonly asignaciones: AsignacionesService) {}

  @Get()
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  @ApiOperation({ summary: 'HU10: listar asignaciones operador↔supervisor por evento' })
  list(@Query('eventoId', ParseUUIDPipe) eventoId: string) {
    return this.asignaciones.list(eventoId);
  }

  @Put()
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'HU10: crear o actualizar asignación (upsert)' })
  upsert(
    @Body(new ZodValidationPipe(upsertAsignacionSchema)) body: UpsertAsignacionRequest,
  ) {
    return this.asignaciones.upsert(body);
  }

  @Delete(':id')
  @Roles('ADMINISTRADOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'HU10: eliminar asignación' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.asignaciones.remove(id);
  }
}
