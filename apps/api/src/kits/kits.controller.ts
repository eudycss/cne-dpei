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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import type {
  AsignarKitRequest,
  CreateKitRequest,
  DesasignarKitRequest,
  PdfQrRequest,
} from '@cne/shared-types';
import {
  asignarKitSchema,
  createKitSchema,
  desasignarKitSchema,
  pdfQrSchema,
} from '@cne/shared-validation';

import { KitsService } from './kits.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';

@ApiTags('kits')
@ApiBearerAuth()
@Controller('kits')
@UseGuards(JwtAuthGuard, RolesGuard)
export class KitsController {
  constructor(private readonly kits: KitsService) {}

  @Get()
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  @ApiOperation({ summary: 'HU11: listar kits electorales de un evento' })
  list(
    @Query('eventoId') eventoId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ) {
    if (!eventoId) return { items: [], total: 0, page: 1, pageSize: 20 };
    return this.kits.list({
      eventoId,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
      search,
    });
  }

  @Get('template.xlsx')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'HU11: plantilla Excel de carga masiva de kits' })
  async template(@Res() res: Response) {
    const buf = await this.kits.generateTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=plantilla_kits.xlsx');
    res.send(buf);
  }

  @Post()
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'HU11-CA1: crear kit electoral con código QR único' })
  create(
    @Body(new ZodValidationPipe(createKitSchema)) body: CreateKitRequest,
  ) {
    return this.kits.create(body);
  }

  @Post('bulk')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'HU11: carga masiva de kits (Excel/CSV) con asignación opcional' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  bulk(@UploadedFile() file: Express.Multer.File, @Query('eventoId') eventoId: string) {
    return this.kits.bulkUpload(file, eventoId);
  }

  @Patch(':id/asignar')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Asignar un kit a un operador y un recinto' })
  asignar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(asignarKitSchema)) body: AsignarKitRequest,
  ) {
    return this.kits.asignar(id, body);
  }

  @Patch(':id/desasignar')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Quitar la asignación de operador/recinto de un kit' })
  desasignar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(desasignarKitSchema)) body: DesasignarKitRequest,
  ) {
    return this.kits.desasignar(id, body);
  }

  @Post('pdf-qr')
  @Roles('ADMINISTRADOR')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'HU11-CA3: exportar PDF con etiquetas QR de kits seleccionados' })
  async pdfQr(
    @Body(new ZodValidationPipe(pdfQrSchema)) body: PdfQrRequest,
    @Res() res: Response,
  ) {
    const buffer = await this.kits.generatePdfQr(body);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=kits-qr.pdf');
    res.send(buffer);
  }
}
