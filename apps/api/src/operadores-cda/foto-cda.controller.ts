import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
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
import type { SubidaFotoCdaResult } from '@cne/shared-types';
import {
  consultarEnlaceFotoCdaSchema,
  consultarFotoCdaCedulaSchema,
  subirFotoCdaCedulaSchema,
  subirFotoCdaSchema,
} from '@cne/shared-validation';

import { FotoCdaService, MAX_FOTO_BYTES } from './foto-cda.service';
import { JwtAuthGuard, Public } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { CurrentUser, type AuthenticatedUser } from '../common/current-user.decorator';
import { PermisoGuard, RequierePermiso } from '../permisos-modulos/permiso.guard';
import { ModuloGuard, RequiereModulo } from '../permisos-modulos/modulo.guard';

@ApiTags('operadores-cda')
@ApiBearerAuth()
@Controller('operadores-cda')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
export class FotoCdaController {
  constructor(private readonly fotos: FotoCdaService) {}

  @Post(':id/enlace-foto')
  @RequierePermiso('cda.fotos.enlace')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Genera el enlace de foto (48 h, un uso). Anula el enlace anterior del operador' })
  crearEnlace(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.fotos.crearEnlace(id, user.sub);
  }

  @Get(':id/foto')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @ApiOperation({ summary: 'Foto del operador (descifrada; no se guarda en caché)' })
  async foto(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const buf = await this.fotos.foto(id);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }

  @Get(':id/foto-pendiente')
  @RequierePermiso('cda.fotos.enlace')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Foto nueva por revisar (descifrada; no se guarda en caché)' })
  async fotoPendiente(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const buf = await this.fotos.fotoPendiente(id);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }

  @Post(':id/foto-pendiente/aprobar')
  @RequierePermiso('cda.fotos.enlace')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'La foto nueva pasa a la credencial; se borra la anterior' })
  aprobarFotoPendiente(@Param('id', ParseUUIDPipe) id: string) {
    return this.fotos.aprobarFotoPendiente(id);
  }

  @Post(':id/foto-pendiente/rechazar')
  @RequierePermiso('cda.fotos.enlace')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Descarta la foto nueva; se mantiene la actual' })
  rechazarFotoPendiente(@Param('id', ParseUUIDPipe) id: string) {
    return this.fotos.rechazarFotoPendiente(id);
  }
}

/**
 * Página pública del enlace: sin sesión. El token va en el cuerpo (no en la
 * URL) para que no quede en los logs de la API.
 */
@ApiTags('publico')
@Controller('publico/foto-cda')
@Public()
export class FotoCdaPublicoController {
  constructor(private readonly fotos: FotoCdaService) {}

  @Post('consultar')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Estado del enlace y datos enmascarados del operador' })
  consultar(@Body(new ZodValidationPipe(consultarEnlaceFotoCdaSchema)) body: { token: string }) {
    return this.fotos.consultar(body.token);
  }

  @Post('subir')
  // La respuesta lleva el enlace de cambio (secreto): que ningún proxy la guarde.
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiOperation({ summary: 'Sube la foto (JPG, hasta 1 MB) con el consentimiento LOPDP. Gasta el enlace y devuelve uno de cambio (30 min)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('foto', { limits: { fileSize: MAX_FOTO_BYTES, files: 1, fields: 3 } }))
  async subir(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(subirFotoCdaSchema)) body: { token: string; version: string },
  ) {
    const { operadorId, cambio } = await this.fotos.subir(body.token, file, body.version);
    // Para la bitácora (audit.interceptor), sin devolver el id a la página pública.
    (req as Request & { operadorCdaId?: string }).operadorCdaId = operadorId;
    return { ok: true, cambio, pendiente: false } satisfies SubidaFotoCdaResult;
  }

  // Enlace único (/foto-cda sin token): la cédula va en el cuerpo, nunca en la URL.

  @Post('cedula/consultar')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Valida la cédula: nombre corto, cargo y si ya tiene foto' })
  consultarPorCedula(@Body(new ZodValidationPipe(consultarFotoCdaCedulaSchema)) body: { cedula: string }) {
    return this.fotos.consultarPorCedula(body.cedula);
  }

  @Post('cedula/subir')
  // La respuesta lleva el enlace de cambio (secreto): que ningún proxy la guarde.
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Sube la foto (JPG, hasta 1 MB) con el consentimiento LOPDP. La primera queda directa (con enlace de cambio de 30 min); si ya tenía, queda pendiente de aprobación' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('foto', { limits: { fileSize: MAX_FOTO_BYTES, files: 1, fields: 3 } }))
  async subirPorCedula(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(subirFotoCdaCedulaSchema)) body: { cedula: string; version: string },
  ) {
    const { operadorId, cambio, pendiente } = await this.fotos.subirPorCedula(body.cedula, file, body.version);
    (req as Request & { operadorCdaId?: string; fotoPendienteCda?: boolean }).operadorCdaId = operadorId;
    (req as Request & { fotoPendienteCda?: boolean }).fotoPendienteCda = pendiente;
    return { ok: true, cambio, pendiente } satisfies SubidaFotoCdaResult;
  }
}
