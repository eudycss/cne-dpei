import { Body, Controller, Get, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { configAsistenciaCdaSchema } from '@cne/shared-validation';
import type { ConfigAsistenciaCda } from '@cne/shared-types';

import { AtrasosCdaService } from './atrasos-cda.service';
import { parsearGrupo } from './grupo-cda';
import { LIMITE_DESCARGA_REPORTE, enviarReporte } from './reporte-cda';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { PermisoGuard, RequierePermiso } from '../permisos-modulos/permiso.guard';
import { ModuloGuard, RequiereModulo } from '../permisos-modulos/modulo.guard';

/** Solo texto: un parámetro repetido (?desde=a&desde=b) llega como arreglo. */
const texto = (v: unknown) => (typeof v === 'string' ? v : undefined);

// Ven el reporte los mismos roles que toman asistencia; la hora oficial solo la cambia el administrador.
@ApiTags('operadores-cda')
@ApiBearerAuth()
@Controller('operadores-cda/asistencia')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
export class AtrasosCdaController {
  constructor(private readonly atrasos: AtrasosCdaService) {}

  @Get('config')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @ApiOperation({ summary: 'Hora oficial de entrada y minutos de gracia del grupo (?grupo=<cargo CDA>)' })
  config(@Query('grupo') grupo?: unknown) {
    return this.atrasos.getConfig(parsearGrupo(grupo));
  }

  @Put('config')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Cambia la hora oficial de entrada y los minutos de gracia del grupo (?grupo=)' })
  guardarConfig(
    @Body(new ZodValidationPipe(configAsistenciaCdaSchema)) body: ConfigAsistenciaCda,
    @Query('grupo') grupo?: unknown,
  ) {
    return this.atrasos.guardarConfig(body, parsearGrupo(grupo));
  }

  @Get('atrasos')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @ApiOperation({ summary: 'Puntuales, atrasos y faltas por operador y día (desde/hasta AAAA-MM-DD)' })
  reporte(@Query('desde') desde?: unknown, @Query('hasta') hasta?: unknown, @Query('grupo') grupo?: unknown) {
    return this.atrasos.reporte(texto(desde), texto(hasta), parsearGrupo(grupo));
  }

  @Get('atrasos.xlsx')
  @RequierePermiso('cda.asistencia.exportar')
  @UseGuards(PermisoGuard)
  @Throttle(LIMITE_DESCARGA_REPORTE)
  @ApiOperation({ summary: 'Excel de atrasos (desde/hasta AAAA-MM-DD, modo GENERAL o POR_DIA: una hoja por día)' })
  async exportar(@Res() res: Response, @Query() q: Record<string, unknown>) {
    enviarReporte(res, await this.atrasos.exportar(texto(q.desde), texto(q.hasta), q.modo, 'xlsx', parsearGrupo(q.grupo)));
  }

  @Get('atrasos.pdf')
  @RequierePermiso('cda.asistencia.exportar')
  @UseGuards(PermisoGuard)
  @Throttle(LIMITE_DESCARGA_REPORTE)
  @ApiOperation({ summary: 'PDF de atrasos (desde/hasta AAAA-MM-DD, modo GENERAL o POR_DIA: una sección por día)' })
  async exportarPdf(@Res() res: Response, @Query() q: Record<string, unknown>) {
    enviarReporte(res, await this.atrasos.exportar(texto(q.desde), texto(q.hasta), q.modo, 'pdf', parsearGrupo(q.grupo)));
  }
}
