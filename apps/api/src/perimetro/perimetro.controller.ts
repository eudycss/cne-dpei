import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  crearPlanPerimetroSchema,
  guardarPlanPerimetroSchema,
  listarPlanesPerimetroSchema,
  type CrearPlanPerimetroInput,
  type GuardarPlanPerimetroInput,
} from '@cne/shared-validation';
import { CurrentUser, type AuthenticatedUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { LecturaConfigurable, Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { ModuloGuard, RequiereModulo } from '../permisos-modulos/modulo.guard';
import { PermisoGuard, RequierePermiso } from '../permisos-modulos/permiso.guard';
import { PerimetroService } from './perimetro.service';

/**
 * Planes de perímetro. Ver = módulo 'plan-perimetro' (los roles de solo
 * consulta entran por @LecturaConfigurable); crear, guardar y borrar = acción
 * 'perimetro.planes.editar'. @Roles es el techo.
 */
@ApiTags('plan-perimetro')
@ApiBearerAuth()
@Controller('perimetro/planes')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
@RequiereModulo('plan-perimetro')
export class PerimetroController {
  constructor(private readonly perimetro: PerimetroService) {}

  @Get()
  @LecturaConfigurable()
  @UseGuards(ModuloGuard)
  @ApiOperation({ summary: 'Planes del evento, con cuántos puestos tienen persona' })
  listar(@Query(new ZodValidationPipe(listarPlanesPerimetroSchema)) q: { eventoId: string }) {
    return this.perimetro.listar(q.eventoId);
  }

  @Get(':id')
  @LecturaConfigurable()
  @UseGuards(ModuloGuard)
  @ApiOperation({ summary: 'Plan completo; de cada persona solo el nombre y si tiene foto' })
  detalle(@Param('id', ParseUUIDPipe) id: string) {
    return this.perimetro.detalle(id);
  }

  @Get(':id/personas/:operadorId/foto')
  @LecturaConfigurable()
  @UseGuards(ModuloGuard)
  @ApiOperation({ summary: 'Foto de una persona del plan (descifrada; no se guarda en caché)' })
  async foto(@Param('id', ParseUUIDPipe) id: string, @Param('operadorId', ParseUUIDPipe) operadorId: string, @Res() res: Response) {
    const buf = await this.perimetro.foto(id, operadorId);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }

  @Post()
  @RequierePermiso('perimetro.planes.editar')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Crea un plan en un evento' })
  crear(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(crearPlanPerimetroSchema)) body: CrearPlanPerimetroInput) {
    return this.perimetro.crear(body, user.sub);
  }

  @Put(':id')
  @RequierePermiso('perimetro.planes.editar')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Guarda el plan completo (409 si otra persona lo guardó antes)' })
  guardar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(guardarPlanPerimetroSchema)) body: GuardarPlanPerimetroInput,
  ) {
    return this.perimetro.guardar(id, body, user.sub);
  }

  @Delete(':id')
  @RequierePermiso('perimetro.planes.editar')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Borra el plan y sus puestos' })
  eliminar(@Param('id', ParseUUIDPipe) id: string) {
    return this.perimetro.eliminar(id);
  }
}
