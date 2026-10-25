import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  cambiarActivoOperadorCdaSchema,
  crearOperadorCdaSchema,
  editarOperadorCdaSchema,
} from '@cne/shared-validation';
import type { CrearOperadorCdaRequest, EditarOperadorCdaRequest } from '@cne/shared-types';

import { OperadoresCdaService } from './operadores-cda.service';
import { parsearGrupo } from './grupo-cda';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { CurrentUser, type AuthenticatedUser } from '../common/current-user.decorator';
import { ModuloGuard, RequiereModulo } from '../permisos-modulos/modulo.guard';

@ApiTags('operadores-cda')
@ApiBearerAuth()
@Controller('operadores-cda')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OperadoresCdaController {
  constructor(private readonly operadores: OperadoresCdaService) {}

  @Get()
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
  @ApiOperation({
    summary:
      'Operadores (o, con ?grupo=ASISTENTE, asistentes) CDA activos (búsqueda por nombre o cédula). ?incluirInactivos=true: también los ocultos (solo administrador)',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('search') search?: string,
    @Query('incluirInactivos') incluirInactivos?: string,
    @Query('grupo') grupo?: unknown,
  ) {
    // Repetido (?search=a&search=b) llega como arreglo: se ignora. Se acota el largo.
    return this.operadores.list({
      search: typeof search === 'string' ? search.slice(0, 100) : undefined,
      incluirInactivos: incluirInactivos === 'true' && user.roles.includes('ADMINISTRADOR'),
      grupo: parsearGrupo(grupo),
    });
  }

  @Post()
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Agrega un operador a mano (alguien que no vino en el Excel)' })
  crear(@Body(new ZodValidationPipe(crearOperadorCdaSchema)) body: CrearOperadorCdaRequest) {
    return this.operadores.crear(body);
  }

  @Patch(':id')
  @Roles('ADMINISTRADOR')
  @ApiOperation({
    summary: 'Corrige los datos de un operador (la cédula no cambia)',
    description: 'Reemplaza todos los datos editables: un campo opcional ausente se guarda vacío.',
  })
  editar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(editarOperadorCdaSchema)) body: EditarOperadorCdaRequest,
  ) {
    return this.operadores.editar(id, body);
  }

  @Patch(':id/activo')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Oculta (baja lógica) o reactiva a un operador' })
  cambiarActivo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(cambiarActivoOperadorCdaSchema)) body: { activo: boolean },
  ) {
    return this.operadores.cambiarActivo(id, body.activo);
  }

  @Post('importar')
  @Roles('ADMINISTRADOR')
  @ApiOperation({
    summary: 'Importa el Excel de operadores (o, con ?grupo=ASISTENTE, asistentes) CDA. Sin ?aplicar=true solo devuelve la vista previa',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } }))
  importar(
    @UploadedFile() file: Express.Multer.File,
    @Query('aplicar') aplicar?: string,
    @Query('grupo') grupo?: unknown,
  ) {
    return this.operadores.importar(file, { aplicar: aplicar === 'true', grupo: parsearGrupo(grupo) });
  }
}
