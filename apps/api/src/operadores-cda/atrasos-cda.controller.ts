import { Body, Controller, Get, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { configAsistenciaCdaSchema } from '@cne/shared-validation';
import type { ConfigAsistenciaCda } from '@cne/shared-types';

import { AtrasosCdaService } from './atrasos-cda.service';
import { LIMITE_DESCARGA_REPORTE, enviarReporte } from './reporte-cda';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';

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
  @ApiOperation({ summary: 'Hora oficial de entrada y minutos de gracia' })
  config() {
    return this.atrasos.getConfig();
  }

  @Put('config')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Cambia la hora oficial de entrada y los minutos de gracia' })
  guardarConfig(@Body(new ZodValidationPipe(configAsistenciaCdaSchema)) body: ConfigAsistenciaCda) {
    return this.atrasos.guardarConfig(body);
  }

  @Get('atrasos')
  @ApiOperation({ summary: 'Puntuales, atrasos y faltas por operador y día (desde/hasta AAAA-MM-DD)' })
  reporte(@Query('desde') desde?: unknown, @Query('hasta') hasta?: unknown) {
    return this.atrasos.reporte(texto(desde), texto(hasta));
  }

  @Get('atrasos.xlsx')
  @Throttle(LIMITE_DESCARGA_REPORTE)
  @ApiOperation({ summary: 'Excel de atrasos (desde/hasta AAAA-MM-DD, modo GENERAL o POR_DIA: una hoja por día)' })
  async exportar(@Res() res: Response, @Query() q: Record<string, unknown>) {
    enviarReporte(res, await this.atrasos.exportar(texto(q.desde), texto(q.hasta), q.modo, 'xlsx'));
  }

  @Get('atrasos.pdf')
  @Throttle(LIMITE_DESCARGA_REPORTE)
  @ApiOperation({ summary: 'PDF de atrasos (desde/hasta AAAA-MM-DD, modo GENERAL o POR_DIA: una sección por día)' })
  async exportarPdf(@Res() res: Response, @Query() q: Record<string, unknown>) {
    enviarReporte(res, await this.atrasos.exportar(texto(q.desde), texto(q.hasta), q.modo, 'pdf'));
  }
}
