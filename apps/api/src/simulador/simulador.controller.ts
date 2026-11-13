import { BadRequestException, Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import type { FormatoReporteCda } from '@cne/shared-types';
import {
  anularIntentoSimuladorSchema,
  borradorActaSimuladorSchema,
  activarNovedadDigitacionSchema,
  activarPracticaDigitacionSchema,
  guardarActaSimuladorSchema,
  ingresoSimuladorSchema,
  iniciarSimuladorSchema,
  nombreNovedadDigitacionSchema,
  practicaDigitacionSchema,
  tokenSimuladorSchema,
  type AnularIntentoSimuladorInput,
  type GuardarActaSimuladorInput,
  type PracticaDigitacionInput,
} from '@cne/shared-validation';

import { CurrentUser, type AuthenticatedUser } from '../common/current-user.decorator';
import { JwtAuthGuard, Public } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { LecturaConfigurable, Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { ModuloGuard, RequiereModulo } from '../permisos-modulos/modulo.guard';
import { PracticasDigitacionService } from './practicas-digitacion.service';
import { SimuladorPublicoService } from './simulador-publico.service';
import { archivoReporteSimulador } from './archivo-reporte-simulador';
import { filaDe } from './reporte-simulador';
import { LIMITE_DESCARGA_REPORTE, enviarReporte } from '../operadores-cda/reporte-cda';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ?operadorId= opcional: un solo valor y con forma de UUID. */
function operadorDe(v: unknown): string | undefined {
  if (v === undefined || v === '') return undefined;
  if (typeof v !== 'string' || !UUID.test(v)) throw new BadRequestException('operadorId inválido');
  return v;
}

/**
 * Administración del simulador. @Roles es el techo; de fábrica solo el
 * ADMINISTRADOR ve el módulo y lo activa a otros roles en "Módulos por rol".
 */
@ApiTags('simulador-digitacion')
@ApiBearerAuth()
@Controller('simulador-digitacion')
@UseGuards(JwtAuthGuard, RolesGuard, ModuloGuard)
@Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
@RequiereModulo('simulador-digitacion')
export class SimuladorController {
  constructor(private readonly practicas: PracticasDigitacionService) {}

  @LecturaConfigurable()
  @Get('practicas')
  @ApiOperation({ summary: 'Prácticas de digitación (también las desactivadas)' })
  listar() {
    return this.practicas.listar();
  }

  @LecturaConfigurable()
  @Get('cargos')
  @ApiOperation({ summary: 'Cargos activos del personal CDA/CPE, con cuántas personas tienen' })
  listarCargos() {
    return this.practicas.listarCargos();
  }

  @Get('personas')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Busca personal activo por nombre o cédula (máx. 20) para agregar o quitar' })
  buscarPersonas(@Query('q') q: unknown) {
    return this.practicas.buscarPersonas(typeof q === 'string' ? q : '');
  }

  @Get('practicas/:id')
  obtener(@Param('id', ParseUUIDPipe) id: string) {
    return this.practicas.obtener(id);
  }

  @Post('practicas')
  @ApiOperation({ summary: 'Crea una práctica: actas, meta, tiempo y a quién aplica (cargos + personas)' })
  crear(@Body(new ZodValidationPipe(practicaDigitacionSchema)) body: PracticaDigitacionInput) {
    return this.practicas.crear(body);
  }

  @Put('practicas/:id')
  @ApiOperation({ summary: 'Reemplaza la práctica. Con intentos hechos no cambia cómo se califica' })
  editar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(practicaDigitacionSchema)) body: PracticaDigitacionInput) {
    return this.practicas.editar(id, body);
  }

  // Lleva cédulas y celulares: sin caché. La vista en pantalla no se audita (se refresca
  // sola mientras hay intentos en curso); sí las descargas.
  @Get('practicas/:id/reporte')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reporte: cada persona asignada (o con intentos), su mejor intento y todos sus intentos' })
  reporte(@Param('id', ParseUUIDPipe) id: string) {
    return this.practicas.reporte(id);
  }

  @Get('practicas/:id/reporte.xlsx')
  @Throttle(LIMITE_DESCARGA_REPORTE)
  @ApiOperation({ summary: 'Excel del reporte (general, o de una persona con ?operadorId=)' })
  exportarExcel(@Res() res: Response, @Param('id', ParseUUIDPipe) id: string, @Query('operadorId') operadorId?: unknown) {
    return this.exportar(res, id, operadorId, 'xlsx');
  }

  @Get('practicas/:id/reporte.pdf')
  @Throttle(LIMITE_DESCARGA_REPORTE)
  @ApiOperation({ summary: 'PDF del reporte (general, o de una persona con ?operadorId=)' })
  exportarPdf(@Res() res: Response, @Param('id', ParseUUIDPipe) id: string, @Query('operadorId') operadorId?: unknown) {
    return this.exportar(res, id, operadorId, 'pdf');
  }

  private async exportar(res: Response, id: string, operadorIdParam: unknown, formato: FormatoReporteCda): Promise<void> {
    const operadorId = operadorDe(operadorIdParam);
    const rep = await this.practicas.reporte(id);
    enviarReporte(res, await archivoReporteSimulador(rep, formato, operadorId ? filaDe(rep, operadorId) : undefined));
  }

  @Post('intentos/:id/anular')
  @ApiOperation({ summary: 'Anula un intento (motivo obligatorio): no cuenta y la persona puede empezar otro' })
  anularIntento(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(anularIntentoSimuladorSchema)) body: AnularIntentoSimuladorInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.practicas.anularIntento(id, body.motivo, user.sub);
  }

  @Patch('practicas/:id/activa')
  cambiarActiva(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(activarPracticaDigitacionSchema)) body: { activa: boolean }) {
    return this.practicas.cambiarActiva(id, body.activa);
  }

  @LecturaConfigurable()
  @Get('novedades')
  @ApiOperation({ summary: 'Catálogo de novedades del SIER' })
  listarNovedades() {
    return this.practicas.listarNovedades();
  }

  @Post('novedades')
  crearNovedad(@Body(new ZodValidationPipe(nombreNovedadDigitacionSchema)) body: { nombre: string }) {
    return this.practicas.crearNovedad(body.nombre);
  }

  @Patch('novedades/:id')
  renombrarNovedad(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(nombreNovedadDigitacionSchema)) body: { nombre: string }) {
    return this.practicas.renombrarNovedad(id, body.nombre);
  }

  @Patch('novedades/:id/activa')
  cambiarActivaNovedad(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(activarNovedadDigitacionSchema)) body: { activa: boolean }) {
    return this.practicas.cambiarActivaNovedad(id, body.activa);
  }
}

/**
 * Página pública del simulador: se entra solo con la cédula. Todo va por POST
 * con el dato en el cuerpo (no en la URL) para que no quede en los logs. Los
 * límites son por IP y holgados: una sala entera de digitadores sale por la
 * misma IP.
 */
@ApiTags('publico')
@Controller('publico/simulador')
@Public()
export class SimuladorPublicoController {
  constructor(private readonly simulador: SimuladorPublicoService) {}

  @Post('ingresar')
  // Por IP holgado (la sala entera); el límite por cédula lo pone el servicio.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Prácticas disponibles para la cédula (nombre enmascarado)' })
  ingresar(@Body(new ZodValidationPipe(ingresoSimuladorSchema)) body: { cedula: string }) {
    return this.simulador.ingresar(body.cedula);
  }

  @Post('iniciar')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Empieza (o retoma) un intento y entrega el token de la sesión' })
  async iniciar(
    @Req() req: Request,
    @Body(new ZodValidationPipe(iniciarSimuladorSchema)) body: { cedula: string; practicaId: string; equipo?: string },
  ) {
    const { operadorId, retomado, ...respuesta } = await this.simulador.iniciar(body.cedula, body.practicaId, body.equipo);
    // Para la bitácora (audit.interceptor), sin devolverlos a la página pública.
    Object.assign(req, { operadorCdaId: operadorId, simuladorRetomado: retomado });
    return respuesta;
  }

  @Post('estado')
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @ApiOperation({ summary: 'Estado del intento; además mantiene la sesión como en uso' })
  estado(@Body(new ZodValidationPipe(tokenSimuladorSchema)) body: { token: string }) {
    return this.simulador.estado(body.token);
  }

  @Post('nueva-acta')
  @Throttle({ default: { limit: 400, ttl: 60_000 } })
  @ApiOperation({ summary: 'Acta pendiente o una nueva' })
  nuevaActa(@Body(new ZodValidationPipe(tokenSimuladorSchema)) body: { token: string }) {
    return this.simulador.nuevaActa(body.token);
  }

  @Post('borrador')
  @Throttle({ default: { limit: 900, ttl: 60_000 } })
  @ApiOperation({ summary: 'Guarda lo escrito sin calificar (cuenta si el tiempo se acaba con el acta a medias)' })
  borrador(@Body(new ZodValidationPipe(borradorActaSimuladorSchema)) body: GuardarActaSimuladorInput) {
    return this.simulador.borrador(body.token, body.actaId, body.valores);
  }

  @Post('guardar')
  @Throttle({ default: { limit: 400, ttl: 60_000 } })
  @ApiOperation({ summary: 'Califica el acta; si hay errores dice qué filas corregir' })
  guardar(@Body(new ZodValidationPipe(guardarActaSimuladorSchema)) body: GuardarActaSimuladorInput) {
    return this.simulador.guardar(body.token, body.actaId, body.valores);
  }
}
