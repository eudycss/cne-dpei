import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { descargarActasCdaSchema, generarActasCdaSchema } from '@cne/shared-validation';
import type { GenerarActasCdaRequest } from '@cne/shared-types';

import { ActasCdaService, type ArchivoActa } from './actas-cda.service';
import { parsearGrupo } from './grupo-cda';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { CurrentUser, type AuthenticatedUser } from '../common/current-user.decorator';
import { PermisoGuard, RequierePermiso } from '../permisos-modulos/permiso.guard';
import { ModuloGuard, RequiereModulo } from '../permisos-modulos/modulo.guard';

// Generar documentos cuesta CPU (Render: 0.1 vCPU). Holgado para el uso normal, corta los abusos.
const LIMITE_DESCARGA = { default: { limit: 30, ttl: 60_000 } };
const LIMITE_ZIP = { default: { limit: 4, ttl: 60_000 } };

const TIPOS = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  zip: 'application/zip',
} as const;

function enviar(res: Response, archivo: ArchivoActa, tipo: keyof typeof TIPOS): void {
  res.setHeader('Content-Type', TIPOS[tipo]);
  res.setHeader('Content-Disposition', `attachment; filename="${archivo.nombre}"`);
  // Llevan cédulas: que ningún caché los guarde.
  res.setHeader('Cache-Control', 'no-store');
  res.send(archivo.contenido);
}

// Los mismos roles que toman asistencia; reabrir un acta firmada, solo el administrador.
@ApiTags('operadores-cda')
@ApiBearerAuth()
@Controller('operadores-cda')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
export class ActasCdaController {
  constructor(private readonly actas: ActasCdaService) {}

  @Get('actas')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @ApiOperation({ summary: 'Operadores (o los del cargo de ?grupo=) activos con su acta de entrega vigente (o null)' })
  lista(@Query('grupo') grupo?: unknown) {
    return this.actas.lista(parsearGrupo(grupo));
  }

  @Get('actas/entregan')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @ApiOperation({ summary: 'Usuarios que pueden entregar, con el cargo sugerido para el acta' })
  personasEntrega() {
    return this.actas.personasEntrega();
  }

  @Post('actas')
  @RequierePermiso('cda.actas.gestionar')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Genera (o corrige, si no está firmada) el acta de varios operadores' })
  generar(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(generarActasCdaSchema)) body: GenerarActasCdaRequest,
  ) {
    return this.actas.generar(body, user.sub);
  }

  @Post('actas/zip')
  @RequierePermiso('cda.actas.gestionar')
  @UseGuards(PermisoGuard)
  @Throttle(LIMITE_ZIP)
  @HttpCode(200)
  @ApiOperation({ summary: 'ZIP con el Word y el PDF de las actas de los operadores elegidos' })
  async zip(
    @Req() req: Request,
    @Res() res: Response,
    @Body(new ZodValidationPipe(descargarActasCdaSchema)) body: { operadorIds: string[] },
  ) {
    const archivo = await this.actas.zip(body.operadorIds);
    // Para la bitácora (audit.interceptor): de quiénes salieron las actas (ids, sin cédulas).
    (req as Request & { actasCdaOperadorIds?: string[] }).actasCdaOperadorIds = archivo.operadorIds;
    enviar(res, archivo, 'zip');
  }

  @Get(':id/acta.docx')
  @RequierePermiso('cda.actas.gestionar')
  @UseGuards(PermisoGuard)
  @Throttle(LIMITE_DESCARGA)
  @ApiOperation({ summary: 'Acta vigente del operador en Word' })
  async word(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    enviar(res, await this.actas.word(id), 'docx');
  }

  @Get(':id/acta.pdf')
  @RequierePermiso('cda.actas.gestionar')
  @UseGuards(PermisoGuard)
  @Throttle(LIMITE_DESCARGA)
  @ApiOperation({ summary: 'Acta vigente del operador en PDF' })
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    enviar(res, await this.actas.pdf(id), 'pdf');
  }

  @Post(':id/acta/firmar')
  @RequierePermiso('cda.actas.gestionar')
  @UseGuards(PermisoGuard)
  @HttpCode(200)
  @ApiOperation({ summary: 'Marca el acta vigente como firmada (queda bloqueada)' })
  firmar(@Param('id', ParseUUIDPipe) id: string) {
    return this.actas.firmar(id);
  }

  @Post(':id/acta/reabrir')
  @HttpCode(200)
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Vuelve a GENERADA un acta firmada, para corregirla' })
  reabrir(@Param('id', ParseUUIDPipe) id: string) {
    return this.actas.reabrir(id);
  }
}
