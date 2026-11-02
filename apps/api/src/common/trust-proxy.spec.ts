import express from 'express';
import request from 'supertest';
import { TRUST_PROXY } from './trust-proxy';

// supertest conecta por 127.0.0.1 (loopback), igual que el proxy local de Render.
function appQueDevuelveIp() {
  const app = express();
  app.set('trust proxy', TRUST_PROXY);
  app.get('/ip', (req, res) => {
    res.json({ ip: req.ip });
  });
  return app;
}

describe('trust proxy (Render detrás de Cloudflare)', () => {
  it('req.ip es la IP del cliente, no la del borde de Cloudflare (cadena real de Render)', async () => {
    const res = await request(appQueDevuelveIp())
      .get('/ip')
      .set('X-Forwarded-For', '190.63.117.237, 162.158.41.32, 10.27.25.14');

    expect(res.body.ip).toBe('190.63.117.237');
  });

  it('reconoce otros rangos de Cloudflare vistos en la bitácora (172.71.x, 104.23.x)', async () => {
    const app = appQueDevuelveIp();

    const a = await request(app).get('/ip').set('X-Forwarded-For', '186.46.74.171, 172.71.151.85, 10.27.25.14');
    const b = await request(app).get('/ip').set('X-Forwarded-For', '186.46.74.171, 104.23.160.103, 10.27.25.14');

    expect(a.body.ip).toBe('186.46.74.171');
    expect(b.body.ip).toBe('186.46.74.171');
  });

  it('un cliente no puede suplantar otra IP agregando su propio X-Forwarded-For', async () => {
    const res = await request(appQueDevuelveIp())
      .get('/ip')
      .set('X-Forwarded-For', '1.2.3.4, 190.63.117.237, 162.158.41.32, 10.27.25.14');

    expect(res.body.ip).toBe('190.63.117.237');
  });

  it('una IP pública que no es de Cloudflare no se trata como proxy', async () => {
    const res = await request(appQueDevuelveIp())
      .get('/ip')
      .set('X-Forwarded-For', '1.2.3.4, 8.8.8.8, 10.0.0.1');

    expect(res.body.ip).toBe('8.8.8.8');
  });

  it('sin proxies (desarrollo local) usa la dirección de la conexión', async () => {
    const res = await request(appQueDevuelveIp()).get('/ip');

    expect(res.body.ip).toMatch(/127\.0\.0\.1|::1/);
  });
});
