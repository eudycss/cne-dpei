import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
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
import {
  consultarInformeCdaSchema,
  generarInformeCdaSchema,
  subirFotoInformeCdaSchema,
  verFotoInformeCdaSchema,
} from '@cne/shared-validation';

import { InformeProductosService, ArchivoInforme } from './informe-productos.service';
import { MAX_FOTO_BYTES } from './foto-cda.service';
import { JwtAuthGuard, Public } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { ModuloGuard, RequiereModulo } from '../permisos-modulos/modulo.guard';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function enviarWord(res: Response, archivo: ArchivoInforme): void {
  res.setHeader('Content-Type', DOCX);
  res.setHeader('Content-Disposition', `attachment; filename="${archivo.nombre}"`);
  // Lleva nombre, cargo y fotos: que ningún caché lo guarde.
  res.setHeader('Cache-Control', 'no-store');
  res.send(archivo.contenido);
}

/** La Delegación ve el avance y descarga el informe de cualquier persona. */
@ApiTags('operadores-cda')
@ApiBearerAuth()
@Controller('operadores-cda')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
@RequiereModulo('operadores-cda')
export class InformeProductosController {
  constructor(private readonly informes: InformeProductosService) {}

  @Get('informes-productos/avance')
  @UseGuards(ModuloGuard)
  @ApiOperation({ summary: 'Cuántas fotos del informe de productos lleva cada persona' })
  avance() {
    return this.informes.avance();
  }

  @Get(':id/informe-productos')
  @UseGuards(ModuloGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Informe de productos de una persona con su registro fotográfico (Word)' })
  async informe(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    enviarWord(res, await this.informes.informe(id));
  }
}

/**
 * Página pública /informe-cda: sin sesión. La cédula y el token de la visita
 * van en el cuerpo (no en la URL) para que no queden en los logs.
 */
@ApiTags('publico')
@Controller('publico/informe-cda')
@Public()
export class InformeProductosPublicoController {
  constructor(private readonly informes: InformeProductosService) {}

  @Post('consultar')
  @HttpCode(200)
  // La respuesta lleva el token de la visita: que ningún proxy la guarde.
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Valida la cédula y abre una visita de 2 h: nombre corto, cargo y qué fotos tiene' })
  consultar(@Body(new ZodValidationPipe(consultarInformeCdaSchema)) body: { cedula: string }) {
    return this.informes.consultar(body.cedula);
  }

  @Post('foto')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Sube o reemplaza una de las 6 fotos (JPG, hasta 1 MB) con el consentimiento LOPDP' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('foto', { limits: { fileSize: MAX_FOTO_BYTES, files: 1, fields: 4 } }))
  async subir(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(subirFotoInformeCdaSchema)) body: { token: string; posicion: number; version: string },
  ) {
    const { operadorId, fotos } = await this.informes.subirFoto(body.token, body.posicion, file, body.version);
    // Para la bitácora (audit.interceptor), sin devolver el id a la página pública.
    (req as Request & { operadorCdaId?: string }).operadorCdaId = operadorId;
    return { fotos };
  }

  @Post('foto/ver')
  @HttpCode(200)
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @ApiOperation({ summary: 'Una foto subida en esta misma visita (vista previa)' })
  async ver(
    @Body(new ZodValidationPipe(verFotoInformeCdaSchema)) body: { token: string; posicion: number },
    @Res() res: Response,
  ) {
    const buf = await this.informes.verFoto(body.token, body.posicion);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }

  @Post('generar')
  @HttpCode(200)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiOperation({ summary: 'Descarga el informe (Word) si las 6 fotos se subieron en esta visita' })
  async generar(
    @Req() req: Request,
    @Body(new ZodValidationPipe(generarInformeCdaSchema)) body: { token: string },
    @Res() res: Response,
  ) {
    const { operadorId, ...archivo } = await this.informes.generarPublico(body.token);
    (req as Request & { operadorCdaId?: string }).operadorCdaId = operadorId;
    enviarWord(res, archivo);
  }
}
