import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import * as argon2 from 'argon2';
import * as dotenv from 'dotenv';
import * as path from 'node:path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { AppModule } from '../src/app.module';
import { ZodValidationExceptionFilter } from '../src/common/zod-validation.filter';
import { PrismaService } from '../src/db/prisma.service';
import { TrackingService } from '../src/tracking/tracking.service';

// PNG 1x1 transparente, usado como "foto del militar" en HU3-CA2.
const MIN_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

const EVENTO_ID = '00000000-0000-0000-0000-00000000e001';
const OPERADOR_ID = '00000000-0000-0000-0000-0000000000a1';
const KIT_ID = '00000000-0000-0000-0000-0000000000c1';
const RECINTO_ID = 'eb6b1982-f5e1-4d6c-a4a8-b851561607c6'; // Escuela Manuela Cañizares (TEST-KIT-A)
const OPERADOR_EMAIL = 'test.operador.a@cne-imbabura.gob.ec';
const OPERADOR_PASSWORD = 'Test*OperadorA2026';

// "DPI" sintético y punto del recinto (Escuela Manuela Cañizares, kit TEST-KIT-A).
const DPI = { latitud: 0.35, longitud: -78.12 };
const RECINTO = { latitud: 0.2960868, longitud: -78.2672478 };
// Última posición del lote de /tracking/posiciones (paso 9). estado-cdas
// prioriza posiciones_gps sobre el punto de eventos_tracking.LLEGADA_DPI.
const ULTIMA_POSICION = { latitud: 0.3316635, longitud: -78.1700643 };

function iso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

/**
 * Flujo end-to-end del operador (HU2-HU5) con coordenadas GPS fijas, sin
 * depender de un dispositivo/Expo Go:
 *   salida-dpi -> foto-militar -> validar-kit -> recepcion-kit ->
 *   llegada-recinto -> salida-recinto -> posiciones -> llegada-dpi
 * Reutiliza el operador/kit de prueba `...a1` / TEST-KIT-A del evento
 * TEST E2E (00000000-0000-0000-0000-00000000e001). Verifica al final que
 * GET /tracking/estado-cdas refleje RETORNADO para ese recinto.
 *
 * Requiere postgres levantado y `pnpm db:seed` ejecutado.
 */
describe('Tracking flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let operadorToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new ZodValidationExceptionFilter());
    await app.init();

    prisma = app.get(PrismaService);

    // Contraseña fija conocida para `test.operador.a` (fixture de prueba).
    const passwordHash = await argon2.hash(OPERADOR_PASSWORD);
    await prisma.usuario.update({
      where: { id: OPERADOR_ID },
      data: { passwordHash, debeCambiarPwd: false },
    });

    // Deja al operador/kit en el estado inicial para que el flujo sea repetible.
    await prisma.$executeRaw`DELETE FROM eventos_tracking WHERE operador_id = ${OPERADOR_ID}::uuid AND evento_id = ${EVENTO_ID}::uuid`;
    await prisma.$executeRaw`DELETE FROM recepciones_kit WHERE kit_id = ${KIT_ID}::uuid`;
    await prisma.$executeRaw`DELETE FROM posiciones_gps WHERE operador_id = ${OPERADOR_ID}::uuid AND evento_id = ${EVENTO_ID}::uuid`;
    await prisma.kitElectoral.update({ where: { id: KIT_ID }, data: { estado: 'ASIGNADO' } });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('1. login operador de prueba', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: OPERADOR_EMAIL, password: OPERADOR_PASSWORD })
      .expect(200);
    expect(res.body.user.roles).toContain('OPERADOR_CDA');
    operadorToken = res.body.accessToken;
  });

  it('2. mi-asignacion: kit pendiente de recepción', async () => {
    const res = await request(app.getHttpServer())
      .get('/tracking/mi-asignacion')
      .set('Authorization', `Bearer ${operadorToken}`)
      .expect(200);
    expect(res.body.eventoId).toBe(EVENTO_ID);
    expect(res.body.yaRegistroSalida).toBe(false);
    expect(res.body.kits.find((k: any) => k.id === KIT_ID)?.recibido).toBe(false);
  });

  it('3. registra salida del DPI', async () => {
    const res = await request(app.getHttpServer())
      .post('/tracking/salida-dpi')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ ...DPI, ocurridoEn: iso() })
      .expect(201);
    expect(res.body.id).toBeDefined();
  });

  it('4. sube foto del militar', async () => {
    const res = await request(app.getHttpServer())
      .post('/tracking/foto-militar')
      .set('Authorization', `Bearer ${operadorToken}`)
      .attach('file', MIN_PNG, 'militar.png')
      .expect(201);
    expect(res.body.fotoUrl).toBeDefined();
    (global as any).__fotoUrl = res.body.fotoUrl;
  });

  it('5. valida el kit por código', async () => {
    const res = await request(app.getHttpServer())
      .post('/tracking/validar-kit')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: 'TEST-KIT-A' })
      .expect(200);
    expect(res.body.id).toBe(KIT_ID);
    expect(res.body.yaRecibido).toBe(false);
  });

  it('6. confirma recepción del kit', async () => {
    const res = await request(app.getHttpServer())
      .post('/tracking/recepcion-kit')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({
        kitId: KIT_ID,
        fotoMilitarUrl: (global as any).__fotoUrl,
        militarId: null,
        ...RECINTO,
      })
      .expect(201);
    expect(res.body.kitId).toBe(KIT_ID);
  });

  it('7. registra llegada al recinto', async () => {
    const res = await request(app.getHttpServer())
      .post('/tracking/llegada-recinto')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ ...RECINTO, ocurridoEn: iso() })
      .expect(201);
    expect(res.body.id).toBeDefined();
  });

  it('8. registra salida del recinto', async () => {
    const res = await request(app.getHttpServer())
      .post('/tracking/salida-recinto')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ ...RECINTO, ocurridoEn: iso() })
      .expect(201);
    expect(res.body.id).toBeDefined();
  });

  it('9. ingesta posiciones GPS del retorno', async () => {
    const res = await request(app.getHttpServer())
      .post('/tracking/posiciones')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({
        posiciones: [
          { latitud: 0.3138782, longitud: -78.218656, capturadoEn: iso(60_000) },
          { ...ULTIMA_POSICION, capturadoEn: iso(120_000) },
        ],
      })
      .expect(200);
    expect(res.body.recibidas).toBe(2);
  });

  it('10. registra llegada al DPI', async () => {
    const res = await request(app.getHttpServer())
      .post('/tracking/llegada-dpi')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ ...DPI, ocurridoEn: iso(180_000) })
      .expect(201);
    expect(res.body.id).toBeDefined();
  });

  it('11. estado-cdas refleja RETORNADO', async () => {
    // Se llama al servicio directo (en vez de vía HTTP con un admin logueado)
    // porque la contraseña del admin sembrado puede haber sido cambiada en
    // sesiones previas; con rol ADMINISTRADOR el viewerId no filtra resultados.
    const tracking = app.get(TrackingService);
    const estados = await tracking.estadoCdas(OPERADOR_ID, ['ADMINISTRADOR']);

    const cda = estados.find((c) => c.recintoId === RECINTO_ID);
    expect(cda).toBeDefined();
    expect(cda?.estado).toBe('RETORNADO');
    expect(cda?.ubicacion?.latitud).toBeCloseTo(ULTIMA_POSICION.latitud, 4);
    expect(cda?.ubicacion?.longitud).toBeCloseTo(ULTIMA_POSICION.longitud, 4);
  });
});
