import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  agregarPersonaDistribucionSchema,
  candidatosDistribucionSchema,
  contactosDistribucionSchema,
  crearDistribucionDiasSchema,
  editarPersonaDistribucionSchema,
  intercambiarPersonaDistribucionSchema,
  reporteDistribucionSchema,
  type AgregarPersonaDistribucionInput,
  type CandidatosDistribucionInput,
  type ContactosDistribucionInput,
  type CrearDistribucionDiasInput,
  type EditarPersonaDistribucionInput,
  type IntercambiarPersonaDistribucionInput,
  type ReporteDistribucionInput,
} from '@cne/shared-validation';

import { CurrentUser, type AuthenticatedUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { ModuloGuard, RequiereModulo } from '../permisos-modulos/modulo.guard';
import { PermisoGuard, RequierePermiso } from '../permisos-modulos/permiso.guard';
import { DistribucionDiasService } from './distribucion-dias.service';
import { LIMITE_DESCARGA_REPORTE, enviarReporte } from './reporte-cda';

/**
 * Distribución del personal por días (pestaña de Operadores CDA). Ver y
 * exportar = módulo 'operadores-cda'; armar, editar y borrar = acción
 * 'cda.distribucion.gestionar'. @Roles es el techo.
 */
@ApiTags('distribuciones-dias')
@ApiBearerAuth()
@Controller('distribuciones-dias')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
@RequiereModulo('operadores-cda')
export class DistribucionDiasController {
  constructor(private readonly distribucion: DistribucionDiasService) {}

  @Get()
  @UseGuards(ModuloGuard)
  @ApiOperation({ summary: 'Distribuciones por días, la más reciente primero' })
  listar() {
    return this.distribucion.listar();
  }

  @Get(':id')
  @UseGuards(ModuloGuard)
  @ApiOperation({ summary: 'Distribución con sus personas y los totales de hombres y mujeres por día' })
  detalle(@Param('id', ParseUUIDPipe) id: string) {
    return this.distribucion.detalle(id);
  }

  @Get(':id/candidatos')
  @RequierePermiso('cda.distribucion.gestionar')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Para «Agregar persona»: personal activo de cualquier cargo que todavía no está en la distribución (?buscar=)' })
  candidatos(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(candidatosDistribucionSchema)) q: CandidatosDistribucionInput) {
    return this.distribucion.candidatos(id, q.buscar);
  }

  @Get(':id/reporte.xlsx')
  @UseGuards(ModuloGuard)
  @Throttle(LIMITE_DESCARGA_REPORTE)
  @ApiOperation({ summary: 'Excel de la distribución (?fecha= un día, ?encargado=)' })
  async reporteXlsx(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(reporteDistribucionSchema)) q: ReporteDistribucionInput, @Res() res: Response) {
    enviarReporte(res, await this.distribucion.reporte(id, q, 'xlsx'));
  }

  @Get(':id/reporte.pdf')
  @UseGuards(ModuloGuard)
  @Throttle(LIMITE_DESCARGA_REPORTE)
  @ApiOperation({ summary: 'PDF de la distribución (?fecha= un día, ?encargado=)' })
  async reportePdf(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(reporteDistribucionSchema)) q: ReporteDistribucionInput, @Res() res: Response) {
    enviarReporte(res, await this.distribucion.reporte(id, q, 'pdf'));
  }

  @Get(':id/contactos.vcf')
  @UseGuards(ModuloGuard)
  @Throttle(LIMITE_DESCARGA_REPORTE)
  @ApiOperation({ summary: 'Contactos (.vcf) de un día para importarlos en el teléfono y armar el grupo de WhatsApp (?fecha= obligatorio)' })
  async contactos(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(contactosDistribucionSchema)) q: ContactosDistribucionInput, @Res() res: Response) {
    enviarReporte(res, await this.distribucion.contactos(id, q.fecha));
  }

  @Post()
  @RequierePermiso('cda.distribucion.gestionar')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Crea la distribución y reparte al personal activo (menos los cargos excluidos)' })
  crear(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(crearDistribucionDiasSchema)) body: CrearDistribucionDiasInput) {
    return this.distribucion.crear(body, user.sub);
  }

  @Post(':id/regenerar')
  @RequierePermiso('cda.distribucion.gestionar')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Vuelve a repartir desde cero (se pierden los cambios y las personas agregadas a mano)' })
  regenerar(@Param('id', ParseUUIDPipe) id: string) {
    return this.distribucion.regenerar(id);
  }

  @Delete(':id')
  @RequierePermiso('cda.distribucion.gestionar')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Borra la distribución' })
  eliminar(@Param('id', ParseUUIDPipe) id: string) {
    return this.distribucion.eliminar(id);
  }

  @Post(':id/personas')
  @RequierePermiso('cda.distribucion.gestionar')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Agrega a alguien del personal (cualquier cargo) o a una persona externa en un día' })
  agregar(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(agregarPersonaDistribucionSchema)) body: AgregarPersonaDistribucionInput) {
    return this.distribucion.agregar(id, body);
  }

  @Patch(':id/personas/:personaId')
  @RequierePermiso('cda.distribucion.gestionar')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Cambia el día, el cantón o el encargado de una persona' })
  editar(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @Body(new ZodValidationPipe(editarPersonaDistribucionSchema)) body: EditarPersonaDistribucionInput,
  ) {
    return this.distribucion.editar(id, personaId, body);
  }

  @Post(':id/personas/:personaId/intercambiar')
  @RequierePermiso('cda.distribucion.gestionar')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Intercambia el día con otra persona del mismo sexo (los totales no cambian)' })
  intercambiar(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @Body(new ZodValidationPipe(intercambiarPersonaDistribucionSchema)) body: IntercambiarPersonaDistribucionInput,
  ) {
    return this.distribucion.intercambiar(id, personaId, body);
  }

  @Delete(':id/personas/:personaId')
  @RequierePermiso('cda.distribucion.gestionar')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Quita a una persona de la distribución' })
  quitar(@Param('id', ParseUUIDPipe) id: string, @Param('personaId', ParseUUIDPipe) personaId: string) {
    return this.distribucion.quitar(id, personaId);
  }
}
