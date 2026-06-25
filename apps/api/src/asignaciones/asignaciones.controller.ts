import {
  Body,
  Controller,
  Delete,
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
import type { UpsertAsignacionRequest } from '@cne/shared-types';
import { upsertAsignacionSchema } from '@cne/shared-validation';

import { AsignacionesService } from './asignaciones.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';

@ApiTags('asignaciones')
@ApiBearerAuth()
@Controller('asignaciones')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AsignacionesController {
  constructor(private readonly asignaciones: AsignacionesService) {}

  @Get()
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  @ApiOperation({ summary: 'HU10: listar asignaciones operador↔supervisor por evento' })
  list(@Query('eventoId', ParseUUIDPipe) eventoId: string) {
    return this.asignaciones.list(eventoId);
  }

  @Get('template.xlsx')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'HU10: plantilla Excel de carga masiva de asignaciones' })
  async template(@Res() res: Response) {
    const buf = await this.asignaciones.generateTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=plantilla_asignaciones.xlsx');
    res.send(buf);
  }

  @Post('bulk')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'HU10: carga masiva de asignaciones operador↔supervisor (Excel/CSV)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  bulk(@UploadedFile() file: Express.Multer.File, @Query('eventoId') eventoId: string) {
    return this.asignaciones.bulkUpload(file, eventoId);
  }

  @Put()
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'HU10: crear o actualizar asignación (upsert)' })
  upsert(
    @Body(new ZodValidationPipe(upsertAsignacionSchema)) body: UpsertAsignacionRequest,
  ) {
    return this.asignaciones.upsert(body);
  }

  @Delete(':id')
  @Roles('ADMINISTRADOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'HU10: eliminar asignación' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.asignaciones.remove(id);
  }
}
