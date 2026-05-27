import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { SalidaDpiRequest } from '@cne/shared-types';
import { salidaDpiSchema } from '@cne/shared-validation';

import { TrackingService } from './tracking.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import type { AuthenticatedUser } from '../common/current-user.decorator';
import { ZodValidationPipe } from '../common/zod-body.pipe';

@ApiTags('tracking')
@ApiBearerAuth()
@Controller('tracking')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  @Get('mi-asignacion')
  @Roles('OPERADOR_CDA')
  @ApiOperation({
    summary: 'HU2-CA1: detalle de recinto, militar y kits asignados al operador',
  })
  miAsignacion(@CurrentUser() user: AuthenticatedUser) {
    return this.tracking.miAsignacion(user.sub);
  }

  @Post('salida-dpi')
  @Roles('OPERADOR_CDA')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'HU2-CA2/CA3: registra la salida del DPI con ubicación GPS puntual',
  })
  registrarSalidaDpi(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(salidaDpiSchema)) body: SalidaDpiRequest,
  ) {
    return this.tracking.registrarSalidaDpi(user.sub, body);
  }
}
