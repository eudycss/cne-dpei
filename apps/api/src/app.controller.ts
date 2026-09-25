import { Controller, Get } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from './common/jwt-auth.guard';

@Controller()
export class AppController {
  /** Sin autenticación ni body: pensado para pings de mantenimiento (evitar que
   * Render duerma el servicio por inactividad, lo que además detiene el cron
   * de @nestjs/schedule) y para checks de salud de infraestructura. */
  @Get('health')
  @Public()
  @ApiExcludeEndpoint()
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
