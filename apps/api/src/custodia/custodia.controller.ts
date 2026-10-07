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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
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
import { FiltrosInforme, InformeCustodiaService } from './informe-custodia.service';

/** Cadena de custodia del kit en el DPEI (Asistente Electoral Transversal). */
@ApiTags('custodia')
@ApiBearerAuth()
@Controller('custodia')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ASISTENTE_TRANSVERSAL', 'ADMINISTRADOR')
export class CustodiaController {
  constructor(
    private readonly custodia: CustodiaService,
    private readonly informes: InformeCustodiaService,
  ) {}

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

  // ─── Informe y actas (lectura: también el LECTOR) ─────────────────────────

  @Get('informe')
  @Roles('ASISTENTE_TRANSVERSAL', 'ADMINISTRADOR', 'LECTOR')
  @ApiOperation({ summary: 'Informe consolidado de cadena de custodia (una fila por kit del evento activo)' })
  informe(
    @Res({ passthrough: true }) res: Response,
    @Query('cantonId') cantonId?: unknown,
    @Query('recintoId') recintoId?: unknown,
  ) {
    // Lleva cédulas: que ningún caché (navegador o proxy) lo guarde.
    res.setHeader('Cache-Control', 'no-store');
    return this.informes.informe(filtrosInforme(cantonId, recintoId));
  }

  @Get('actas')
  @Roles('ASISTENTE_TRANSVERSAL', 'ADMINISTRADOR', 'LECTOR')
  @ApiOperation({ summary: 'Actas de cadena de custodia de los kits filtrados (un PDF, una página por kit)' })
  async actas(
    @Res() res: Response,
    @Query('cantonId') cantonId?: unknown,
    @Query('recintoId') recintoId?: unknown,
  ) {
    enviarPdf(res, await this.informes.actas(filtrosInforme(cantonId, recintoId)), 'actas-custodia.pdf');
  }

  @Get('kits/:kitId/acta')
  @Roles('ASISTENTE_TRANSVERSAL', 'ADMINISTRADOR', 'LECTOR')
  @ApiOperation({ summary: 'Acta de cadena de custodia de un kit (PDF)' })
  async actaKit(@Res() res: Response, @Param('kitId', ParseUUIDPipe) kitId: string) {
    enviarPdf(res, await this.informes.actaKit(kitId), 'acta-custodia.pdf');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Filtros opcionales del informe; un valor inválido se ignora en vez de romper la consulta. */
export function filtrosInforme(cantonId: unknown, recintoId: unknown): FiltrosInforme {
  const canton = typeof cantonId === 'string' && /^\d{1,6}$/.test(cantonId) ? Number(cantonId) : undefined;
  const recinto = typeof recintoId === 'string' && UUID.test(recintoId) ? recintoId : undefined;
  return { cantonId: canton, recintoId: recinto };
}

function enviarPdf(res: Response, pdf: Buffer, archivo: string) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${archivo}"`);
  // Lleva cédulas y la foto del militar: que ningún caché lo guarde.
  res.setHeader('Cache-Control', 'no-store');
  res.send(pdf);
}

/** ?buscar= puede llegar repetido (arreglo) o ausente: solo se acepta un texto, recortado. */
export function textoBusqueda(valor: unknown): string {
  return typeof valor === 'string' ? valor.slice(0, 60) : '';
}
