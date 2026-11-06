import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import type { GuardarConvocatoriaCdaRequest } from '@cne/shared-types';
import { guardarConvocatoriaCdaSchema } from '@cne/shared-validation';

import { ConvocatoriaCdaService } from './convocatoria-cda.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthenticatedUser } from '../common/current-user.decorator';
import { PermisoGuard, RequierePermiso } from '../permisos-modulos/permiso.guard';
import { ModuloGuard, RequiereModulo } from '../permisos-modulos/modulo.guard';

/** Solo texto: un parámetro repetido (?fecha=a&fecha=b) llega como arreglo. */
const texto = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** Convocatoria del día (personal CDA y CPE): la ve quien ve el módulo; la cambia quien tiene el permiso. */
@ApiTags('operadores-cda')
@ApiBearerAuth()
@Controller('operadores-cda')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
export class ConvocatoriaCdaController {
  constructor(private readonly convocatoria: ConvocatoriaCdaService) {}

  @Get('convocatoria')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @ApiOperation({ summary: 'Convocatoria de un día (?fecha=AAAA-MM-DD): todo el personal y quién está convocado' })
  dia(@Query('fecha') fecha?: unknown) {
    return this.convocatoria.dia(texto(fecha));
  }

  @Get('convocatoria/plantilla.xlsx')
  @RequiereModulo('operadores-cda')
  @UseGuards(ModuloGuard)
  @ApiOperation({ summary: 'Plantilla Excel de la convocatoria (Fecha y Cédula)' })
  async plantilla(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=plantilla_convocatoria.xlsx');
    res.send(await this.convocatoria.plantilla());
  }

  @Post('convocatoria/carga')
  @RequierePermiso('cda.convocatoria.gestionar')
  @UseGuards(PermisoGuard)
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Agregar convocados desde Excel/CSV (Fecha + Cédula; aplicar=false: vista previa)' })
  cargar(
    @UploadedFile() file: Express.Multer.File,
    @Query('fecha') fecha: unknown,
    @Query('aplicar') aplicar: unknown,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.convocatoria.cargar(file, texto(fecha), aplicar === 'true', user?.sub);
  }

  @Put('convocatoria/:fecha')
  @RequierePermiso('cda.convocatoria.gestionar')
  @UseGuards(PermisoGuard)
  @ApiOperation({ summary: 'Guardar los convocados a mano de un día (los de Parejas cuentan solos)' })
  guardar(
    @Param('fecha') fecha: string,
    @Body(new ZodValidationPipe(guardarConvocatoriaCdaSchema)) body: GuardarConvocatoriaCdaRequest,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.convocatoria.guardar(fecha, body, user?.sub);
  }
}
