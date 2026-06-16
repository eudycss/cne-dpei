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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CreateRecintoRequest, UpdateRecintoRequest } from '@cne/shared-types';
import { RecintosService } from './recintos.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

@ApiTags('catalogo')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CatalogController {
  constructor(private readonly recintos: RecintosService) {}

  @Get('recintos')
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  @ApiOperation({ summary: 'Listar recintos (paginado, búsqueda y filtros)' })
  listRecintos(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('cantonId') cantonId?: string,
    @Query('tipo') tipo?: 'CDA' | 'NO_CDA',
    @Query('cdaDestinoId') cdaDestinoId?: string,
  ) {
    return this.recintos.listRecintos({
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50,
      search,
      cantonId: cantonId ? Number(cantonId) : undefined,
      tipo,
      cdaDestinoId,
    });
  }

  @Post('recintos/bulk')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Carga masiva de recintos desde Excel/CSV' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  bulkRecintos(@UploadedFile() file: Express.Multer.File) {
    return this.recintos.bulkUpload(file);
  }

  @Get('recintos/:id')
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  getRecinto(@Param('id', ParseUUIDPipe) id: string) {
    return this.recintos.getRecinto(id);
  }

  @Post('recintos')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Alta de recinto electoral' })
  create(@Body() body: CreateRecintoRequest) {
    return this.recintos.create(body);
  }

  @Patch('recintos/:id')
  @Roles('ADMINISTRADOR')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateRecintoRequest) {
    return this.recintos.update(id, body);
  }

  @Delete('recintos/:id')
  @Roles('ADMINISTRADOR')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.recintos.remove(id);
  }

  @Get('cantones')
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  @ApiOperation({ summary: 'Listar cantones de Imbabura' })
  listCantones() {
    return this.recintos.listCantones();
  }
}
