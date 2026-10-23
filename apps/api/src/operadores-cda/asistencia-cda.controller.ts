import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import {
  marcarAsistenciaCdaMasivaSchema,
  marcarAsistenciaCdaSchema,
  tipoMarcaAsistenciaCdaSchema,
} from '@cne/shared-validation';
import type {
  MarcarAsistenciaCdaMasivaRequest,
  MarcarAsistenciaCdaRequest,
  TipoMarcaAsistenciaCda,
} from '@cne/shared-types';

import { AsistenciaCdaService } from './asistencia-cda.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { CurrentUser, type AuthenticatedUser } from '../common/current-user.decorator';

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
  @ApiOperation({ summary: 'Asistencia de todos los operadores en un día (por defecto hoy, hora de Ecuador)' })
  dia(@Query('fecha') fecha?: unknown) {
    return this.asistencia.dia(texto(fecha));
  }

  @Get('asistencia/exportar.xlsx')
  @ApiOperation({ summary: 'Excel de asistencia por operador y día (desde/hasta AAAA-MM-DD)' })
  async exportar(@Res() res: Response, @Query('desde') desde?: unknown, @Query('hasta') hasta?: unknown) {
    const buf = await this.asistencia.exportar(texto(desde), texto(hasta));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=asistencia_operadores_cda.xlsx');
    res.send(buf);
  }

  @Post('asistencia/masiva')
  @ApiOperation({ summary: 'Marca entrada o salida de hoy a varios operadores' })
  masiva(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(marcarAsistenciaCdaMasivaSchema)) body: MarcarAsistenciaCdaMasivaRequest,
  ) {
    return this.asistencia.marcarMasiva(body.tipo, body.operadorIds, user.sub);
  }

  @Post(':id/asistencia')
  @ApiOperation({ summary: 'Marca la entrada o la salida de hoy de un operador' })
  marcar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(marcarAsistenciaCdaSchema)) body: MarcarAsistenciaCdaRequest,
  ) {
    return this.asistencia.marcar(id, body.tipo, user.sub);
  }

  @Delete(':id/asistencia/:tipo')
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
