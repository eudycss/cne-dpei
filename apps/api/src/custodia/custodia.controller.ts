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
import { Throttle } from '@nestjs/throttler';
import {
  actasMilitaresSeleccionSchema,
  opcionesActaMilitarSchema,
  type OpcionesActaMilitar,
  cambiarOperadorSchema,
  corregirMilitarSchema,
  registrarEntregaSchema,
  validarKitSchema,
} from '@cne/shared-validation';
import type { z } from 'zod';
import type {
  CambiarOperadorRequest,
  CorregirMilitarRequest,
  RegistrarEntregaRequest,
  ValidarKitRequest,
} from '@cne/shared-types';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { enviarPdf } from '../common/pdf';
import { RolesGuard } from '../common/roles.guard';
import { EventoNoReabiertoGuard } from '../common/evento-no-reabierto.guard';
import { LecturaConfigurable, Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthenticatedUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { ModuloGuard, RequiereModulo } from '../permisos-modulos/modulo.guard';
import { CustodiaService } from './custodia.service';
import { FiltrosInforme, InformeCustodiaService } from './informe-custodia.service';

/** Cadena de custodia del kit en la DPEI (Asistente Electoral Transversal). */
@ApiTags('custodia')
@ApiBearerAuth()
@RequiereModulo('cadena-custodia')
@Controller('custodia')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ASISTENTE_TRANSVERSAL', 'ADMINISTRADOR')
export class CustodiaController {
  constructor(
    private readonly custodia: CustodiaService,
    private readonly informes: InformeCustodiaService,
  ) {}

  @Get('resumen')
  @ApiOperation({ summary: 'Avance de entregas a militares del evento activo (entregados de total)' })
  resumen() {
    return this.custodia.resumen();
  }

  @Post('validar-kit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ficha del kit escaneado: recinto, operador, militares del recinto y entrega' })
  validarKit(@Body(new ZodValidationPipe(validarKitSchema)) body: ValidarKitRequest) {
    return this.custodia.validarKit(body.codigo);
  }

  @Post('entregas')
  @UseGuards(EventoNoReabiertoGuard)
  @ApiOperation({ summary: 'Registra la entrega del kit a un militar en la DPEI' })
  registrarEntrega(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(registrarEntregaSchema)) body: RegistrarEntregaRequest,
  ) {
    return this.custodia.registrarEntrega(user.sub, body);
  }

  @Patch('entregas/:kitId/militar')
  @UseGuards(EventoNoReabiertoGuard)
  @ApiOperation({ summary: 'Corrige el militar de la entrega (con motivo; queda en el historial)' })
  corregirMilitar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('kitId', ParseUUIDPipe) kitId: string,
    @Body(new ZodValidationPipe(corregirMilitarSchema)) body: CorregirMilitarRequest,
  ) {
    return this.custodia.corregirMilitar(user.sub, user.roles, kitId, body);
  }

  @Patch('kits/:kitId/operador')
  @UseGuards(EventoNoReabiertoGuard)
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

  // ─── Informe y actas (lectura): los roles a los que el admin les active el módulo ───

  @LecturaConfigurable()
  @Get('informe')
  @Roles('ASISTENTE_TRANSVERSAL', 'ADMINISTRADOR', 'LECTOR', 'TECNICO_SUPERVISOR')
  @RequiereModulo('cadena-custodia')
  @UseGuards(ModuloGuard)
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
  @Roles('ASISTENTE_TRANSVERSAL', 'ADMINISTRADOR', 'LECTOR', 'TECNICO_SUPERVISOR')
  @RequiereModulo('cadena-custodia')
  @UseGuards(ModuloGuard)
  @ApiOperation({ summary: 'Actas de cadena de custodia de los kits filtrados (un PDF, una página por kit)' })
  async actas(
    @Res() res: Response,
    @Query('cantonId') cantonId?: unknown,
    @Query('recintoId') recintoId?: unknown,
  ) {
    enviarPdf(res, await this.informes.actas(filtrosInforme(cantonId, recintoId)), 'actas-custodia.pdf');
  }

  @Get('kits/:kitId/acta')
  @Roles('ASISTENTE_TRANSVERSAL', 'ADMINISTRADOR', 'LECTOR', 'TECNICO_SUPERVISOR')
  @RequiereModulo('cadena-custodia')
  @UseGuards(ModuloGuard)
  @ApiOperation({ summary: 'Acta de cadena de custodia de un kit (PDF)' })
  async actaKit(@Res() res: Response, @Param('kitId', ParseUUIDPipe) kitId: string) {
    enviarPdf(res, await this.informes.actaKit(kitId), 'acta-custodia.pdf');
  }

  // Acta de Constancia y Custodia que firma el militar (Word, formato oficial).
  @Get('kits/:kitId/acta-militar')
  @Roles('ASISTENTE_TRANSVERSAL', 'ADMINISTRADOR', 'LECTOR', 'TECNICO_SUPERVISOR')
  @RequiereModulo('cadena-custodia')
  @UseGuards(ModuloGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Acta de constancia y custodia del militar de un kit (?formato=docx|pdf, ?responsableId=, ?fecha=AAAA-MM-DD)' })
  async actaMilitarKit(
    @Res() res: Response,
    @Param('kitId', ParseUUIDPipe) kitId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(opcionesActaMilitarSchema)) opciones: OpcionesActaMilitar,
  ) {
    const acta = await this.informes.actaMilitarKit(kitId, user.sub, opciones);
    enviarArchivo(res, acta.contenido, acta.nombre, acta.tipo);
  }

  @Get('responsables-acta')
  @Roles('ASISTENTE_TRANSVERSAL', 'ADMINISTRADOR', 'LECTOR', 'TECNICO_SUPERVISOR')
  @RequiereModulo('cadena-custodia')
  @UseGuards(ModuloGuard)
  @ApiOperation({ summary: 'Asistentes Transversales activos que pueden firmar como responsables del acta militar' })
  responsablesActa() {
    return this.informes.responsablesActa();
  }

  @Get('actas-militares')
  @Roles('ASISTENTE_TRANSVERSAL', 'ADMINISTRADOR', 'LECTOR', 'TECNICO_SUPERVISOR')
  @RequiereModulo('cadena-custodia')
  @UseGuards(ModuloGuard)
  // Hasta 200 Word en un .zip: cuesta CPU (Render 0.1 vCPU).
  @Throttle({ default: { limit: 4, ttl: 60_000 } })
  @ApiOperation({ summary: 'Actas de constancia y custodia de los kits filtrados (un Word por kit, en .zip)' })
  async actasMilitares(
    @Res() res: Response,
    @CurrentUser() user: AuthenticatedUser,
    @Query('cantonId') cantonId?: unknown,
    @Query('recintoId') recintoId?: unknown,
  ) {
    const archivo = await this.informes.actasMilitares(filtrosInforme(cantonId, recintoId), user.sub);
    enviarArchivo(res, archivo.contenido, archivo.nombre, archivo.tipo);
  }

  // Las actas de lo que quedó en la tabla (buscador por recinto, operador,
  // militar, cantón…): los ids van en el cuerpo (hasta 200, no caben en la URL).
  @Post('actas-militares/seleccion')
  @HttpCode(HttpStatus.OK)
  @Roles('ASISTENTE_TRANSVERSAL', 'ADMINISTRADOR', 'LECTOR', 'TECNICO_SUPERVISOR')
  @RequiereModulo('cadena-custodia')
  @UseGuards(ModuloGuard)
  @Throttle({ default: { limit: 4, ttl: 60_000 } })
  @ApiOperation({ summary: 'Actas de constancia y custodia de los kits elegidos: un solo PDF (formato=pdf) o un Word por kit en .zip' })
  async actasMilitaresSeleccion(
    @Res() res: Response,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(actasMilitaresSeleccionSchema)) body: z.infer<typeof actasMilitaresSeleccionSchema>,
  ) {
    const { kitIds, ...opciones } = body;
    const archivo = await this.informes.actasMilitaresSeleccion(kitIds, user.sub, opciones);
    enviarArchivo(res, archivo.contenido, archivo.nombre, archivo.tipo);
  }
}


function enviarArchivo(res: Response, contenido: Buffer, nombre: string, tipo: string): void {
  res.setHeader('Content-Type', tipo);
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  // Llevan cédulas: que ningún caché los guarde.
  res.setHeader('Cache-Control', 'no-store');
  res.send(contenido);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Filtros opcionales del informe; un valor inválido se ignora en vez de romper la consulta. */
export function filtrosInforme(cantonId: unknown, recintoId: unknown): FiltrosInforme {
  const canton = typeof cantonId === 'string' && /^\d{1,6}$/.test(cantonId) ? Number(cantonId) : undefined;
  const recinto = typeof recintoId === 'string' && UUID.test(recintoId) ? recintoId : undefined;
  return { cantonId: canton, recintoId: recinto };
}

/** ?buscar= puede llegar repetido (arreglo) o ausente: solo se acepta un texto, recortado. */
export function textoBusqueda(valor: unknown): string {
  return typeof valor === 'string' ? valor.slice(0, 60) : '';
}
