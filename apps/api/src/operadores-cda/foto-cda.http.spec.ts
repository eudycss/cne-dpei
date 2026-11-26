import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { VERSION_AVISO_FOTO_CDA } from '@cne/shared-validation';

import { crearAppHttp } from '../common/testing/app-http';
import { FotoCdaPublicoController } from './foto-cda.controller';
import { FotoCdaService } from './foto-cda.service';

/** Enlace público de foto CDA (/foto-cda) por HTTP real, servicio simulado. */
describe('HTTP /publico/foto-cda', () => {
  let app: NestExpressApplication;
  const servicio = {
    consultar: jest.fn(),
    subir: jest.fn(),
    consultarPorCedula: jest.fn(),
    subirPorCedula: jest.fn(),
  };

  beforeAll(async () => {
    app = await crearAppHttp([FotoCdaPublicoController], [{ provide: FotoCdaService, useValue: servicio }]);
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('por cédula: el formulario de la página (3 campos + foto) llega al servicio', async () => {
    servicio.subirPorCedula.mockResolvedValue({ operadorId: 'op1', cambio: null, pendiente: false });
    const r = await request(app.getHttpServer())
      .post('/publico/foto-cda/cedula/subir')
      .field('cedula', '1003199443')
      .field('consentimiento', 'true')
      .field('version', VERSION_AVISO_FOTO_CDA)
      .attach('foto', Buffer.from([0xff, 0xd8, 0xff, 0xd9]), { filename: 'foto.jpg', contentType: 'image/jpeg' });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ ok: true, cambio: null, pendiente: false });
    expect(r.headers['cache-control']).toBe('no-store');
    expect(servicio.subirPorCedula.mock.calls[0][0]).toBe('1003199443');
  });

  it('por cédula: aviso LOPDP desactualizado o cédula inválida → 400', async () => {
    const viejo = await request(app.getHttpServer())
      .post('/publico/foto-cda/cedula/subir')
      .field('cedula', '1003199443')
      .field('consentimiento', 'true')
      .field('version', 'LOPDP-viejo')
      .attach('foto', Buffer.from([1]), 'f.jpg');
    expect(viejo.status).toBe(400);

    const cedula = await request(app.getHttpServer()).post('/publico/foto-cda/cedula/consultar').send({ cedula: '123' });
    expect(cedula.status).toBe(400);
    expect(servicio.subirPorCedula).not.toHaveBeenCalled();
    expect(servicio.consultarPorCedula).not.toHaveBeenCalled();
  });

  it('por enlace: un token mal formado → 400 sin llegar al servicio', async () => {
    const r = await request(app.getHttpServer()).post('/publico/foto-cda/consultar').send({ token: 'corto' });
    expect(r.status).toBe(400);
    expect(servicio.consultar).not.toHaveBeenCalled();
  });
});
