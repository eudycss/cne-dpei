import type { ExecutionContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { crearAppHttp } from '../common/testing/app-http';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { ParejasCdaController } from './parejas-cda.controller';
import { ParejasCdaService } from './parejas-cda.service';
import { PermisosModulosService } from '../permisos-modulos/permisos-modulos.service';

/** POST /parejas-cda/asignar-kits por HTTP real (Zod + RolesGuard real), servicio simulado. */
describe('HTTP POST /parejas-cda/asignar-kits', () => {
  let app: NestExpressApplication;
  const parejas = { asignarKits: jest.fn() };
  let rol = 'ADMINISTRADOR';
  const sesion = {
    canActivate: (ctx: ExecutionContext) => {
      ctx.switchToHttp().getRequest().user = { sub: 'admin-1', email: null, roles: [rol], debeCambiarPwd: false };
      return true;
    },
  };
  const ID1 = '11111111-1111-4111-8111-111111111111';
  const ID2 = '22222222-2222-4222-8222-222222222222';

  beforeAll(async () => {
    app = await crearAppHttp(
      [ParejasCdaController],
      [
        { provide: ParejasCdaService, useValue: parejas },
        // RolesGuard real: el módulo de roles configurables no se usa con estos roles.
        { provide: PermisosModulosService, useValue: { misModulos: jest.fn().mockResolvedValue({ modulos: [], permisos: [] }) } },
      ],
      [[JwtAuthGuard, sesion]],
    );
  });
  afterAll(() => app.close());
  beforeEach(() => {
    jest.clearAllMocks();
    rol = 'ADMINISTRADOR';
  });

  const enviar = (body: object, fecha = '2026-11-29') =>
    request(app.getHttpServer()).post(`/parejas-cda/asignar-kits?fecha=${fecha}`).send(body);

  it('las elegidas y la justificación llegan al servicio con la fecha', async () => {
    parejas.asignarKits.mockResolvedValue({ enApp: 2, kitsCreados: 1, sinKit: 0, errores: [] });
    const r = await enviar({ ids: [ID1, ID2], justificacion: 'Llegaron tarde a la lista' });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ enApp: 2, kitsCreados: 1, sinKit: 0, errores: [] });
    expect(parejas.asignarKits).toHaveBeenCalledWith('2026-11-29', [ID1, ID2], 'Llegaron tarde a la lista');
  });

  it.each([
    ['sin parejas', { ids: [] }],
    ['un id que no es UUID', { ids: ['abc'] }],
    ['parejas repetidas', { ids: [ID1, ID1] }],
    ['campos de más', { ids: [ID1], otro: 1 }],
  ])('%s: 400 sin llegar al servicio', async (_caso, body) => {
    const r = await enviar(body);
    expect(r.status).toBe(400);
    expect(parejas.asignarKits).not.toHaveBeenCalled();
  });

  it('una fecha inválida: 400', async () => {
    const r = await enviar({ ids: [ID1] }, 'mañana');
    expect(r.status).toBe(400);
    expect(parejas.asignarKits).not.toHaveBeenCalled();
  });

  it('solo el ADMINISTRADOR: un Técnico supervisor recibe 403', async () => {
    rol = 'TECNICO_SUPERVISOR';
    const r = await enviar({ ids: [ID1] });
    expect(r.status).toBe(403);
    expect(parejas.asignarKits).not.toHaveBeenCalled();
  });
});
