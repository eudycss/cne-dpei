import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  copiarParejasCdaSchema,
  crearKitConParejaCdaSchema,
  crearParejaCdaSchema,
  editarParejaCdaSchema,
  fechaParejaCdaSchema,
  intercambiarParejaCdaSchema,
  justificacionBodyParejaCdaSchema,
  justificacionParejaCdaSchema,
} from '@cne/shared-validation';
import type {
  CopiarParejasCdaRequest,
  CrearKitConParejaCdaRequest,
  CrearParejaCdaRequest,
  EditarParejaCdaRequest,
  IntercambiarParejaCdaRequest,
} from '@cne/shared-types';

import { ParejasCdaService } from './parejas-cda.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { CurrentUser, type AuthenticatedUser } from '../common/current-user.decorator';
import { ModuloGuard, RequiereModulo } from '../permisos-modulos/modulo.guard';

/** ?fecha= obligatoria y válida (AAAA-MM-DD); repetida llega como arreglo y se rechaza. */
export function parsearFecha(fecha: unknown): string {
  const r = fechaParejaCdaSchema.safeParse(fecha);
  if (!r.success) throw new BadRequestException('Indique la fecha (AAAA-MM-DD)');
  return r.data;
}

@ApiTags('parejas-cda')
@ApiBearerAuth()
@Controller('parejas-cda')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ParejasCdaController {
  constructor(private readonly parejas: ParejasCdaService) {}

  @Get()
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
  @ApiOperation({ summary: 'Parejas Operador + Asistente CDA de ?fecha=, con el estado de su kit en la app' })
  listar(@Query('fecha') fecha?: unknown) {
    return this.parejas.listar(parsearFecha(fecha));
  }

  @Get('fechas')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
  @ApiOperation({ summary: 'Días que tienen lista de parejas' })
  fechas() {
    return this.parejas.fechas();
  }

  @Get('disponibles')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @Roles('ADMINISTRADOR')
  @ApiOperation({
    summary: 'Operadores, asistentes y recintos CDA que se pueden elegir para ?fecha= (?todos=true: también los de otros días)',
  })
  disponibles(@Query('fecha') fecha?: unknown, @Query('todos') todos?: string) {
    return this.parejas.disponibles(parsearFecha(fecha), todos === 'true');
  }

  @Get('plantilla.xlsx')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Plantilla Excel para cargar parejas (con la lista de recintos CDA)' })
  async plantilla(@Res() res: Response) {
    const buffer = await this.parejas.plantilla();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla_parejas_cda.xlsx"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }

  @Get('qr')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
  @ApiOperation({ summary: 'PDF de QR de los kits de las parejas de ?fecha=' })
  async qr(@Query('fecha') fecha: unknown, @Res() res: Response) {
    const dia = parsearFecha(fecha);
    const buffer = await this.parejas.qr(dia);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="kits-qr-parejas_${dia}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }

  @Post()
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Agrega una pareja; si hay evento ACTIVO de esa fecha, el kit del recinto pasa al operador' })
  crear(@Body(new ZodValidationPipe(crearParejaCdaSchema)) body: CrearParejaCdaRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.parejas.crear(body, user.sub);
  }

  @Get('disponibles-kit')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Para "Nuevo kit": operadores y asistentes sin kit ni pareja en el evento, y recintos CDA sin kit' })
  disponiblesKit(@Query('eventoId') eventoId?: unknown) {
    const r = z.string().uuid().safeParse(eventoId);
    if (!r.success) throw new BadRequestException('Indique el evento');
    return this.parejas.disponiblesParaKit(r.data);
  }

  @Post('kit')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Nuevo kit en un paso: crea el kit del recinto, lo asigna al operador y registra la pareja' })
  crearKit(
    @Body(new ZodValidationPipe(crearKitConParejaCdaSchema)) body: CrearKitConParejaCdaRequest,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.parejas.crearKitConPareja(body, user.sub);
  }

  @Patch(':id')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Cambia el operador, el asistente o el recinto de una pareja' })
  editar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(editarParejaCdaSchema)) body: EditarParejaCdaRequest) {
    const { justificacion, ...cambios } = body;
    return this.parejas.editar(id, cambios, justificacion);
  }

  @Post(':id/intercambiar')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Intercambia el operador, el asistente o el recinto con otra pareja del mismo día' })
  intercambiar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(intercambiarParejaCdaSchema)) body: IntercambiarParejaCdaRequest,
  ) {
    return this.parejas.intercambiar(id, body.conId, body.campo, body.justificacion);
  }

  @Delete(':id')
  @Roles('ADMINISTRADOR')
  @HttpCode(204)
  @ApiOperation({ summary: 'Quita una pareja de la lista (el kit sigue en su recinto, sin operador)' })
  async eliminar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(justificacionBodyParejaCdaSchema)) body: { justificacion?: string } = {},
  ) {
    await this.parejas.eliminar(id, body?.justificacion);
  }

  @Post(':id/asignar-kit')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Asigna (o crea) el kit del recinto al operador de esta pareja' })
  asignarKit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(justificacionBodyParejaCdaSchema)) body: { justificacion?: string } = {},
  ) {
    return this.parejas.asignarKit(id, body?.justificacion);
  }

  @Post('copiar')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Copia la lista de un día a otro (solo la registra; no pasa a la app)' })
  copiar(@Body(new ZodValidationPipe(copiarParejasCdaSchema)) body: CopiarParejasCdaRequest, @CurrentUser() user: AuthenticatedUser) {
    return this.parejas.copiar(body.desde, body.hacia, user.sub);
  }

  @Post('aplicar')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Pasa la lista de ?fecha= a la app (evento ACTIVO con jornada ese día)' })
  aplicar(
    @Query('fecha') fecha: unknown,
    @Body(new ZodValidationPipe(justificacionBodyParejaCdaSchema)) body: { justificacion?: string } = {},
  ) {
    return this.parejas.aplicar(parsearFecha(fecha), body?.justificacion);
  }

  @Post('importar')
  @Roles('ADMINISTRADOR')
  @ApiOperation({
    summary:
      'Carga la plantilla de parejas para ?fecha=. Sin ?guardar=true solo devuelve la vista previa; ?app=false guarda sin pasar a la app (listas históricas)',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } }))
  importar(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthenticatedUser,
    @Query('fecha') fecha?: unknown,
    @Query('guardar') guardar?: string,
    @Query('app') app?: string,
    @Query('justificacion') justificacion?: unknown,
  ) {
    const motivo = justificacionParejaCdaSchema.safeParse(typeof justificacion === 'string' ? justificacion : undefined);
    if (!motivo.success) throw new BadRequestException('Justificación inválida (máximo 500 caracteres)');
    return this.parejas.importar(file, parsearFecha(fecha), guardar === 'true', user.sub, app !== 'false', motivo.data);
  }
}
