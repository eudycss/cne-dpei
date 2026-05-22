import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as dotenv from 'dotenv';
import * as path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { AppModule } from '../src/app.module';
import { ZodValidationExceptionFilter } from '../src/common/zod-validation.filter';

/**
 * Flujo end-to-end de Fase 1 (HU1, HU7, HU9):
 *   1. Login con el admin sembrado
 *   2. Crear un usuario nuevo (devuelve contraseña inicial)
 *   3. Asignar rol OPERADOR_CDA al nuevo usuario
 *   4. Login con el nuevo usuario → debeCambiarPwd = true
 *   5. Cambio de contraseña obligatorio
 *   6. Login con la nueva contraseña → debeCambiarPwd = false
 *
 * Requiere postgres levantado y `pnpm db:seed` ejecutado.
 */
describe('Auth + Users (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  const unique = Date.now();
  const newUserEmail = `e2e_${unique}@cne-test.gob.ec`;
  const newUserCedula = String(1700000000 + (unique % 100000000)).slice(0, 10);
  let initialPassword = '';
  const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@cne-imbabura.gob.ec';
  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD ?? 'Admin*Inicial2026';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new ZodValidationExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('1. login admin', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: adminPassword })
      .expect(200);
    expect(res.body.accessToken).toBeDefined();
    expect(res.body.user.roles).toContain('ADMINISTRADOR');
    adminToken = res.body.accessToken;
  });

  it('2. crea usuario nuevo', async () => {
    const res = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        cedula: newUserCedula,
        email: newUserEmail,
        nombres: 'Operador',
        apellidos: 'E2E',
        telefono: '+593990000000',
      })
      .expect(201);
    expect(res.body.email).toBe(newUserEmail);
    expect(res.body.initialPassword).toBeDefined();
    initialPassword = res.body.initialPassword;
  });

  it('3. asigna rol OPERADOR_CDA', async () => {
    const rolesRes = await request(app.getHttpServer())
      .get('/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const operador = rolesRes.body.find((r: any) => r.nombre === 'OPERADOR_CDA');
    expect(operador).toBeDefined();

    const usersRes = await request(app.getHttpServer())
      .get(`/users?search=${encodeURIComponent(newUserEmail)}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const created = usersRes.body.items.find((u: any) => u.email === newUserEmail);
    expect(created).toBeDefined();

    await request(app.getHttpServer())
      .post('/users/assign-roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userIds: [created.id], roleIds: [operador.id] })
      .expect(201);
  });

  it('4. login nuevo usuario → debeCambiarPwd', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: newUserEmail, password: initialPassword })
      .expect(200);
    expect(res.body.user.debeCambiarPwd).toBe(true);
    expect(res.body.user.roles).toContain('OPERADOR_CDA');
  });

  it('5. cambio de contraseña obligatorio', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: newUserEmail, password: initialPassword })
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ currentPassword: initialPassword, newPassword: 'NuevaClave*2026X' })
      .expect(204);
  });

  it('6. login con nueva contraseña → debeCambiarPwd false', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: newUserEmail, password: 'NuevaClave*2026X' })
      .expect(200);
    expect(res.body.user.debeCambiarPwd).toBe(false);
  });

  it('rechaza contraseña débil en cambio', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: newUserEmail, password: 'NuevaClave*2026X' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/auth/change-password')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .send({ currentPassword: 'NuevaClave*2026X', newPassword: 'corta' })
      .expect(400);
  });
});
