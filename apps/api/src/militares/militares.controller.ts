import {
  Body,
  Controller,
  Delete,
  Get,
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
import type { CreateMilitarRequest, UpdateMilitarRequest } from '@cne/shared-types';

import { MilitaresService } from './militares.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

@ApiTags('militares')
@ApiBearerAuth()
@Controller('militares')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MilitaresController {
  constructor(private readonly militares: MilitaresService) {}

  @Get()
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('recintoId') recintoId?: string,
  ) {
    return this.militares.list({
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
      search,
      recintoId,
    });
  }

  @Get('template.xlsx')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'HU8: plantilla Excel de militares' })
  async template(@Res() res: Response) {
    const buf = await this.militares.generateTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=plantilla_militares.xlsx');
    res.send(buf);
  }

  @Post()
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'HU8-CA2: Alta manual de militar' })
  create(@Body() body: CreateMilitarRequest) {
    return this.militares.create(body);
  }

  @Patch(':id')
  @Roles('ADMINISTRADOR')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateMilitarRequest) {
    return this.militares.update(id, body);
  }

  @Delete(':id')
  @Roles('ADMINISTRADOR')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.militares.remove(id);
  }

  @Post('bulk')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'HU8-CA1: Carga masiva de militares (Excel/CSV)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  bulk(@UploadedFile() file: Express.Multer.File) {
    return this.militares.bulkUpload(file);
  }
}
