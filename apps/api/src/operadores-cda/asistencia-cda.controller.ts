import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import {
  corregirAsistenciaCdaSchema,
  marcarAsistenciaCdaMasivaSchema,
  marcarAsistenciaCdaSchema,
  tipoMarcaAsistenciaCdaSchema,
} from '@cne/shared-validation';
import type {
  CorregirAsistenciaCdaRequest,
  MarcarAsistenciaCdaMasivaRequest,
  MarcarAsistenciaCdaRequest,
  TipoMarcaAsistenciaCda,
} from '@cne/shared-types';

import { AsistenciaCdaService } from './asistencia-cda.service';
import { parsearGrupo } from './grupo-cda';
import { LIMITE_DESCARGA_REPORTE, enviarReporte } from './reporte-cda';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { CurrentUser, type AuthenticatedUser } from '../common/current-user.decorator';
import { PermisoGuard, RequierePermiso } from '../permisos-modulos/permiso.guard';
import { ModuloGuard, RequiereModulo } from '../permisos-modulos/modulo.guard';

/** Solo texto: un parámetro repetido (?fecha=a&fecha=b) llega como arreglo. */
const texto = (v: unknown) => (typeof v === 'string' ? v : undefined);

// Toman asistencia el administrador, los técnicos supervisores y los técnicos
// de enlaces (Asistente Electoral Transversal). La APK usará estos mismos endpoints.
@ApiTags('operadores-cda')
@ApiBearerAuth()
@Controller('operadores-cda')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
export class AsistenciaCdaController {
  constructor(private readonly asistencia: AsistenciaCdaService) {}

  @Get('asistencia')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @ApiOperation({
    summary: 'Asistencia de todos los operadores (o los del cargo de ?grupo=) en un día (por defecto hoy, hora de Ecuador)',
  })
  dia(@Query('fecha') fecha?: unknown, @Query('grupo') grupo?: unknown) {
    return this.asistencia.dia(texto(fecha), parsearGrupo(grupo));
  }

  @Get('asistencia/exportar.xlsx')
  @RequierePermiso('cda.asistencia.exportar')
  @UseGuards(PermisoGuard)
  @Throttle(LIMITE_DESCARGA_REPORTE)
  @ApiOperation({ summary: 'Excel de asistencia (desde/hasta AAAA-MM-DD, modo GENERAL o POR_DIA: una hoja por día)' })
  async exportar(@Res() res: Response, @Query() q: Record<string, unknown>) {
    enviarReporte(res, await this.asistencia.exportar(texto(q.desde), texto(q.hasta), q.modo, 'xlsx', parsearGrupo(q.grupo)));
  }

  @Get('asistencia/exportar.pdf')
  @RequierePermiso('cda.asistencia.exportar')
  @UseGuards(PermisoGuard)
  @Throttle(LIMITE_DESCARGA_REPORTE)
  @ApiOperation({ summary: 'PDF de asistencia (desde/hasta AAAA-MM-DD, modo GENERAL o POR_DIA: una sección por día)' })
  async exportarPdf(@Res() res: Response, @Query() q: Record<string, unknown>) {
    enviarReporte(res, await this.asistencia.exportar(texto(q.desde), texto(q.hasta), q.modo, 'pdf', parsearGrupo(q.grupo)));
  }

  @Post('asistencia/masiva')
  @RequierePermiso('cda.asistencia.marcar')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Marca entrada o salida de hoy a varios operadores' })
  masiva(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(marcarAsistenciaCdaMasivaSchema)) body: MarcarAsistenciaCdaMasivaRequest,
  ) {
    return this.asistencia.marcarMasiva(body.tipo, body.operadorIds, user.sub);
  }

  @Post(':id/asistencia')
  @RequierePermiso('cda.asistencia.marcar')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Marca la entrada o la salida de hoy de un operador' })
  marcar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(marcarAsistenciaCdaSchema)) body: MarcarAsistenciaCdaRequest,
  ) {
    return this.asistencia.marcar(id, body.tipo, user.sub);
  }

  // Días pasados: de fábrica solo el administrador (ver PERMISOS). El AET no pasa por @Roles.
  @Put(':id/asistencia/:fecha')
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  @RequierePermiso('cda.asistencia.corregir')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Corrige la entrada y la salida de un día pasado (horas HH:MM de Ecuador, motivo obligatorio)' })
  corregir(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('fecha') fecha: string,
    @Body(new ZodValidationPipe(corregirAsistenciaCdaSchema)) body: CorregirAsistenciaCdaRequest,
  ) {
    return this.asistencia.corregir(id, fecha, body, user.sub);
  }

  @Delete(':id/asistencia/:tipo')
  @RequierePermiso('cda.asistencia.marcar')
  @UseGuards(PermisoGuard)
  @ApiOperation({
    summary: 'Quita la entrada o la salida de hoy (corrección). ?marcaEn=ISO: solo si sigue siendo esa marca',
  })
  deshacer(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('tipo', new ZodValidationPipe(tipoMarcaAsistenciaCdaSchema)) tipo: TipoMarcaAsistenciaCda,
    @Query('marcaEn') marcaEn?: unknown,
  ) {
    return this.asistencia.deshacer(id, tipo, texto(marcaEn));
  }
}
