import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  ConfigAlertas,
  CreateEventoRequest,
  UpdateEventoRequest,
} from '@cne/shared-types';

import { EventosService } from './eventos.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import {
  configAlertasSchema,
  closeEventoSchema,
  reopenEventoSchema,
} from '@cne/shared-validation';

@ApiTags('eventos')
@ApiBearerAuth()
@Controller('eventos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EventosController {
  constructor(private readonly eventos: EventosService) {}

  @Get()
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'LECTOR')
  @ApiOperation({ summary: 'HU20: listar eventos electorales' })
  list() {
    return this.eventos.list();
  }

  @Get('active')
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'LECTOR')
  @ApiOperation({ summary: 'Evento electoral activo actual' })
  active() {
    return this.eventos.getActive();
  }

  @Get(':id')
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'LECTOR')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventos.get(id);
  }

  @Post()
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'HU20-CA1: crear evento (estado BORRADOR)' })
  create(@Body() body: CreateEventoRequest) {
    return this.eventos.create(body);
  }

  @Patch(':id')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Editar evento (solo BORRADOR)' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateEventoRequest) {
    return this.eventos.update(id, body);
  }

  @Post(':id/activate')
  @Roles('ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'HU20-CA2: activar evento (único activo)' })
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventos.activate(id);
  }

  @Post(':id/close')
  @Roles('ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'HU20-CA6/CA7: cerrar evento' })
  close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(closeEventoSchema))
    body: { confirmar: boolean; justificacion?: string },
  ) {
    return this.eventos.close(id, body.confirmar, body.justificacion);
  }

  @Post(':id/reopen')
  @Roles('ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reabrir un evento cerrado solo para consulta' })
  reopen(
    @Param('id', ParseUUIDPipe) id: string,
    // Se valida aquí para que la justificación sea obligatoria; el servicio no
    // la usa: la guarda la bitácora (EVENTO_REOPEN).
    @Body(new ZodValidationPipe(reopenEventoSchema)) _body: { justificacion: string },
  ) {
    return this.eventos.reopen(id);
  }

  @Patch(':id/config-alertas')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'HU18-CA6: configurar umbrales de alertas' })
  configAlertas(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(configAlertasSchema)) body: ConfigAlertas,
  ) {
    return this.eventos.updateConfigAlertas(id, body);
  }
}
