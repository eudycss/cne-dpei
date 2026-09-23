import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AddCorreoEnlaceRequest } from '@cne/shared-types';
import { addCorreoEnlaceSchema } from '@cne/shared-validation';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { EnlacesService } from './enlaces.service';

@ApiTags('enlaces')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('enlaces')
export class EnlacesController {
  constructor(private readonly enlaces: EnlacesService) {}

  @Get()
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  @ApiOperation({ summary: 'Listar el estado actual de los enlaces de Imbabura' })
  list() {
    return this.enlaces.list();
  }

  @Get('config')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Ver la configuración de correos para avisos de enlaces caídos' })
  getConfig() {
    return this.enlaces.getConfig();
  }

  @Post('config/correos')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Agregar un correo a la lista de avisos de enlaces caídos' })
  addCorreo(@Body(new ZodValidationPipe(addCorreoEnlaceSchema)) body: AddCorreoEnlaceRequest) {
    return this.enlaces.addCorreo(body.correo);
  }

  @Delete('config/correos')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Quitar un correo de la lista de avisos de enlaces caídos' })
  removeCorreo(@Body(new ZodValidationPipe(addCorreoEnlaceSchema)) body: AddCorreoEnlaceRequest) {
    return this.enlaces.removeCorreo(body.correo);
  }
}
