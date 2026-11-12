import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import {
  configEvaticsSchema,
  consultarEvaticsSchema,
  filtrosEvaticsSchema,
  revisarEvaticsSchema,
  subirEvaticsSchema,
  type FiltrosEvaticsInput,
} from '@cne/shared-validation';
import type { RevisarEvaticsRequest } from '@cne/shared-types';

import { EvaticsService, MAX_CERTIFICADO_BYTES } from './evatics.service';
import { JwtAuthGuard, Public } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { CurrentUser, type AuthenticatedUser } from '../common/current-user.decorator';
import { PermisoGuard, RequierePermiso } from '../permisos-modulos/permiso.guard';
import { ModuloGuard, RequiereModulo } from '../permisos-modulos/modulo.guard';

/** Listado, foto y revisión de los certificados Evatics (pestaña de CDAs). */
@ApiTags('evatics')
@ApiBearerAuth()
@Controller('operadores-cda/evatics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
export class EvaticsController {
  constructor(private readonly evatics: EvaticsService) {}

  @Get()
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @ApiOperation({
    summary:
      'Personal que debe subir el certificado: conteos (total, por cantón y por Asistente Transversal) y filas filtradas',
  })
  listado(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(filtrosEvaticsSchema))
    filtros: FiltrosEvaticsInput,
  ) {
    return this.evatics.listado(filtros, user);
  }

  @Get('config')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @ApiOperation({ summary: 'Fecha límite para subir el certificado' })
  config() {
    return this.evatics.config();
  }

  @Put('config')
  @Roles('ADMINISTRADOR')
  @ApiOperation({
    summary: 'Cambia la fecha límite (AAAA-MM-DD, o null sin plazo). Solo el administrador',
  })
  guardarConfig(
    @Body(new ZodValidationPipe(configEvaticsSchema))
    body: {
      fechaLimite: string | null;
    },
  ) {
    return this.evatics.guardarConfig(body.fechaLimite);
  }

  @Get(':id/foto')
  @RequierePermiso('cda.evatics.revisar')
  @UseGuards(PermisoGuard)
  @ApiOperation({
    summary: 'Foto del certificado (descifrada; no se guarda en caché)',
  })
  async foto(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('anterior') anterior: unknown,
    @Query('v') v: unknown,
    @Res() res: Response,
  ) {
    // ?v=<subidoEn ISO> de la foto que muestra la web: 409 si la persona subió otra entretanto.
    const version = typeof v === 'string' && v ? new Date(v) : undefined;
    if (version && Number.isNaN(version.getTime())) throw new BadRequestException('Versión de la foto inválida');
    const buf = await this.evatics.foto(id, anterior === 'true', version);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(buf);
  }

  @Post(':id/revision')
  @RequierePermiso('cda.evatics.revisar')
  @UseGuards(PermisoGuard)
  @ApiOperation({
    summary: 'Aprueba o rechaza (con motivo) un certificado. Nunca el propio',
  })
  revisar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(revisarEvaticsSchema))
    body: RevisarEvaticsRequest,
  ) {
    return this.evatics.revisar(id, body.decision, body.motivo, body.subidoEn, user);
  }
}

/**
 * Página pública: la persona escribe su cédula y sube la foto. Sin sesión; la
 * cédula va en el cuerpo (no en la URL) para que no quede en los logs.
 */
@ApiTags('publico')
@Controller('publico/evatics')
@Public()
export class EvaticsPublicoController {
  constructor(private readonly evatics: EvaticsService) {}

  @Post('consultar')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Valida la cédula: primer nombre e inicial, cargo, estado del certificado y plazo',
  })
  consultar(
    @Body(new ZodValidationPipe(consultarEvaticsSchema))
    body: {
      cedula: string;
    },
  ) {
    return this.evatics.consultar(body.cedula);
  }

  @Post('subir')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Sube la foto del certificado (JPG, hasta 2 MB) con el consentimiento LOPDP',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('foto', {
      limits: { fileSize: MAX_CERTIFICADO_BYTES, files: 1, fields: 3 },
    }),
  )
  async subir(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(subirEvaticsSchema))
    body: { cedula: string; version: string },
  ) {
    const { certificadoId, reemplazo, resultado } = await this.evatics.subir(body.cedula, file, body.version);
    // Para la bitácora (audit.interceptor), sin devolver el id a la página pública.
    const r = req as Request & { certificadoEvaticsId?: string; reemplazoEvatics?: number };
    r.certificadoEvaticsId = certificadoId;
    r.reemplazoEvatics = reemplazo;
    return resultado;
  }
}
