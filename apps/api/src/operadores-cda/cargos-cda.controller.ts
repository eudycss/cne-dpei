import { BadRequestException, Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  cambiarActivoCargoCdaSchema,
  crearCargoCdaSchema,
  grupoCdaSchema,
  renombrarCargoCdaSchema,
} from '@cne/shared-validation';
import type { CrearCargoCdaRequest, GrupoCda, RenombrarCargoCdaRequest } from '@cne/shared-types';

import { CargosCdaService } from './cargos-cda.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { ModuloGuard, RequiereModulo } from '../permisos-modulos/modulo.guard';

/** :clave de la ruta: con forma de clave de cargo; si no, 400. */
export function parsearClave(v: unknown): GrupoCda {
  const r = grupoCdaSchema.safeParse(v);
  if (!r.success) throw new BadRequestException('Cargo inválido');
  return r.data;
}

@ApiTags('operadores-cda')
@ApiBearerAuth()
@Controller('cargos-cda')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CargosCdaController {
  constructor(private readonly cargos: CargosCdaService) {}

  @Get()
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
  @ApiOperation({ summary: 'Cargos del personal CDA y CPE (también los desactivados), con sus personas activas' })
  listar() {
    return this.cargos.listar();
  }

  @Post()
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Agrega un cargo (nombre y centro CDA o CPE; el centro no cambia después)' })
  crear(@Body(new ZodValidationPipe(crearCargoCdaSchema)) body: CrearCargoCdaRequest) {
    return this.cargos.crear(body);
  }

  @Patch(':clave')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Cambia el nombre visible de un cargo' })
  renombrar(@Param('clave') clave: string, @Body(new ZodValidationPipe(renombrarCargoCdaSchema)) body: RenombrarCargoCdaRequest) {
    return this.cargos.renombrar(parsearClave(clave), body);
  }

  @Patch(':clave/activo')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Desactiva o reactiva un cargo (su personal e historial se conservan)' })
  cambiarActivo(@Param('clave') clave: string, @Body(new ZodValidationPipe(cambiarActivoCargoCdaSchema)) body: { activo: boolean }) {
    return this.cargos.cambiarActivo(parsearClave(clave), body.activo);
  }
}
