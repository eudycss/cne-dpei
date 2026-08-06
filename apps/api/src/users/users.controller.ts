import {
  Body,
  Controller,
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

import { UsersService } from './users.service';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type { CreateUserRequest, UpdateUserRequest, AssignRolesRequest } from '@cne/shared-types';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { assignRolesSchema } from '@cne/shared-validation';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  @ApiOperation({ summary: 'Listado paginado de usuarios' })
  list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
    @Query('role') role?: string,
    @Query('activo') activo?: string,
  ) {
    return this.users.list({
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
      search,
      role,
      activo: activo === undefined ? undefined : activo === 'true',
    });
  }

  @Get('template.xlsx')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Plantilla Excel para carga masiva (HU7)' })
  async template(@Res() res: Response) {
    const buf = await this.users.generateTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=plantilla_usuarios.xlsx');
    res.send(buf);
  }

  @Post()
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'HU7-CA2: Alta manual de usuario' })
  create(@Body() body: CreateUserRequest) {
    return this.users.create(body);
  }

  @Patch(':id')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Editar usuario' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateUserRequest) {
    return this.users.update(id, body);
  }

  @Post(':id/reset-password')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Restablecer contraseña de un usuario (contraseña temporal)' })
  resetPassword(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.resetPassword(id);
  }

  @Post('bulk')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'HU7-CA1: Carga masiva desde Excel/CSV' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  bulk(@UploadedFile() file: Express.Multer.File) {
    return this.users.bulkUpload(file);
  }

  @Post('assign-roles')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'HU9: Asignación de roles en bulk' })
  assignRoles(
    @Body(new ZodValidationPipe(assignRolesSchema)) body: AssignRolesRequest,
  ) {
    return this.users.assignRoles(body.userIds, body.roleIds);
  }
}
