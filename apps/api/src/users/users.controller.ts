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
import { Throttle } from '@nestjs/throttler';

import { UsersService } from './users.service';
import { Roles, SoloAdmin } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { RequiereModulo } from '../permisos-modulos/modulo.guard';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import type {
  CreateUserRequest,
  UpdateUserRequest,
  AssignRolesRequest,
  ResetPasswordBulkRequest,
} from '@cne/shared-types';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { assignRolesSchema, resetPasswordBulkSchema } from '@cne/shared-validation';
import { CurrentUser, type AuthenticatedUser } from '../common/current-user.decorator';

@ApiTags('users')
@ApiBearerAuth()
@RequiereModulo('usuarios')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR', 'LECTOR')
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
  @SoloAdmin()
  @ApiOperation({ summary: 'Plantilla Excel para carga masiva (HU7)' })
  async template(@Res() res: Response) {
    const buf = await this.users.generateTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=plantilla_usuarios.xlsx');
    res.send(buf);
  }

  @Post()
  @Roles('ADMINISTRADOR')
  @SoloAdmin()
  @ApiOperation({ summary: 'HU7-CA2: Alta manual de usuario' })
  create(@Body() body: CreateUserRequest) {
    return this.users.create(body);
  }

  @Patch(':id')
  @Roles('ADMINISTRADOR')
  @SoloAdmin()
  @ApiOperation({ summary: 'Editar usuario' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateUserRequest) {
    return this.users.update(id, body);
  }

  @Post('reset-password-bulk')
  @Roles('ADMINISTRADOR')
  @SoloAdmin()
  // Cada llamada calcula hasta 50 hashes argon2 y la web envía por lotes:
  // 30 por minuto = mismo tope de antes (~1500 hashes/min).
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Restablecer la contraseña de varios usuarios a su cédula' })
  resetPasswordBulk(
    @Body(new ZodValidationPipe(resetPasswordBulkSchema)) body: ResetPasswordBulkRequest,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.users.resetPasswordBulk(body, user.sub);
  }

  @Post(':id/reset-password')
  @Roles('ADMINISTRADOR')
  @SoloAdmin()
  @ApiOperation({ summary: 'Restablecer contraseña de un usuario (contraseña temporal)' })
  resetPassword(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.resetPassword(id);
  }

  @Post(':id/desbloquear')
  @Roles('ADMINISTRADOR')
  @SoloAdmin()
  @ApiOperation({ summary: 'Levantar el bloqueo por contraseñas erróneas' })
  desbloquear(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.desbloquear(id);
  }

  @Post('bulk')
  @Roles('ADMINISTRADOR')
  @SoloAdmin()
  @ApiOperation({ summary: 'HU7-CA1: Carga masiva desde Excel/CSV' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  bulk(@UploadedFile() file: Express.Multer.File) {
    return this.users.bulkUpload(file);
  }

  @Post('assign-roles')
  @Roles('ADMINISTRADOR')
  @SoloAdmin()
  @ApiOperation({ summary: 'HU9: Asignación de roles en bulk' })
  assignRoles(
    @Body(new ZodValidationPipe(assignRolesSchema)) body: AssignRolesRequest,
  ) {
    return this.users.assignRoles(body.userIds, body.roleIds);
  }
}
