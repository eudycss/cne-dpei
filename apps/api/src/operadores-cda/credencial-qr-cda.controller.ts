import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { consultarQrCdaSchema, emitirCarnetsCdaSchema, marcarQrCdaSchema } from '@cne/shared-validation';
import type { ConsultarQrCdaRequest, EmitirCarnetsCdaRequest, MarcarQrCdaRequest } from '@cne/shared-types';

import { CredencialQrCdaService } from './credencial-qr-cda.service';
import { LIMITE_DESCARGA_REPORTE } from './reporte-cda';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { CurrentUser, type AuthenticatedUser } from '../common/current-user.decorator';
import { enviarPdf } from '../common/pdf';

// Una fila de 100 personas en 10 min son ~20 escaneos por minuto (consulta + marca);
// el límite deja holgura y frena a quien pruebe códigos.
const LIMITE_ESCANEO = { default: { limit: 120, ttl: 60_000 } };

// Escanean los mismos roles que toman asistencia; emitir o anular carnets solo el administrador.
@ApiTags('operadores-cda')
@ApiBearerAuth()
@Controller('operadores-cda')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
export class CredencialQrCdaController {
  constructor(private readonly credenciales: CredencialQrCdaService) {}

  @Post('asistencia/qr/consultar')
  @HttpCode(200)
  @Throttle(LIMITE_ESCANEO)
  @ApiOperation({ summary: 'A quién pertenece un carnet y qué marca toca hoy (no marca nada)' })
  consultar(@Body(new ZodValidationPipe(consultarQrCdaSchema)) body: ConsultarQrCdaRequest) {
    return this.credenciales.consultar(body.token);
  }

  @Post('asistencia/qr')
  @Throttle(LIMITE_ESCANEO)
  @ApiOperation({ summary: 'Registra la entrada o la salida de hoy confirmada tras escanear el carnet' })
  marcar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(marcarQrCdaSchema)) body: MarcarQrCdaRequest,
  ) {
    return this.credenciales.marcar(body.token, body.tipo, user.sub);
  }

  @Get('credenciales')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Carnets vigentes (operador y fecha de emisión, sin token)' })
  vigentes() {
    return this.credenciales.vigentes();
  }

  @Post('credenciales/carnets.pdf')
  @Roles('ADMINISTRADOR')
  @Throttle(LIMITE_DESCARGA_REPORTE)
  @ApiOperation({ summary: 'Emite carnets QR nuevos (anula los anteriores) y devuelve el PDF para imprimir' })
  async carnets(
    @Res() res: Response,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(emitirCarnetsCdaSchema)) body: EmitirCarnetsCdaRequest,
  ) {
    enviarPdf(res, await this.credenciales.carnetsPdf(body.operadorIds, user.sub), 'carnets_cda.pdf');
  }

  @Delete(':id/credencial')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Anula el carnet vigente (perdido o robado) sin emitir otro' })
  revocar(@Param('id', ParseUUIDPipe) id: string) {
    return this.credenciales.revocar(id);
  }
}
