import { BadRequestException, ConflictException, type ExecutionContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { crearAppHttp } from '../common/testing/app-http';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { EventoNoReabiertoGuard } from '../common/evento-no-reabierto.guard';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { InformeOperadorService } from './informe-operador.service';
import { EstadisticasJornadaService } from './estadisticas-jornada.service';
import { ReporteLlegadaDpeiService } from './reporte-llegada-dpei.service';

/** POST /tracking/llegada-no-cda por HTTP real (Zod + filtros), servicio simulado y sesión de operador. */
/** POST /tracking/llegada-recinto por HTTP real: la llegada registrada al escanear el kit se reconoce (201), no 409. */
describe('HTTP POST /tracking/llegada-recinto', () => {
  let app: NestExpressApplication;
  const tracking = { registrarLlegadaRecinto: jest.fn() };
  const sesionOperador = {
    canActivate: (ctx: ExecutionContext) => {
      ctx.switchToHttp().getRequest().user = { sub: 'op-1', email: null, roles: ['OPERADOR_CDA'], debeCambiarPwd: false };
      return true;
    },
  };
  const body = { latitud: 0.35, longitud: -78.11, ocurridoEn: '2026-11-29T15:00:00.000Z' };

  beforeAll(async () => {
    app = await crearAppHttp(
      [TrackingController],
      [
        { provide: TrackingService, useValue: tracking },
        { provide: InformeOperadorService, useValue: {} },
        { provide: EstadisticasJornadaService, useValue: {} },
        { provide: ReporteLlegadaDpeiService, useValue: {} },
      ],
      [
        [JwtAuthGuard, sesionOperador],
        [RolesGuard, { canActivate: () => true }],
        [EventoNoReabiertoGuard, { canActivate: () => true }],
      ],
    );
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('llegada ya registrada por el escaneo del kit: 201 con la misma llegada', async () => {
    tracking.registrarLlegadaRecinto.mockResolvedValue({ id: 'llegada-kit', ocurridoEn: '2026-11-29T14:50:00.000Z' });
    const r = await request(app.getHttpServer()).post('/tracking/llegada-recinto').send(body);
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ id: 'llegada-kit', ocurridoEn: '2026-11-29T14:50:00.000Z' });
    expect(tracking.registrarLlegadaRecinto).toHaveBeenCalledWith('op-1', body);
  });

  it('faltan kits: 400 con el mensaje', async () => {
    tracking.registrarLlegadaRecinto.mockRejectedValue(new BadRequestException('Faltan 1 kit(s) por confirmar antes de registrar la llegada'));
    const r = await request(app.getHttpServer()).post('/tracking/llegada-recinto').send(body);
    expect(r.status).toBe(400);
    expect(r.body.message).toContain('Faltan 1 kit(s)');
  });

  it('ya registrada por el operador: 409', async () => {
    tracking.registrarLlegadaRecinto.mockRejectedValue(new ConflictException('Ya registraste tu llegada al recinto'));
    const r = await request(app.getHttpServer()).post('/tracking/llegada-recinto').send(body);
    expect(r.status).toBe(409);
  });
});
