import { Body, Controller, HttpCode, Patch, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { configurarBodyParsers } from './body-parsers';

@Controller()
class EcoController {
  @Post('incidencias')
  @HttpCode(200)
  incidencia(@Body() body: { fotoBase64?: string }) {
    return { largo: body.fotoBase64?.length ?? 0 };
  }

  @Patch('incidencias/:id/estado')
  @HttpCode(200)
  estado(@Body() body: { comentario?: string }) {
    return { largo: body.comentario?.length ?? 0 };
  }

  @Post('otro')
  @HttpCode(200)
  otro(@Body() body: { dato?: string }) {
    return { largo: body.dato?.length ?? 0 };
  }
}

const TOKEN = 'Bearer abc.def.ghi';

/** Cadena de `bytes` caracteres, del tamaño de una foto en base64. */
function relleno(bytes: number): string {
  return 'A'.repeat(bytes);
}

describe('configurarBodyParsers', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [EcoController] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configurarBodyParsers(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('acepta en /incidencias una foto base64 de ~4 MB (antes daba 413)', async () => {
    const foto = relleno(4 * 1024 * 1024);
    const res = await request(app.getHttpServer())
      .post('/incidencias')
      .set('Authorization', TOKEN)
      .send({ fotoBase64: foto });
    expect(res.status).toBe(200);
    expect(res.body.largo).toBe(foto.length);
  });

  it('rechaza en /incidencias un cuerpo mayor a 12 MB', async () => {
    const res = await request(app.getHttpServer())
      .post('/incidencias')
      .set('Authorization', TOKEN)
      .send({ fotoBase64: relleno(13 * 1024 * 1024) });
    expect(res.status).toBe(413);
  });

  it('sin token, POST /incidencias se queda en 100 KB (no parsea 12 MB antes del guard)', async () => {
    const res = await request(app.getHttpServer())
      .post('/incidencias')
      .send({ fotoBase64: relleno(200 * 1024) });
    expect(res.status).toBe(413);
  });

  it('PATCH /incidencias/:id/estado se queda en 100 KB aunque traiga token', async () => {
    const res = await request(app.getHttpServer())
      .patch('/incidencias/123/estado')
      .set('Authorization', TOKEN)
      .send({ comentario: relleno(200 * 1024) });
    expect(res.status).toBe(413);
  });

  it('urlencoded grande en /incidencias se rechaza con 413', async () => {
    const res = await request(app.getHttpServer())
      .post('/incidencias')
      .set('Authorization', TOKEN)
      .type('form')
      .send('fotoBase64=' + relleno(200 * 1024));
    expect(res.status).toBe(413);
  });

  it('mantiene el límite de 100 KB en el resto de rutas', async () => {
    const res = await request(app.getHttpServer())
      .post('/otro')
      .send({ dato: relleno(200 * 1024) });
    expect(res.status).toBe(413);
  });

  it('el resto de rutas sigue leyendo cuerpos JSON pequeños', async () => {
    const res = await request(app.getHttpServer()).post('/otro').send({ dato: 'hola' });
    expect(res.status).toBe(200);
    expect(res.body.largo).toBe(4);
  });

  it('el resto de rutas sigue leyendo formularios urlencoded', async () => {
    const res = await request(app.getHttpServer())
      .post('/otro')
      .type('form')
      .send('dato=hola');
    expect(res.status).toBe(200);
    expect(res.body.largo).toBe(4);
  });
});
