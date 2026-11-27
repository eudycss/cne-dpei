import type { ExecutionContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { crearAppHttp } from '../common/testing/app-http';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { ModuloGuard } from '../permisos-modulos/modulo.guard';
import { PermisosModulosService } from '../permisos-modulos/permisos-modulos.service';
import { OperadoresCdaController } from './operadores-cda.controller';
import { OperadoresCdaService } from './operadores-cda.service';

/** GET /operadores-cda/reporte-personal.(xlsx|pdf) por HTTP real (Zod + RolesGuard real), servicio simulado. */
describe('HTTP GET /operadores-cda/reporte-personal', () => {
  let app: NestExpressApplication;
  const operadores = { reportePersonal: jest.fn() };
  let rol = 'ADMINISTRADOR';
  let permisos = ['cda.personal.exportar'];
  const sesion = {
    canActivate: (ctx: ExecutionContext) => {
      ctx.switchToHttp().getRequest().user = { sub: 'u-1', email: null, roles: [rol], debeCambiarPwd: false };
      return true;
    },
  };

  beforeAll(async () => {
    app = await crearAppHttp(
      [OperadoresCdaController],
      [
        { provide: OperadoresCdaService, useValue: operadores },
        { provide: PermisosModulosService, useValue: { misModulos: jest.fn(async () => ({ modulos: ['operadores-cda'], permisos })) } },
      ],
      [
        [JwtAuthGuard, sesion],
        // El acceso por módulo tiene su propio spec; aquí se prueba el rol.
        [ModuloGuard, { canActivate: () => true }],
      ],
    );
  });
  afterAll(() => app.close());
  beforeEach(() => {
    jest.clearAllMocks();
    rol = 'ADMINISTRADOR';
    permisos = ['cda.personal.exportar'];
    operadores.reportePersonal.mockResolvedValue({
      nombre: 'personal_cda_2026-11-27.xlsx',
      tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      contenido: Buffer.from('xlsx'),
    });
  });

  const pedir = (ruta: string) => request(app.getHttpServer()).get(`/operadores-cda/${ruta}`);

  it('cargos repetidos y el modo llegan al servicio; descarga sin caché', async () => {
    const r = await pedir('reporte-personal.xlsx?cargos=OPERADOR&cargos=DIGITADOR&cargos=OPERADOR&modo=POR_CARGO');
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toBe('attachment; filename="personal_cda_2026-11-27.xlsx"');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(operadores.reportePersonal).toHaveBeenCalledWith({ cargos: ['OPERADOR', 'DIGITADOR'], modo: 'POR_CARGO' }, 'xlsx');
  });

  it('un solo cargo y sin modo: general en PDF', async () => {
    const r = await pedir('reporte-personal.pdf?cargos=SUPERVISOR');
    expect(r.status).toBe(200);
    expect(operadores.reportePersonal).toHaveBeenCalledWith({ cargos: ['SUPERVISOR'], modo: 'GENERAL' }, 'pdf');
  });

  it.each([
    ['sin cargos', 'reporte-personal.xlsx'],
    ['una clave inválida', 'reporte-personal.xlsx?cargos=operador'],
    ['un modo desconocido', 'reporte-personal.xlsx?cargos=OPERADOR&modo=POR_DIA'],
  ])('%s: 400 sin llegar al servicio', async (_caso, ruta) => {
    const r = await pedir(ruta);
    expect(r.status).toBe(400);
    expect(operadores.reportePersonal).not.toHaveBeenCalled();
  });

  it.each(['TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL'])('%s también lo descarga', async (r) => {
    rol = r;
    expect((await pedir('reporte-personal.xlsx?cargos=OPERADOR')).status).toBe(200);
  });

  it('sin la acción "Descargar el reporte del personal" el rol recibe 403', async () => {
    rol = 'ASISTENTE_TRANSVERSAL';
    permisos = ['cda.asistencia.exportar'];
    const r = await pedir('reporte-personal.pdf?cargos=OPERADOR');
    expect(r.status).toBe(403);
    expect(operadores.reportePersonal).not.toHaveBeenCalled();
  });

  it('un Operador CDA recibe 403', async () => {
    rol = 'OPERADOR_CDA';
    const r = await pedir('reporte-personal.xlsx?cargos=OPERADOR');
    expect(r.status).toBe(403);
    expect(operadores.reportePersonal).not.toHaveBeenCalled();
  });
});
