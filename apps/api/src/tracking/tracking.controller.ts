import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type {
  IngestaPosicionesRequest,
  LlegadaDpiRequest,
  LlegadaNoCdaRequest,
  LlegadaRecintoRequest,
  RecepcionKitRequest,
  SalidaDpiRequest,
  SalidaRecintoRequest,
  ValidarKitRequest,
} from '@cne/shared-types';
import {
  ingestaPosicionesSchema,
  llegadaDpiSchema,
  llegadaNoCdaSchema,
  llegadaRecintoSchema,
  recepcionKitSchema,
  salidaDpiSchema,
  salidaRecintoSchema,
  validarKitSchema,
} from '@cne/shared-validation';

import { TrackingService } from './tracking.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthenticatedUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';

@ApiTags('tracking')
@ApiBearerAuth()
@Controller('tracking')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get('mi-asignacion')
  @Roles('OPERADOR_CDA')
  @ApiOperation({
    summary: 'HU2-CA1 / HU3-CA1: detalle de recinto, militar y kits asignados al operador',
  })
  miAsignacion(@CurrentUser() user: AuthenticatedUser) {
    return this.tracking.miAsignacion(user.sub);
  }

  @Post('salida-dpi')
  @Roles('OPERADOR_CDA')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'HU2-CA2/CA3: registra la salida del DPI con ubicación GPS puntual',
  })
  registrarSalidaDpi(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(salidaDpiSchema)) body: SalidaDpiRequest,
  ) {
    return this.tracking.registrarSalidaDpi(user.sub, body);
  }

  @Post('foto-militar')
  @Roles('OPERADOR_CDA')
  @HttpCode(HttpStatus.CREATED)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @ApiOperation({ summary: 'HU3-CA2: sube la foto del militar cifrada' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  subirFotoMilitar(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /^image\// })
        .addMaxSizeValidator({ maxSize: 8 * 1024 * 1024 })
        .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }),
    )
    file: Express.Multer.File,
  ) {
    return this.tracking.guardarFotoMilitar(file);
  }

  @Post('validar-kit')
  @Roles('OPERADOR_CDA')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'HU3-CA5: valida que el kit escaneado pertenezca al operador' })
  validarKit(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(validarKitSchema)) body: ValidarKitRequest,
  ) {
    return this.tracking.validarKit(user.sub, body.codigo);
  }

  @Post('recepcion-kit')
  @Roles('OPERADOR_CDA')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'HU3-CA6: confirma la recepción de un kit electoral' })
  recepcionKit(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(recepcionKitSchema)) body: RecepcionKitRequest,
  ) {
    return this.tracking.confirmarRecepcionKit(user.sub, body);
  }

  @Post('llegada-recinto')
  @Roles('OPERADOR_CDA')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'HU3-CA7: registra la llegada al recinto con GPS y notifica',
  })
  llegadaRecinto(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(llegadaRecintoSchema)) body: LlegadaRecintoRequest,
  ) {
    return this.tracking.registrarLlegadaRecinto(user.sub, body);
  }

  @Post('llegada-no-cda')
  @Roles('OPERADOR_CDA')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Checklist: registra que el operador ya visitó un NO-CDA a su cargo',
  })
  llegadaNoCda(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(llegadaNoCdaSchema)) body: LlegadaNoCdaRequest,
  ) {
    return this.tracking.registrarLlegadaNoCda(user.sub, body);
  }

  @Post('salida-recinto')
  @Roles('OPERADOR_CDA')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'HU4-CA2/CA3: registra la salida del recinto e inicia el retorno al DPI',
  })
  salidaRecinto(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(salidaRecintoSchema)) body: SalidaRecintoRequest,
  ) {
    return this.tracking.registrarSalidaRecinto(user.sub, body);
  }

  @Post('posiciones')
  @Roles('OPERADOR_CDA')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'HU4-CA3: ingesta de lotes de posiciones GPS durante el retorno',
  })
  posiciones(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(ingestaPosicionesSchema)) body: IngestaPosicionesRequest,
  ) {
    return this.tracking.ingestarPosiciones(user.sub, body);
  }

  @Get('operadores-en-retorno')
  @Roles('TECNICO_SUPERVISOR', 'ADMINISTRADOR')
  @ApiOperation({
    summary: 'HU4-CA4 / HU6: operadores en retorno con su última posición GPS',
  })
  operadoresEnRetorno(@CurrentUser() user: AuthenticatedUser) {
    return this.tracking.operadoresEnRetorno(user.sub, user.roles);
  }

  @Get('estado-cdas')
  @Roles('TECNICO_SUPERVISOR', 'ADMINISTRADOR')
  @ApiOperation({
    summary: 'Estado en vivo de los CDAs del evento activo (operador, estado del flujo, última ubicación)',
  })
  estadoCdas(@CurrentUser() user: AuthenticatedUser) {
    return this.tracking.estadoCdas(user.sub, user.roles);
  }

  @Get('estado-cdas/:recintoId/foto-militar')
  @Roles('TECNICO_SUPERVISOR', 'ADMINISTRADOR')
  @ApiParam({ name: 'recintoId', description: 'ID del recinto (CDA)' })
  @ApiOperation({
    summary: 'HU3-CA2: foto del militar (descifrada) recibida al entregar el kit de ese CDA',
  })
  async fotoMilitar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('recintoId') recintoId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, contentType } = await this.tracking.obtenerFotoMilitar(
      recintoId,
      user.sub,
      user.roles,
    );
    res.set({ 'Content-Type': contentType });
    return new StreamableFile(buffer);
  }

  @Post('llegada-dpi')
  @Roles('OPERADOR_CDA')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'HU5-CA2/CA3: registra la llegada al DPI y finaliza el monitoreo',
  })
  llegadaDpi(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(llegadaDpiSchema)) body: LlegadaDpiRequest,
  ) {
    return this.tracking.registrarLlegadaDpi(user.sub, body);
  }
}
