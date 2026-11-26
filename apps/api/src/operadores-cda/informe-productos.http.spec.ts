import { GoneException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { VERSION_AVISO_INFORME_CDA } from '@cne/shared-validation';

import { crearAppHttp } from '../common/testing/app-http';
import { InformeProductosPublicoController } from './informe-productos.controller';
import { InformeProductosService } from './informe-productos.service';

/** Página pública /informe-cda por HTTP real (multer + Zod + filtros), servicio simulado. */
describe('HTTP /publico/informe-cda', () => {
  let app: NestExpressApplication;
  const servicio = {
    consultar: jest.fn(),
    subirFoto: jest.fn(),
    verFoto: jest.fn(),
    generarPublico: jest.fn(),
  };
  const TOKEN = 'a'.repeat(43);

  beforeAll(async () => {
    app = await crearAppHttp([InformeProductosPublicoController], [{ provide: InformeProductosService, useValue: servicio }]);
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  const formulario = (r: request.Test) =>
    r.field('token', TOKEN).field('posicion', '3').field('consentimiento', 'true').field('version', VERSION_AVISO_INFORME_CDA);

  it('consultar: cédula válida → 200 y sin caché; inválida → 400 sin llegar al servicio', async () => {
    servicio.consultar.mockResolvedValue({ token: TOKEN, fotos: [] });
    const ok = await request(app.getHttpServer()).post('/publico/informe-cda/consultar').send({ cedula: '1003199443' });
    expect(ok.status).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(servicio.consultar).toHaveBeenCalledWith('1003199443');

    const mal = await request(app.getHttpServer()).post('/publico/informe-cda/consultar').send({ cedula: '123' });
    expect(mal.status).toBe(400);
    const extra = await request(app.getHttpServer()).post('/publico/informe-cda/consultar').send({ cedula: '1003199443', x: 1 });
    expect(extra.status).toBe(400);
    expect(servicio.consultar).toHaveBeenCalledTimes(1);
  });

  it('foto: el formulario de la página (4 campos + foto) llega al servicio con la posición como número', async () => {
    servicio.subirFoto.mockResolvedValue({ operadorId: 'op1', fotos: [{ posicion: 3, cargada: true, deEstaVisita: true }] });
    const r = await formulario(request(app.getHttpServer()).post('/publico/informe-cda/foto')).attach(
      'foto',
      Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
      { filename: 'foto3.jpg', contentType: 'image/jpeg' },
    );
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ fotos: [{ posicion: 3, cargada: true, deEstaVisita: true }] });
    const [token, posicion, file, version] = servicio.subirFoto.mock.calls[0];
    expect([token, posicion, version]).toEqual([TOKEN, 3, VERSION_AVISO_INFORME_CDA]);
    expect(file.buffer).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  });

  it('foto: sin consentimiento, posición fuera de 1-6 o campos de más → 400', async () => {
    const sinConsentimiento = await request(app.getHttpServer())
      .post('/publico/informe-cda/foto')
      .field('token', TOKEN)
      .field('posicion', '1')
      .field('version', VERSION_AVISO_INFORME_CDA)
      .attach('foto', Buffer.from([1]), 'f.jpg');
    expect(sinConsentimiento.status).toBe(400);

    const posicion = await request(app.getHttpServer())
      .post('/publico/informe-cda/foto')
      .field('token', TOKEN)
      .field('posicion', '7')
      .field('consentimiento', 'true')
      .field('version', VERSION_AVISO_INFORME_CDA)
      .attach('foto', Buffer.from([1]), 'f.jpg');
    expect(posicion.status).toBe(400);

    const deMas = await formulario(request(app.getHttpServer()).post('/publico/informe-cda/foto'))
      .field('otro', 'x')
      .attach('foto', Buffer.from([1]), 'f.jpg');
    expect(deMas.status).toBe(400);
    expect(servicio.subirFoto).not.toHaveBeenCalled();
  });

  it('foto: una visita vencida responde 410 con el mensaje en español', async () => {
    servicio.subirFoto.mockRejectedValue(new GoneException('La visita venció: escriba su cédula de nuevo.'));
    const r = await formulario(request(app.getHttpServer()).post('/publico/informe-cda/foto')).attach('foto', Buffer.from([1]), 'f.jpg');
    expect(r.status).toBe(410);
    expect(r.body.message).toMatch(/visita venció/);
  });

  it('foto: un archivo de más de 1 MB se corta en multer (413) sin llegar al servicio', async () => {
    const r = await formulario(request(app.getHttpServer()).post('/publico/informe-cda/foto')).attach(
      'foto',
      Buffer.alloc(1024 * 1024 + 1),
      'grande.jpg',
    );
    expect(r.status).toBe(413);
    expect(servicio.subirFoto).not.toHaveBeenCalled();
  });

  it('ver foto y generar: JPEG / Word con no-store y nombre de archivo', async () => {
    servicio.verFoto.mockResolvedValue(Buffer.from([0xff, 0xd8]));
    const foto = await request(app.getHttpServer()).post('/publico/informe-cda/foto/ver').send({ token: TOKEN, posicion: 2 });
    expect(foto.status).toBe(200);
    expect(foto.headers['content-type']).toBe('image/jpeg');
    expect(foto.headers['cache-control']).toBe('private, no-store');
    expect(servicio.verFoto).toHaveBeenCalledWith(TOKEN, 2);

    servicio.generarPublico.mockResolvedValue({ operadorId: 'op1', nombre: 'informe_productos_1003199443.docx', contenido: Buffer.from('PK') });
    const word = await request(app.getHttpServer()).post('/publico/informe-cda/generar').send({ token: TOKEN });
    expect(word.status).toBe(200);
    expect(word.headers['content-disposition']).toBe('attachment; filename="informe_productos_1003199443.docx"');
    expect(word.headers['cache-control']).toBe('no-store');
  });
});
