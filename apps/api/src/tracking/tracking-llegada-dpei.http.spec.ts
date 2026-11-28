import { NotFoundException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { crearAppHttp } from '../common/testing/app-http';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { ROLES_KEY } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { EventoNoReabiertoGuard } from '../common/evento-no-reabierto.guard';
import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';
import { InformeOperadorService } from './informe-operador.service';
import { EstadisticasJornadaService } from './estadisticas-jornada.service';
import { ReporteLlegadaDpeiService } from './reporte-llegada-dpei.service';

/** GET /tracking/reporte-llegada-dpei(.xlsx|.pdf) por HTTP real (Zod + filtros), servicio simulado. */
describe('HTTP /tracking/reporte-llegada-dpei', () => {
  let app: NestExpressApplication;
  const llegada = { reporte: jest.fn(), exportar: jest.fn() };
  const sesion = {
    canActivate: (ctx: ExecutionContext) => {
      ctx.switchToHttp().getRequest().user = { sub: 'u1', email: null, roles: ['ADMINISTRADOR'], debeCambiarPwd: false };
      return true;
    },
  };

  beforeAll(async () => {
    app = await crearAppHttp(
      [TrackingController],
      [
        { provide: TrackingService, useValue: {} },
        { provide: InformeOperadorService, useValue: {} },
        { provide: EstadisticasJornadaService, useValue: {} },
        { provide: ReporteLlegadaDpeiService, useValue: llegada },
      ],
      [
        [JwtAuthGuard, sesion],
        [RolesGuard, { canActivate: () => true }],
        [EventoNoReabiertoGuard, { canActivate: () => true }],
      ],
    );
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('en pantalla: pasa la fecha al servicio', async () => {
    llegada.reporte.mockResolvedValue({ evento: 'E', fecha: '2026-11-29', resumen: {}, cdas: [] });
    const r = await request(app.getHttpServer()).get('/tracking/reporte-llegada-dpei?fecha=2026-11-29');
    expect(r.status).toBe(200);
    expect(llegada.reporte).toHaveBeenCalledWith('2026-11-29');
  });

  it('sin fecha: el día actual (undefined)', async () => {
    llegada.reporte.mockResolvedValue(null);
    const r = await request(app.getHttpServer()).get('/tracking/reporte-llegada-dpei');
    expect(r.status).toBe(200);
    expect(llegada.reporte).toHaveBeenCalledWith(undefined);
  });

  it('fecha inválida o parámetro extra: 400 sin llegar al servicio', async () => {
    for (const q of ['fecha=29-11-2026', 'fecha=2026-02-30', 'otro=1']) {
      const r = await request(app.getHttpServer()).get(`/tracking/reporte-llegada-dpei.xlsx?${q}`);
      expect(r.status).toBe(400);
    }
    expect(llegada.exportar).not.toHaveBeenCalled();
  });

  it('Excel y PDF: adjunto con su nombre y sin caché', async () => {
    llegada.exportar.mockImplementation(async (_f: string | undefined, formato: 'xlsx' | 'pdf') => ({
      nombre: `llegada_dpei_cdas_2026-11-29.${formato}`,
      tipo: formato === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      contenido: Buffer.from('x'),
    }));
    for (const formato of ['xlsx', 'pdf'] as const) {
      const r = await request(app.getHttpServer()).get(`/tracking/reporte-llegada-dpei.${formato}?fecha=2026-11-29`);
      expect(r.status).toBe(200);
      expect(r.headers['content-disposition']).toBe(`attachment; filename="llegada_dpei_cdas_2026-11-29.${formato}"`);
      expect(r.headers['cache-control']).toBe('no-store');
      expect(llegada.exportar).toHaveBeenCalledWith('2026-11-29', formato);
    }
  });

  it('sin evento activo: 404', async () => {
    llegada.exportar.mockRejectedValue(new NotFoundException('No hay un evento activo'));
    const r = await request(app.getHttpServer()).get('/tracking/reporte-llegada-dpei.pdf');
    expect(r.status).toBe(404);
  });

  it('lo ven el Administrador y el Lector (los roles de Reportes › Flujo)', () => {
    for (const m of ['reporteLlegadaDpei', 'reporteLlegadaDpeiXlsx', 'reporteLlegadaDpeiPdf'] as const) {
      expect(new Reflector().get(ROLES_KEY, TrackingController.prototype[m])).toEqual(['ADMINISTRADOR', 'LECTOR']);
    }
  });
});
