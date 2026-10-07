import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  cambiarOperadorSchema,
  corregirMilitarSchema,
  registrarEntregaSchema,
  validarKitSchema,
} from '@cne/shared-validation';
import type {
  CambiarOperadorRequest,
  CorregirMilitarRequest,
  RegistrarEntregaRequest,
  ValidarKitRequest,
} from '@cne/shared-types';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthenticatedUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { CustodiaService } from './custodia.service';

/** Cadena de custodia del kit en el DPEI (Asistente Electoral Transversal). */
@ApiTags('custodia')
@ApiBearerAuth()
@Controller('custodia')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ASISTENTE_TRANSVERSAL', 'ADMINISTRADOR')
export class CustodiaController {
  constructor(private readonly custodia: CustodiaService) {}

  @Post('validar-kit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ficha del kit escaneado: recinto, operador, militares del recinto y entrega' })
  validarKit(@Body(new ZodValidationPipe(validarKitSchema)) body: ValidarKitRequest) {
    return this.custodia.validarKit(body.codigo);
  }

  @Post('entregas')
  @ApiOperation({ summary: 'Registra la entrega del kit a un militar en el DPEI' })
  registrarEntrega(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(registrarEntregaSchema)) body: RegistrarEntregaRequest,
  ) {
    return this.custodia.registrarEntrega(user.sub, body);
  }

  @Patch('entregas/:kitId/militar')
  @ApiOperation({ summary: 'Corrige el militar de la entrega (con motivo; queda en el historial)' })
  corregirMilitar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kitId', ParseUUIDPipe) kitId: string,
    @Body(new ZodValidationPipe(corregirMilitarSchema)) body: CorregirMilitarRequest,
  ) {
    return this.custodia.corregirMilitar(user.sub, user.roles, kitId, body);
  }

  @Patch('kits/:kitId/operador')
  @ApiOperation({ summary: 'Cambia el operador CDA del kit (con motivo; queda en el historial)' })
  cambiarOperador(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kitId', ParseUUIDPipe) kitId: string,
    @Body(new ZodValidationPipe(cambiarOperadorSchema)) body: CambiarOperadorRequest,
  ) {
    return this.custodia.cambiarOperador(user.sub, kitId, body);
  }

  @Get('militares')
  @ApiOperation({ summary: 'Busca militares de cualquier recinto por cédula o nombre' })
  buscarMilitares(@Query('buscar') buscar?: unknown) {
    return this.custodia.buscarMilitares(textoBusqueda(buscar));
  }

  @Get('operadores')
  @ApiOperation({ summary: 'Busca operadores CDA activos por cédula o nombre' })
  buscarOperadores(@Query('buscar') buscar?: unknown) {
    return this.custodia.buscarOperadores(textoBusqueda(buscar));
  }
}

/** ?buscar= puede llegar repetido (arreglo) o ausente: solo se acepta un texto, recortado. */
export function textoBusqueda(valor: unknown): string {
  return typeof valor === 'string' ? valor.slice(0, 60) : '';
}
