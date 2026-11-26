import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Reflector } from '@nestjs/core';
import request from 'supertest';

import { ROLES_KEY } from '../common/roles.decorator';

import { crearAppHttp } from '../common/testing/app-http';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { EventoNoReabiertoGuard } from '../common/evento-no-reabierto.guard';
import { ModuloGuard } from '../permisos-modulos/modulo.guard';
import { CustodiaController } from './custodia.controller';
import { CustodiaService } from './custodia.service';
import { InformeCustodiaService } from './informe-custodia.service';

/** Sesión simulada: los guards reales se prueban en sus propios specs. */
const conSesion: CanActivate = {
  canActivate: (ctx: ExecutionContext) => {
    ctx.switchToHttp().getRequest().user = { sub: 'u1', roles: ['ADMINISTRADOR'] };
    return true;
  },
};

/** Actas militares de la selección de la tabla, por HTTP real (Zod + cabeceras). */
describe('HTTP POST /custodia/actas-militares/seleccion', () => {
  let app: NestExpressApplication;
  const informes = { actasMilitaresSeleccion: jest.fn() };
  const kit = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`;

  beforeAll(async () => {
    app = await crearAppHttp(
      [CustodiaController],
      [
        { provide: CustodiaService, useValue: {} },
        { provide: InformeCustodiaService, useValue: informes },
      ],
      [
        [JwtAuthGuard, conSesion],
        [RolesGuard, conSesion],
        [ModuloGuard, conSesion],
        [EventoNoReabiertoGuard, conSesion],
      ],
    );
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('los kits elegidos llegan al servicio y vuelve un .zip sin caché', async () => {
    informes.actasMilitaresSeleccion.mockResolvedValue(Buffer.from('PK'));
    const r = await request(app.getHttpServer())
      .post('/custodia/actas-militares/seleccion')
      .send({ kitIds: [kit(1), kit(2)] });

    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('application/zip');
    expect(r.headers['content-disposition']).toBe('attachment; filename="actas_militares.zip"');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(informes.actasMilitaresSeleccion).toHaveBeenCalledWith([kit(1), kit(2)], 'u1');
  });

  it('mismos roles y módulo que las demás actas (los guards reales prueban el 403)', () => {
    const reflector = new Reflector();
    const metodo = CustodiaController.prototype.actasMilitaresSeleccion;
    expect(reflector.get(ROLES_KEY, metodo)).toEqual(reflector.get(ROLES_KEY, CustodiaController.prototype.actasMilitares));
    expect(reflector.get(ROLES_KEY, metodo)).not.toContain('OPERADOR_CDA');
    expect(Reflect.getMetadata('__guards__', metodo)).toContain(ModuloGuard);
  });

  it('las 200 de la provincia caben; vacío, más de 200, ids inválidos o campos de más → 400', async () => {
    informes.actasMilitaresSeleccion.mockResolvedValue(Buffer.from('PK'));
    const doscientos = Array.from({ length: 200 }, (_, i) => kit(i));
    const ok = await request(app.getHttpServer()).post('/custodia/actas-militares/seleccion').send({ kitIds: doscientos });
    expect(ok.status).toBe(200);

    for (const body of [{ kitIds: [] }, { kitIds: [...doscientos, kit(999)] }, { kitIds: ['no-uuid'] }, { kitIds: [kit(1)], x: 1 }, {}]) {
      const r = await request(app.getHttpServer()).post('/custodia/actas-militares/seleccion').send(body);
      expect(r.status).toBe(400);
    }
    expect(informes.actasMilitaresSeleccion).toHaveBeenCalledTimes(1);
  });
});
