import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  ParseUUIDPipe,
  Post,
  Query,
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
  LlegadaDpiManualRequest,
  LlegadaDpiRequest,
  LlegadaNoCdaRequest,
  LlegadaRecintoManualRequest,
  LlegadaRecintoRequest,
  PruebaConexionRequest,
  RecepcionKitRequest,
  SalidaDpiRequest,
  SalidaRecintoRequest,
  ValidarKitRequest,
  VerificarKitRetornoRequest,
} from '@cne/shared-types';
import {
  ingestaPosicionesSchema,
  llegadaDpiManualSchema,
  llegadaDpiSchema,
  llegadaNoCdaSchema,
  llegadaRecintoManualSchema,
  llegadaRecintoSchema,
  pruebaConexionSchema,
  recepcionKitSchema,
  salidaDpiSchema,
  salidaRecintoSchema,
  validarKitSchema,
  verificarKitRetornoSchema,
} from '@cne/shared-validation';

import { TrackingService } from './tracking.service';
import { InformeOperadorService } from './informe-operador.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { enviarPdf } from '../common/pdf';
import { RolesGuard } from '../common/roles.guard';
import { EventoNoReabiertoGuard } from '../common/evento-no-reabierto.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthenticatedUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';

@ApiTags('tracking')
@ApiBearerAuth()
@Controller('tracking')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TrackingController {
  constructor(
    private readonly tracking: TrackingService,
    private readonly informes: InformeOperadorService,
  ) {}

  @Get('mi-asignacion')
  @Roles('OPERADOR_CDA')
  @ApiOperation({
    summary: 'HU2-CA1 / HU3-CA1: detalle de recinto, militar y kits asignados al operador',
  })
  miAsignacion(@CurrentUser() user: AuthenticatedUser) {
    return this.tracking.miAsignacion(user.sub);
  }

  @Post('salida-dpi')
  @UseGuards(EventoNoReabiertoGuard)
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
  @UseGuards(EventoNoReabiertoGuard)
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

  @Post('foto-acta')
  @UseGuards(EventoNoReabiertoGuard)
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
  @ApiOperation({
    summary: 'Evidencia obligatoria previa a la salida del recinto: sube la foto del acta (instalación o escrutinio) cifrada',
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  subirFotoActa(
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /^image\// })
        .addMaxSizeValidator({ maxSize: 8 * 1024 * 1024 })
        .build({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }),
    )
    file: Express.Multer.File,
  ) {
    return this.tracking.guardarFotoActa(file);
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
  @UseGuards(EventoNoReabiertoGuard)
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
  @UseGuards(EventoNoReabiertoGuard)
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
  @UseGuards(EventoNoReabiertoGuard)
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

  @Post('prueba-conexion')
  @UseGuards(EventoNoReabiertoGuard)
  @Roles('OPERADOR_CDA')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Prueba de conexión: el operador confirma que el recinto tiene conexión (después de la llegada)',
  })
  pruebaConexion(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(pruebaConexionSchema)) body: PruebaConexionRequest,
  ) {
    return this.tracking.registrarPruebaConexion(user.sub, body);
  }

  @Post('salida-recinto')
  @UseGuards(EventoNoReabiertoGuard)
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
  @UseGuards(EventoNoReabiertoGuard)
  @Roles('OPERADOR_CDA')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'HU4-CA3: ingesta de lotes de posiciones GPS durante el tramo de ida o de retorno',
  })
  posiciones(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(ingestaPosicionesSchema)) body: IngestaPosicionesRequest,
  ) {
    return this.tracking.ingestarPosiciones(user.sub, body);
  }

  @Get('operadores-en-retorno')
  @Roles('TECNICO_SUPERVISOR', 'ADMINISTRADOR', 'LECTOR')
  @ApiOperation({
    summary: 'HU4-CA4 / HU6: operadores en tránsito (ida o retorno) con su última posición GPS',
  })
  operadoresEnRetorno(@CurrentUser() user: AuthenticatedUser) {
    return this.tracking.operadoresEnRetorno(user.sub, user.roles);
  }

  @Get('estado-cdas')
  @Roles('TECNICO_SUPERVISOR', 'ADMINISTRADOR', 'LECTOR')
  @ApiOperation({
    summary: 'Estado en vivo de los CDAs del evento activo (operador, estado del flujo, última ubicación)',
  })
  estadoCdas(@CurrentUser() user: AuthenticatedUser) {
    return this.tracking.estadoCdas(user.sub, user.roles);
  }

  @Get('recintos-dificil-acceso')
  @Roles('TECNICO_SUPERVISOR', 'ADMINISTRADOR', 'LECTOR')
  @ApiOperation({
    summary: 'HU13 Parte B: CDAs esDificilAcceso del evento activo con el estado de su operador',
  })
  recintosDificilAcceso(@CurrentUser() user: AuthenticatedUser) {
    return this.tracking.recintosDificilAcceso(user.sub, user.roles);
  }

  @Post('llegada-recinto-manual')
  @UseGuards(EventoNoReabiertoGuard)
  @Roles('TECNICO_SUPERVISOR', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'HU13 Parte B: registro manual de llegada al recinto (sin GPS) para CDAs esDificilAcceso',
  })
  llegadaRecintoManual(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(llegadaRecintoManualSchema)) body: LlegadaRecintoManualRequest,
  ) {
    return this.tracking.registrarLlegadaRecintoManual(user.sub, user.roles, body);
  }

  @Get('reporte-no-cda')
  @Roles('ADMINISTRADOR', 'LECTOR')
  @ApiOperation({
    summary: 'Reporte admin: NO-CDAs visitados vs. pendientes por CDA del evento activo',
  })
  reporteNoCda() {
    return this.tracking.reporteNoCdas();
  }

  @Get('reporte-flujo')
  @Roles('ADMINISTRADOR', 'LECTOR')
  @ApiOperation({
    summary: 'Reporte admin: hitos del flujo (Salida DPI/Llegada Recinto/Salida Recinto/Llegada DPI) por CDA',
  })
  reporteFlujo() {
    return this.tracking.reporteFlujoCdas();
  }

  // ─── Informe del Operador CDA (PDF) ────────────────────────────────────────

  @Get('informes-operador/responsables')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Usuarios que pueden firmar el Informe del Operador CDA como responsables' })
  responsablesInforme() {
    return this.informes.responsables();
  }

  @Get('informes-operador/pdf')
  @Roles('ADMINISTRADOR')
  @ApiOperation({
    summary:
      'Informes de varios operadores CDA (los elegidos en operadorIds, los de un cantón o todos), un PDF con una sección por operador',
  })
  async informesOperadorPdf(
    @Res() res: Response,
    @Query('responsableId', ParseUUIDPipe) responsableId: string,
    @Query('cantonId') cantonId?: unknown,
    @Query('operadorIds') operadorIds?: unknown,
    @Query('incluirJornada') incluirJornada?: unknown,
  ) {
    const filtro = { cantonId: cantonDelQuery(cantonId), operadorIds: operadoresDelQuery(operadorIds) };
    const pdf = await this.informes.pdfVarios(filtro, responsableId, jornadaDelQuery(incluirJornada));
    enviarPdf(res, pdf, 'informes-operadores-cda.pdf');
  }

  @Get('informes-operador/reporte-general')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Reporte general de seguimiento de CDAs (PDF): una tabla con la jornada de cada operador' })
  async reporteGeneralPdf(
    @Res() res: Response,
    @Query('responsableId', ParseUUIDPipe) responsableId: string,
    @Query('cantonId') cantonId?: unknown,
    @Query('incluirJornada') incluirJornada?: unknown,
  ) {
    const pdf = await this.informes.pdfGeneral(cantonDelQuery(cantonId), responsableId, jornadaDelQuery(incluirJornada));
    enviarPdf(res, pdf, 'reporte-general-cdas.pdf');
  }

  @Get('informes-operador/:operadorId/pdf')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Informe del Operador CDA (PDF): jornada, prueba de conexión y reportes (día de elecciones) y firmas' })
  async informeOperadorPdf(
    @Res() res: Response,
    @Param('operadorId', ParseUUIDPipe) operadorId: string,
    @Query('responsableId', ParseUUIDPipe) responsableId: string,
    @Query('incluirJornada') incluirJornada?: unknown,
  ) {
    const pdf = await this.informes.pdfOperador(operadorId, responsableId, jornadaDelQuery(incluirJornada));
    enviarPdf(res, pdf, 'informe-operador-cda.pdf');
  }

  @Get('estado-cdas/:recintoId/foto-militar')
  @Roles('TECNICO_SUPERVISOR', 'ADMINISTRADOR', 'LECTOR')
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

  @Get('estado-cdas/:recintoId/foto-acta/:tipo')
  @Roles('TECNICO_SUPERVISOR', 'ADMINISTRADOR', 'LECTOR')
  @ApiParam({ name: 'recintoId', description: 'ID del recinto (CDA)' })
  @ApiParam({ name: 'tipo', description: 'instalacion | escrutinio' })
  @ApiOperation({
    summary: 'Foto del acta (instalación o escrutinio, descifrada) subida antes de la salida del recinto de ese CDA',
  })
  async fotoActa(
    @CurrentUser() user: AuthenticatedUser,
    @Param('recintoId') recintoId: string,
    @Param('tipo') tipo: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (tipo !== 'instalacion' && tipo !== 'escrutinio') {
      throw new BadRequestException('tipo debe ser "instalacion" o "escrutinio"');
    }
    const { buffer, contentType } = await this.tracking.obtenerFotoActa(
      recintoId,
      user.sub,
      user.roles,
      tipo,
    );
    res.set({ 'Content-Type': contentType });
    return new StreamableFile(buffer);
  }

  @Post('llegada-dpi')
  @UseGuards(EventoNoReabiertoGuard)
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

  @Post('validar-kit-retorno')
  @Roles('ASISTENTE_TRANSVERSAL', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verificación retorno DPI: valida el kit escaneado y devuelve su checklist',
  })
  validarKitRetorno(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(validarKitSchema)) body: ValidarKitRequest,
  ) {
    return this.tracking.validarKitRetorno(user.sub, user.roles, body.codigo);
  }

  @Post('verificar-kit-retorno')
  @UseGuards(EventoNoReabiertoGuard)
  @Roles('ASISTENTE_TRANSVERSAL', 'ADMINISTRADOR')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Verificación retorno DPI: confirma el checklist de contenidos de un kit',
  })
  verificarKitRetorno(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(verificarKitRetornoSchema)) body: VerificarKitRetornoRequest,
  ) {
    return this.tracking.confirmarVerificacionKitRetorno(user.sub, user.roles, body);
  }

  @Get('kits-verificados-retorno')
  @Roles('ASISTENTE_TRANSVERSAL', 'TECNICO_SUPERVISOR', 'ADMINISTRADOR', 'LECTOR')
  @ApiOperation({
    summary: 'Verificación retorno DPI: kits ya verificados con el total',
  })
  kitsVerificadosRetorno(@CurrentUser() user: AuthenticatedUser) {
    return this.tracking.kitsVerificadosRetorno(user.sub, user.roles);
  }

  @Post('operadores/:operadorId/llegada-dpi-manual')
  @UseGuards(EventoNoReabiertoGuard)
  @Roles('ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'operadorId', description: 'Usuario del operador que olvidó marcar la llegada' })
  @ApiOperation({
    summary: 'El operador olvidó marcar la llegada al DPEI: el administrador la registra con un motivo (no borra nada)',
  })
  llegadaDpiManual(
    @Param('operadorId', ParseUUIDPipe) operadorId: string,
    @Body(new ZodValidationPipe(llegadaDpiManualSchema)) body: LlegadaDpiManualRequest,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tracking.registrarLlegadaDpiManual(operadorId, body.motivo, user.sub);
  }

  @Post('reset-operador/:operadorId')
  @UseGuards(EventoNoReabiertoGuard)
  @Roles('ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'operadorId', description: 'ID del operador a resetear' })
  @ApiOperation({
    summary: 'Pruebas: borra el progreso de tracking del operador y regresa sus kits a ASIGNADO',
  })
  resetEstadoOperador(@Param('operadorId') operadorId: string) {
    return this.tracking.resetEstadoOperador(operadorId);
  }
}

/**
 * ?cantonId= del informe masivo: ausente = todos los cantones. Un valor que
 * viene pero no es un id válido da 400, para no entregar de más (cédulas y
 * fotos de todo el evento) a quien creyó estar filtrando.
 */
export function cantonDelQuery(valor: unknown): number | undefined {
  if (valor === undefined || valor === '') return undefined;
  if (typeof valor === 'string' && /^[1-9]\d{0,5}$/.test(valor)) return Number(valor);
  throw new BadRequestException('cantonId inválido');
}

/**
 * ?incluirJornada= del informe: solo "true" incluye la prueba de conexión y
 * las fotos de los reportes (día de elecciones). Ausente = pruebas técnicas.
 */
export function jornadaDelQuery(valor: unknown): boolean {
  if (valor === undefined || valor === '' || valor === 'false') return false;
  if (valor === 'true') return true;
  throw new BadRequestException('incluirJornada debe ser true o false');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_OPERADORES_QUERY = 200;

/**
 * ?operadorIds= (ids separados por coma) de los operadores elegidos. Ausente =
 * sin este filtro. Un id inválido da 400 en vez de ignorarse.
 */
export function operadoresDelQuery(valor: unknown): string[] | undefined {
  if (valor === undefined || valor === '') return undefined;
  if (typeof valor !== 'string') throw new BadRequestException('operadorIds inválido');
  const ids = [...new Set(valor.split(',').map((s) => s.trim()))];
  if (ids.length > MAX_OPERADORES_QUERY || ids.some((id) => !UUID.test(id))) {
    throw new BadRequestException('operadorIds inválido');
  }
  return ids;
}
