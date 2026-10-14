import { Body, Controller, Delete, Get, Headers, Logger, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AddCorreoEnlaceRequest } from '@cne/shared-types';
import { addCorreoEnlaceSchema } from '@cne/shared-validation';
import { JwtAuthGuard, Public } from '../common/jwt-auth.guard';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { EnlacesEstadisticasService, filtroEstadisticas } from './enlaces-estadisticas.service';
import { EnlacesService, type TelegramUpdate } from './enlaces.service';

@ApiTags('enlaces')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('enlaces')
export class EnlacesController {
  private readonly log = new Logger('EnlacesController');

  constructor(
    private readonly enlaces: EnlacesService,
    private readonly estadisticas: EnlacesEstadisticasService,
  ) {}

  @Get()
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  @ApiOperation({ summary: 'Listar el estado actual de los enlaces de Imbabura' })
  list() {
    return this.enlaces.list();
  }

  @Get('estadisticas')
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  @ApiOperation({
    summary: 'Caídas y tiempo caído por recinto en un día, semana (lunes-domingo) o mes, hora de Ecuador',
  })
  estadisticasPeriodo(@Query('periodo') periodo?: unknown, @Query('fecha') fecha?: unknown) {
    const filtro = filtroEstadisticas(periodo, fecha);
    return this.estadisticas.estadisticas(filtro.periodo, filtro.dia);
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

  @Post('telegram/reenviar')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Reenviar a Telegram la lista actual de enlaces caídos' })
  reenviarListaTelegram() {
    return this.enlaces.reenviarListaTelegram();
  }

  @Post('telegram/webhook')
  @Public()
  @ApiOperation({
    summary:
      'Webhook de Telegram: procesa comandos entrantes (/caidos, el botón fijo del teclado, o el flujo de ingresar código)',
  })
  telegramWebhook(
    @Headers('x-telegram-bot-api-secret-token') secretToken: string | undefined,
    @Body() update: TelegramUpdate,
  ): { ok: true } {
    // Se contesta a Telegram al instante y la respuesta del bot sale en segundo
    // plano: si Telegram espera demasiado (envío lento o con reintento), da el
    // update por fallido y lo reenvía, y el grupo recibe la respuesta repetida.
    void this.enlaces
      .procesarComandoTelegram(secretToken, update)
      .catch((e) => this.log.error(`Error procesando un update de Telegram: ${(e as Error)?.message ?? e}`));
    return { ok: true };
  }
}
