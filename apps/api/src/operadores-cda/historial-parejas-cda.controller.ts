import { BadRequestException, Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { fechasHistorialParejasCdaSchema } from '@cne/shared-validation';

import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { ModuloGuard, RequiereModulo } from '../permisos-modulos/modulo.guard';
import { HistorialParejasCdaService } from './historial-parejas-cda.service';
import { LIMITE_DESCARGA_REPORTE, enviarReporte } from './reporte-cda';

/** ?fechas= (una o repetida, AAAA-MM-DD). */
export function parsearFechas(v: unknown): string[] {
  const r = fechasHistorialParejasCdaSchema.safeParse(v);
  if (!r.success) throw new BadRequestException(r.error.issues[0]?.message ?? 'Elija al menos una fecha');
  return r.data;
}

/** Historial de parejas (mismos roles que la lista de parejas). */
@ApiTags('parejas-cda')
@ApiBearerAuth()
@Controller('parejas-cda/historial')
@UseGuards(JwtAuthGuard, RolesGuard)
export class HistorialParejasCdaController {
  constructor(private readonly historial: HistorialParejasCdaService) {}

  @Get()
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
  @ApiOperation({ summary: 'Quién fue y qué recintos CDA se visitaron en las ?fechas= elegidas, con la pareja y el kit' })
  ver(@Query('fechas') fechas: unknown) {
    return this.historial.historial(parsearFechas(fechas));
  }

  @Get('reporte.xlsx')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
  @Throttle(LIMITE_DESCARGA_REPORTE)
  @ApiOperation({ summary: 'Excel del historial de ?fechas=: personal, recintos y kits' })
  async reporteXlsx(@Query('fechas') fechas: unknown, @Res() res: Response) {
    enviarReporte(res, await this.historial.reporte(parsearFechas(fechas), 'xlsx'));
  }

  @Get('reporte.pdf')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
  @Throttle(LIMITE_DESCARGA_REPORTE)
  @ApiOperation({ summary: 'PDF del historial de ?fechas=: personal, recintos y kits' })
  async reportePdf(@Query('fechas') fechas: unknown, @Res() res: Response) {
    enviarReporte(res, await this.historial.reporte(parsearFechas(fechas), 'pdf'));
  }
}
