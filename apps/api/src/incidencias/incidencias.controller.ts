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
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  CreateIncidenciaRequest,
  UpdateEstadoIncidenciaRequest,
} from '@cne/shared-types';
import {
  createIncidenciaSchema,
  updateEstadoIncidenciaSchema,
} from '@cne/shared-validation';

import { IncidenciasService } from './incidencias.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthenticatedUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';

@ApiTags('incidencias')
@ApiBearerAuth()
@Controller('incidencias')
@UseGuards(JwtAuthGuard, RolesGuard)
export class IncidenciasController {
  constructor(private readonly incidencias: IncidenciasService) {}

  @Post()
  @Roles('OPERADOR_CDA')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'HU14-CA1: reportar una incidencia desde el operador' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createIncidenciaSchema)) body: CreateIncidenciaRequest,
  ) {
    return this.incidencias.create(user.sub, body);
  }

  @Get()
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  @ApiOperation({ summary: 'HU14-CA2: listar incidencias con filtros opcionales (estado, eventoId)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('estado') estado?: string,
    @Query('eventoId') eventoId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.incidencias.list({
      viewerId: user.sub,
      roles: user.roles,
      estado,
      eventoId,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    });
  }

  @Get('mias')
  @Roles('OPERADOR_CDA')
  @ApiOperation({ summary: 'HU14: listar las incidencias reportadas por el operador autenticado' })
  listMias(
    @CurrentUser() user: AuthenticatedUser,
    @Query('estado') estado?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.incidencias.listMias({
      operadorId: user.sub,
      estado,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
    });
  }

  @Get(':id')
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  @ApiOperation({ summary: 'HU14-CA3: detalle de una incidencia con comentarios' })
  findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.incidencias.findOne(id, user.sub, user.roles);
  }

  @Patch(':id/estado')
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  @ApiOperation({ summary: 'HU14-CA4: cambiar estado de incidencia (ATENDIDA | CERRADA)' })
  updateEstado(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateEstadoIncidenciaSchema)) body: UpdateEstadoIncidenciaRequest,
  ) {
    return this.incidencias.updateEstado(id, user.sub, user.roles, body);
  }

  @Get(':id/foto')
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  @ApiOperation({ summary: 'HU14: foto adjunta a la incidencia (descifrada)' })
  async foto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, contentType } = await this.incidencias.obtenerFoto(id, user.sub, user.roles);
    res.set({ 'Content-Type': contentType });
    return new StreamableFile(buffer);
  }

  @Get(':id/comentarios')
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  @ApiOperation({ summary: 'HU14-CA5: listar comentarios de una incidencia' })
  listComentarios(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.incidencias.listComentarios(id, user.sub, user.roles);
  }
}
