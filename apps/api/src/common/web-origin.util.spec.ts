import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { parseOriginPatterns, parseWebOrigins } from './web-origin.util';

@Controller()
class PingController {
  @Get('ping')
  ping() {
    return { ok: true };
  }
}

describe('CORS con WEB_ORIGIN + WEB_ORIGIN_PATTERNS (como en main.ts)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [PingController] }).compile();
    app = moduleRef.createNestApplication();
    app.enableCors({
      origin: [
        ...parseWebOrigins('https://cne-dpei-web.vercel.app,http://localhost:5173'),
        ...parseOriginPatterns('https://cne-dpei-web-*-cne2027.vercel.app'),
      ],
      credentials: true,
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const preflight = (origen: string) =>
    request(app.getHttpServer())
      .options('/ping')
      .set('Origin', origen)
      .set('Access-Control-Request-Method', 'POST');

  it('autoriza la web de producción y los previews del proyecto', async () => {
    for (const origen of [
      'https://cne-dpei-web.vercel.app',
      'https://cne-dpei-web-git-fix-web-vulnerabilidades-cne2027.vercel.app',
    ]) {
      const res = await preflight(origen);
      expect(res.headers['access-control-allow-origin']).toBe(origen);
    }
  });

  it('no autoriza dominios parecidos', async () => {
    for (const origen of [
      'https://cne-dpei-web-x-cne2027.vercel.app.evil.com',
      'http://cne-dpei-web-x-cne2027.vercel.app',
      'https://otro-x-cne2027.vercel.app',
    ]) {
      const res = await preflight(origen);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });
});

describe('parseWebOrigins', () => {
  it('separa por comas y descarta vacíos', () => {
    expect(parseWebOrigins(' https://a.app , ,https://b.app')).toEqual(['https://a.app', 'https://b.app']);
  });
});

describe('parseOriginPatterns', () => {
  const PATRON = 'https://cne-dpei-web-*-cne2027.vercel.app';
  const coincide = (origen: string, raw = PATRON) => parseOriginPatterns(raw).some((r) => r.test(origen));

  it('sin variable no agrega nada', () => {
    expect(parseOriginPatterns(undefined)).toEqual([]);
    expect(parseOriginPatterns('')).toEqual([]);
  });

  it('acepta los previews de Vercel del proyecto (por rama y por despliegue)', () => {
    expect(coincide('https://cne-dpei-web-git-fix-web-vulnerabilidades-cne2027.vercel.app')).toBe(true);
    expect(coincide('https://cne-dpei-web-6xk1ryfym-cne2027.vercel.app')).toBe(true);
  });

  it('rechaza otros dominios, http, rutas y subdominios encadenados', () => {
    expect(coincide('https://cne-dpei-web-x-cne2027.vercel.app.evil.com')).toBe(false);
    expect(coincide('https://evil.com/cne-dpei-web-x-cne2027.vercel.app')).toBe(false);
    expect(coincide('https://cne-dpei-web-a.b-cne2027.vercel.app')).toBe(false); // el * no cruza "."
    expect(coincide('http://cne-dpei-web-x-cne2027.vercel.app')).toBe(false);
    expect(coincide('https://otro-proyecto-x-cne2027.vercel.app')).toBe(false);
    expect(coincide('https://cne-dpei-web-cne2027.vercel.app')).toBe(false); // el * no puede ir vacío
  });

  it('trata el resto del patrón como texto literal (el "." no es comodín)', () => {
    expect(coincide('https://cne-dpei-web-x-cne2027Xvercel.app')).toBe(false);
  });

  it('ignora patrones inseguros o sin comodín', () => {
    expect(parseOriginPatterns('http://*.vercel.app')).toEqual([]); // no https
    expect(parseOriginPatterns('https://*.vercel.app/ruta')).toEqual([]); // con ruta
    expect(parseOriginPatterns('https://exacto.vercel.app')).toEqual([]); // sin * (va en WEB_ORIGIN)
  });

  it('admite varios patrones separados por coma', () => {
    const raw = `${PATRON}, https://cne-dpei-admin-*-cne2027.vercel.app`;
    expect(coincide('https://cne-dpei-admin-abc-cne2027.vercel.app', raw)).toBe(true);
    expect(coincide('https://cne-dpei-web-abc-cne2027.vercel.app', raw)).toBe(true);
  });
});
