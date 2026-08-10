import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  loginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from '@cne/shared-validation';

import { AuthService } from './auth.service';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { JwtAuthGuard, Public } from '../common/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/current-user.decorator';

@ApiTags('auth')
@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'HU1: Inicio de sesión' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', format: 'email', example: 'admin@cne-imbabura.gob.ec' },
        password: { type: 'string', format: 'password' },
      },
      required: ['email', 'password'],
    },
  })
  login(@Body(new ZodValidationPipe(loginSchema)) body: { email: string; password: string }) {
    return this.auth.login(body.email, body.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renovar access token' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { refreshToken: { type: 'string' } },
      required: ['refreshToken'],
    },
  })
  refresh(@Body() body: { refreshToken: string }) {
    return this.auth.refresh(body.refreshToken);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.logout(user.sub);
  }

  @ApiBearerAuth()
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'HU1-CA3: Cambio obligatorio de contraseña' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        currentPassword: { type: 'string', format: 'password' },
        newPassword: { type: 'string', format: 'password' },
      },
      required: ['currentPassword', 'newPassword'],
    },
  })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(changePasswordSchema))
    body: { currentPassword: string; newPassword: string },
  ) {
    return this.auth.changePassword(user.sub, body.currentPassword, body.newPassword);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'HU16: Solicitar enlace de recuperación' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { email: { type: 'string', format: 'email' } },
      required: ['email'],
    },
  })
  forgotPassword(@Body(new ZodValidationPipe(forgotPasswordSchema)) body: { email: string }) {
    return this.auth.forgotPassword(body.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'HU16: Establecer nueva contraseña con token' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        token: { type: 'string' },
        newPassword: { type: 'string', format: 'password' },
      },
      required: ['token', 'newPassword'],
    },
  })
  resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema))
    body: { token: string; newPassword: string },
  ) {
    return this.auth.resetPassword(body.token, body.newPassword);
  }
}
