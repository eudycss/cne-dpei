import express from 'express';
import multer from 'multer';
import request from 'supertest';

import { LIMITES_FOTO_INFORME } from './informe-productos.controller';

/**
 * Regresión: con `parts: 5` busboy rechazaba el formulario válido de la página
 * (4 campos + la foto) con "Too many parts". Se prueba con multer real.
 */
function app() {
  const a = express();
  a.post('/foto', multer({ limits: LIMITES_FOTO_INFORME }).single('foto'), (req, res) => {
    res.json({ campos: Object.keys(req.body).sort(), bytes: req.file?.size ?? 0 });
  });
  a.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: err.message });
  });
  return a;
}

const formulario = (r: request.Test) =>
  r
    .field('token', 't'.repeat(43))
    .field('posicion', '1')
    .field('consentimiento', 'true')
    .field('version', 'LOPDP-2026-11-INFORME');

describe('límites del formulario de foto del informe', () => {
  it('acepta el formulario de la página: 4 campos + 1 foto', async () => {
    const r = await formulario(request(app()).post('/foto')).attach('foto', Buffer.alloc(2048), 'foto1.jpg');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ campos: ['consentimiento', 'posicion', 'token', 'version'], bytes: 2048 });
  });

  it('rechaza un campo de más, un segundo archivo o un campo enorme', async () => {
    const extra = await formulario(request(app()).post('/foto')).field('otro', 'x').attach('foto', Buffer.alloc(10), 'a.jpg');
    expect(extra.status).toBe(400);

    const dos = await formulario(request(app()).post('/foto'))
      .attach('foto', Buffer.alloc(10), 'a.jpg')
      .attach('foto', Buffer.alloc(10), 'b.jpg');
    expect(dos.status).toBe(400);

    const enorme = await request(app()).post('/foto').field('token', 'x'.repeat(4096)).attach('foto', Buffer.alloc(10), 'a.jpg');
    expect(enorme.status).toBe(400);
  });
});
