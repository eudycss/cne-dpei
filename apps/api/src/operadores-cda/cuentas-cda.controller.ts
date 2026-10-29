import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CuentasCdaService } from './cuentas-cda.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

/** Cuentas de la app de los Operadores y Asistentes CDA (solo administrador). */
@ApiTags('operadores-cda')
@ApiBearerAuth()
@Controller('operadores-cda/cuentas')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMINISTRADOR')
export class CuentasCdaController {
  constructor(private readonly cuentas: CuentasCdaService) {}

  @Get('resumen')
  @ApiOperation({ summary: 'Conteos de cuentas de la app de operadores y asistentes activos' })
  resumen() {
    return this.cuentas.resumen();
  }

  @Post('sincronizar')
  @ApiOperation({
    summary: 'Crea o vincula la cuenta de cada operador/asistente activo sin cuenta',
    description:
      'Si ya existe un usuario con su cédula, se vincula sin cambiar su contraseña. Si no, se crea sin correo, con la contraseña inicial y cambio obligatorio.',
  })
  sincronizar() {
    return this.cuentas.sincronizar();
  }

  @Post('desactivar-sin-vinculo')
  @ApiOperation({
    summary: 'Desactiva las cuentas Operador CDA (único rol) que no corresponden a nadie de Operadores CDA',
  })
  desactivarSinVinculo() {
    return this.cuentas.desactivarSinVinculo();
  }
}
