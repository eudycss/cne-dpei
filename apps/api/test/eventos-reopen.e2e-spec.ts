import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import * as dotenv from 'dotenv';
import * as path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { AppModule } from '../src/app.module';
import { ZodValidationExceptionFilter } from '../src/common/zod-validation.filter';
import { PrismaService } from '../src/db/prisma.service';

const EVENTO_ID = '00000000-0000-0000-0000-00000000e001'; // TEST E2E
const OPERADOR_ID = '00000000-0000-0000-0000-0000000000a1';

/**
 * Reabrir un evento cerrado solo para consulta:
 *   reopen (justificación) -> móvil bloqueado con 403 -> lectura OK ->
 *   bitácora EVENTO_REOPEN -> cierre sin pendientes que limpia reabiertoEn.
 * Usa el evento TEST E2E. Si hay otro evento ACTIVO lo pasa a BORRADOR durante
 * la prueba y al final deja todo como estaba.
 *
 * Requiere postgres levantado y `pnpm db:seed` ejecutado.
 */
describe('Reabrir evento (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let operadorToken: string;
  let otrosActivos: string[] = [];
  let estadoOriginal: { estado: any; cerradoEn: Date | null; reabiertoEn: Date | null };

  async function token(jwt: JwtService, sub: string, email: string, roles: string[]) {
    return jwt.signAsync(
      { sub, email, roles, debeCambiarPwd: false },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '5m' },
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new ZodValidationExceptionFilter());
    await app.init();
    prisma = app.get(PrismaService);

    const evento = await prisma.eventoElectoral.findUniqueOrThrow({ where: { id: EVENTO_ID } });
    estadoOriginal = { estado: evento.estado, cerradoEn: evento.cerradoEn, reabiertoEn: evento.reabiertoEn };
    otrosActivos = (
      await prisma.eventoElectoral.findMany({
        where: { estado: 'ACTIVO', id: { not: EVENTO_ID } },
        select: { id: true },
      })
    ).map((e) => e.id);
    await prisma.eventoElectoral.updateMany({ where: { id: { in: otrosActivos } }, data: { estado: 'BORRADOR' } });
    await prisma.eventoElectoral.update({
      where: { id: EVENTO_ID },
      data: { estado: 'CERRADO', cerradoEn: new Date(), reabiertoEn: null },
    });

    const admin = await prisma.usuario.findFirstOrThrow({
      where: { roles: { some: { rol: { nombre: 'ADMINISTRADOR' } } } },
    });
    const jwt = app.get(JwtService);
    adminToken = await token(jwt, admin.id, admin.email, ['ADMINISTRADOR']);
    operadorToken = await token(jwt, OPERADOR_ID, 'test.operador.a@cne-imbabura.gob.ec', ['OPERADOR_CDA']);
  });

  afterAll(async () => {
    if (prisma && estadoOriginal) {
      await prisma.eventoElectoral.update({ where: { id: EVENTO_ID }, data: estadoOriginal });
      await prisma.eventoElectoral.updateMany({ where: { id: { in: otrosActivos } }, data: { estado: 'ACTIVO' } });
    }
    await app?.close();
  });

  it('1. exige justificación', async () => {
    await request(app.getHttpServer())
      .post(`/eventos/${EVENTO_ID}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ justificacion: 'corto' })
      .expect(400);
  });

  it('2. el operador no puede reabrir', async () => {
    await request(app.getHttpServer())
      .post(`/eventos/${EVENTO_ID}/reopen`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ justificacion: 'Sacar informe de custodia' })
      .expect(403);
  });

  it('3. el admin lo reabre y queda ACTIVO marcado como reabierto', async () => {
    const res = await request(app.getHttpServer())
      .post(`/eventos/${EVENTO_ID}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ justificacion: 'Sacar informe de custodia' })
      .expect(200);
    expect(res.body.estado).toBe('ACTIVO');
    expect(res.body.reabiertoEn).toEqual(expect.any(String));
  });

  it('4. la app móvil no puede registrar (403), pero sí leer', async () => {
    const res = await request(app.getHttpServer())
      .post('/tracking/salida-dpi')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ latitud: 0.35, longitud: -78.12, ocurridoEn: new Date().toISOString() })
      .expect(403);
    expect(res.body.message).toMatch(/reabierto solo para consulta/);

    await request(app.getHttpServer())
      .get('/tracking/mi-asignacion')
      .set('Authorization', `Bearer ${operadorToken}`)
      .expect(200);
  });

  it('5. la justificación queda en la bitácora', async () => {
    const fila = await prisma.bitacoraAuditoria.findFirst({
      where: { accion: 'EVENTO_REOPEN', entidadId: EVENTO_ID },
      orderBy: { id: 'desc' },
    });
    expect(fila?.datosDespues).toMatchObject({ justificacion: 'Sacar informe de custodia' });
  });

  it('6. se vuelve a cerrar sin justificación de pendientes y limpia reabiertoEn', async () => {
    const res = await request(app.getHttpServer())
      .post(`/eventos/${EVENTO_ID}/close`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ confirmar: true })
      .expect(200);
    expect(res.body.estado).toBe('CERRADO');
    expect(res.body.reabiertoEn).toBeNull();
  });
});
