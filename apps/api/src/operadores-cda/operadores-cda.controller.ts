import { Controller, Get, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

import { OperadoresCdaService } from './operadores-cda.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';

@ApiTags('operadores-cda')
@ApiBearerAuth()
@Controller('operadores-cda')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OperadoresCdaController {
  constructor(private readonly operadores: OperadoresCdaService) {}

  @Get()
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL')
  @ApiOperation({ summary: 'Operadores CDA activos (búsqueda por nombre o cédula)' })
  list(@Query('search') search?: string) {
    // Repetido (?search=a&search=b) llega como arreglo: se ignora. Se acota el largo.
    return this.operadores.list({ search: typeof search === 'string' ? search.slice(0, 100) : undefined });
  }

  @Post('importar')
  @Roles('ADMINISTRADOR')
  @ApiOperation({
    summary: 'Importa el Excel de operadores CDA. Sin ?aplicar=true solo devuelve la vista previa',
  })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } }))
  importar(@UploadedFile() file: Express.Multer.File, @Query('aplicar') aplicar?: string) {
    return this.operadores.importar(file, { aplicar: aplicar === 'true' });
  }
}
