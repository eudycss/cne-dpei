import { BadRequestException, ConflictException, type ExecutionContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { crearAppHttp } from '../common/testing/app-http';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { EventoNoReabiertoGuard } from '../common/evento-no-reabierto.guard';
import { TrackingController } from './tracking.controller';
import { NO_CDA_ANTES_DE_LLEGAR, NO_CDA_TRAS_SALIDA, TrackingService } from './tracking.service';
import { InformeOperadorService } from './informe-operador.service';
import { EstadisticasJornadaService } from './estadisticas-jornada.service';

/** POST /tracking/llegada-no-cda por HTTP real (Zod + filtros), servicio simulado y sesión de operador. */
describe('HTTP POST /tracking/llegada-no-cda', () => {
  let app: NestExpressApplication;
  const tracking = { registrarLlegadaNoCda: jest.fn() };
  const NO_CDA = '55555555-5555-4555-8555-555555555555';
  const sesionOperador = {
    canActivate: (ctx: ExecutionContext) => {
      ctx.switchToHttp().getRequest().user = { sub: 'op-1', email: null, roles: ['OPERADOR_CDA'], debeCambiarPwd: false };
      return true;
    },
  };

  beforeAll(async () => {
    app = await crearAppHttp(
      [TrackingController],
      [
        { provide: TrackingService, useValue: tracking },
        { provide: InformeOperadorService, useValue: {} },
        { provide: EstadisticasJornadaService, useValue: {} },
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

  const enviar = (body: object) => request(app.getHttpServer()).post('/tracking/llegada-no-cda').send(body);

  it('ya en el CDA: 201 y el servicio recibe al operador de la sesión', async () => {
    tracking.registrarLlegadaNoCda.mockResolvedValue({ id: 'x', recintoId: NO_CDA, ocurridoEn: '2026-11-27T10:00:00Z' });
    const r = await enviar({ recintoId: NO_CDA });
    expect(r.status).toBe(201);
    expect(tracking.registrarLlegadaNoCda).toHaveBeenCalledWith('op-1', { recintoId: NO_CDA });
  });

  it('antes de llegar al CDA: 400 con el mensaje que ve el operador', async () => {
    tracking.registrarLlegadaNoCda.mockRejectedValue(new BadRequestException(NO_CDA_ANTES_DE_LLEGAR));
    const r = await enviar({ recintoId: NO_CDA });
    expect(r.status).toBe(400);
    expect(r.body.message).toBe(NO_CDA_ANTES_DE_LLEGAR);
  });

  it('después de salir del CDA: 409', async () => {
    tracking.registrarLlegadaNoCda.mockRejectedValue(new ConflictException(NO_CDA_TRAS_SALIDA));
    const r = await enviar({ recintoId: NO_CDA });
    expect(r.status).toBe(409);
    expect(r.body.message).toBe(NO_CDA_TRAS_SALIDA);
  });

  it('un recintoId que no es UUID: 400 sin llegar al servicio', async () => {
    const r = await enviar({ recintoId: 'abc' });
    expect(r.status).toBe(400);
    expect(tracking.registrarLlegadaNoCda).not.toHaveBeenCalled();
  });
});
