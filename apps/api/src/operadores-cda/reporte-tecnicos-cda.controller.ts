import { BadRequestException, Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { tecnicosReporteParejasCdaSchema } from '@cne/shared-validation';

import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { ModuloGuard, RequiereModulo } from '../permisos-modulos/modulo.guard';
import { parsearFecha } from './parejas-cda.controller';
import { LIMITE_DESCARGA_REPORTE, enviarReporte } from './reporte-cda';
import { ReporteTecnicosCdaService } from './reporte-tecnicos-cda.service';

/** ?tecnicos= (uno o repetido): nombres del distributivo o SIN_TECNICO. */
export function parsearTecnicos(v: unknown): string[] {
  const r = tecnicosReporteParejasCdaSchema.safeParse(v);
  if (!r.success) throw new BadRequestException(r.error.issues[0]?.message ?? 'Elija al menos un técnico');
  return r.data;
}

/** "Reporte por técnico" de la pestaña Parejas (mismos roles que el reporte de parejas). */
@ApiTags('parejas-cda')
@ApiBearerAuth()
@Controller('parejas-cda')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ReporteTecnicosCdaController {
  constructor(private readonly reporte: ReporteTecnicosCdaService) {}

  @Get('tecnicos')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
  @Throttle(LIMITE_DESCARGA_REPORTE)
  @ApiOperation({ summary: 'Técnicos del distributivo con sus recintos y parejas de ?fecha= (y los recintos sin técnico)' })
  tecnicos(@Query('fecha') fecha: unknown) {
    return this.reporte.tecnicos(parsearFecha(fecha));
  }

  @Get('reporte-tecnicos.xlsx')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
  @Throttle(LIMITE_DESCARGA_REPORTE)
  @ApiOperation({ summary: 'Excel por técnico (?tecnicos=): quién ingresa a la app en cada recinto de ?fecha=' })
  async reporteXlsx(@Query('fecha') fecha: unknown, @Query('tecnicos') tecnicos: unknown, @Res() res: Response) {
    enviarReporte(res, await this.reporte.reporte(parsearFecha(fecha), parsearTecnicos(tecnicos), 'xlsx'));
  }

  @Get('reporte-tecnicos.pdf')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
  @Throttle(LIMITE_DESCARGA_REPORTE)
  @ApiOperation({ summary: 'PDF por técnico (?tecnicos=): quién ingresa a la app en cada recinto de ?fecha=' })
  async reportePdf(@Query('fecha') fecha: unknown, @Query('tecnicos') tecnicos: unknown, @Res() res: Response) {
    enviarReporte(res, await this.reporte.reporte(parsearFecha(fecha), parsearTecnicos(tecnicos), 'pdf'));
  }

  @Get('contactos.vcf')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
  @Throttle(LIMITE_DESCARGA_REPORTE)
  @ApiOperation({ summary: 'Contactos (.vcf) de las parejas de ?fecha= de los técnicos elegidos (?tecnicos=)' })
  async contactos(@Query('fecha') fecha: unknown, @Query('tecnicos') tecnicos: unknown, @Res() res: Response) {
    enviarReporte(res, await this.reporte.contactos(parsearFecha(fecha), parsearTecnicos(tecnicos)));
  }
}
