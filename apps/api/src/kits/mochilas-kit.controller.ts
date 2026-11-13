import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
import type { NumeroMochilaRequest } from '@cne/shared-types';
import { numeroMochilaRequestSchema } from '@cne/shared-validation';

import { MochilasKitService } from './mochilas-kit.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { RequiereModulo } from '../permisos-modulos/modulo.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthenticatedUser } from '../common/current-user.decorator';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** N.º de mochila ↔ QR del kit: editar uno, cargar desde Excel y el reporte del evento. */
@ApiTags('kits')
@ApiBearerAuth()
@RequiereModulo('kits')
@Controller('kits')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MochilasKitController {
  constructor(private readonly mochilas: MochilasKitService) {}

  @Get('mochilas/plantilla.xlsx')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Plantilla Excel para cargar los N.º de mochila' })
  async plantilla(@Res() res: Response) {
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', 'attachment; filename=plantilla_mochilas.xlsx');
    res.send(await this.mochilas.plantilla());
  }

  @Get('mochilas/reporte.xlsx')
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'LECTOR')
  @ApiOperation({ summary: 'Reporte Excel: N.º de mochila, QR, recinto y pareja de cada kit del evento' })
  async reporte(@Query('eventoId', ParseUUIDPipe) eventoId: string, @Res() res: Response) {
    const buffer = await this.mochilas.reporte(eventoId);
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', 'attachment; filename=mochilas_kits.xlsx');
    res.send(buffer);
  }

  @Post('mochilas/carga')
  @Roles('ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cargar N.º de mochila desde Excel/CSV (aplicar=false: solo vista previa)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  cargar(
    @UploadedFile() file: Express.Multer.File,
    @Query('eventoId', ParseUUIDPipe) eventoId: string,
    @Query('aplicar') aplicar: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.mochilas.cargar(file, eventoId, aplicar === 'true', user?.sub);
  }

  @Get('mochilas/qr/:codigo')
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  @ApiOperation({ summary: 'QR escaneado: su kit, recinto y N.º de mochila (si ya tiene)' })
  porQr(@Param('codigo') codigo: string) {
    return this.mochilas.porQr(codigo);
  }

  /** El supervisor registra o corrige al escanear; pasarle un número de otro QR es solo del administrador. */
  @Put(':id/mochila')
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  @ApiOperation({ summary: 'Poner, cambiar o quitar (null) el N.º de mochila del QR del kit' })
  asignar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(numeroMochilaRequestSchema)) body: NumeroMochilaRequest,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.mochilas.asignar(id, body, user?.sub, user?.roles?.includes('ADMINISTRADOR') ?? false);
  }
}
