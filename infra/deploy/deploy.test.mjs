// Pruebas de los scripts de post-deploy: node --test infra/deploy
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { correrPruebas, PRUEBAS, resumen } from './smoke.mjs';
import { cliente, esperar, revertir, ubicar } from './render.mjs';
import { avisar } from './telegram.mjs';

const API = 'https://api.test';
const WEB = 'https://web.test';

/** fetch falso: responde según el método y la URL. */
function fetchFalso(rutas) {
  const llamadas = [];
  const f = async (url, init = {}) => {
    const clave = `${init.method ?? 'GET'} ${url}`;
    llamadas.push({ clave, init });
    const r = rutas[clave] ?? rutas[String(url)];
    if (!r) return new Response('no encontrado', { status: 404 });
    return typeof r === 'function' ? r(init) : r();
  };
  f.llamadas = llamadas;
  return f;
}

const json = (cuerpo, status = 200) => () => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
const texto = (cuerpo, status = 200) => () => new Response(cuerpo, { status });

function produccionSana(extra = {}) {
  return {
    [`GET ${API}/health`]: json({ status: 'ok' }),
    [`GET ${API}/custodia/informe`]: json({ message: 'Unauthorized' }, 401),
    [`POST ${API}/publico/foto-cda/cedula/consultar`]: json({ message: 'Cédula inválida' }, 400),
    [`POST ${API}/publico/informe-cda/foto`]: json({ message: 'La visita venció' }, 410),
    [`GET ${WEB}/`]: texto('<html><div id="root"></div><script type="module" src="/assets/index-abc.js"></script></html>'),
    [`GET ${WEB}/assets/index-abc.js`]: texto('console.log(1)'),
    [`GET ${WEB}/informe-cda`]: texto('<div id="root"></div>'),
    ...extra,
  };
}

test('producción sana: todas las pruebas pasan', async () => {
  const r = await correrPruebas({ api: API, web: WEB, fetch: fetchFalso(produccionSana()), intentos: 1, esperaMs: 0 });
  assert.equal(r.fallaCritica, false);
  assert.equal(r.fallaAviso, false);
  assert.equal(r.resultados.length, PRUEBAS.length);
});

test('el "Too many parts" del 26-nov es una falla crítica', async () => {
  const f = fetchFalso(produccionSana({ [`POST ${API}/publico/informe-cda/foto`]: json({ message: 'Too many parts' }, 400) }));
  const r = await correrPruebas({ api: API, web: WEB, fetch: f, intentos: 1, esperaMs: 0 });
  assert.equal(r.fallaCritica, true);
  assert.match(resumen(r.resultados), /❌ Subida de fotos del informe.*respondió 400.*Too many parts/);
  // El pedido es multipart con los 4 campos y la foto.
  const fd = f.llamadas.find((l) => l.clave.endsWith('/publico/informe-cda/foto')).init.body;
  assert.deepEqual([...fd.keys()], ['token', 'posicion', 'consentimiento', 'version', 'foto']);
});

test('si solo falla la web es un aviso, no rollback de la API', async () => {
  const r = await correrPruebas({
    api: API, web: WEB, intentos: 1, esperaMs: 0,
    fetch: fetchFalso(produccionSana({ [`GET ${WEB}/informe-cda`]: texto('error', 500) })),
  });
  assert.equal(r.fallaCritica, false);
  assert.equal(r.fallaAviso, true);
  assert.match(resumen(r.resultados), /⚠️ Página pública \/informe-cda responde — respondió 500/);
});

test('reintenta antes de dar por caída (API arrancando)', async () => {
  let n = 0;
  const f = fetchFalso(produccionSana({ [`GET ${API}/health`]: () => (++n < 3 ? new Response('', { status: 502 }) : new Response('{"status":"ok"}')) }));
  const r = await correrPruebas({ api: API, web: WEB, fetch: f, intentos: 3, esperaMs: 0 });
  assert.equal(r.resultados[0].ok, true);
  assert.equal(n, 3);
});

test('las pruebas no escriben: solo GET o POST que el servidor rechaza', () => {
  for (const p of PRUEBAS) assert.ok(!/login|crear|borrar/i.test(p.nombre), p.nombre);
});

// ─── Render ──────────────────────────────────────────────────────────────

const d = (id, sha, status) => ({ id, status, commit: { id: sha } });

test('ubicar: deploy del commit y el que estaba en vivo antes', () => {
  const lista = [d('dep3', 'c3', 'build_in_progress'), d('dep2', 'c2', 'live'), d('dep1', 'c1', 'deactivated')];
  assert.deepEqual(ubicar(lista, 'c3'), { actual: lista[0], anterior: lista[1] });
  assert.deepEqual(ubicar(lista, 'zz'), { actual: null, anterior: null });
});

function renderFalso(secuencia) {
  let i = 0;
  return {
    async deploys() {
      return secuencia[Math.min(i++, secuencia.length - 1)];
    },
    rollbacks: [],
    async rollback(id) {
      this.rollbacks.push(id);
      return { id: 'depR' };
    },
  };
}

test('esperar: termina en live o en falla de build', async () => {
  const ok = renderFalso([[d('dep3', 'c3', 'build_in_progress'), d('dep2', 'c2', 'live')], [d('dep3', 'c3', 'live'), d('dep2', 'c2', 'deactivated')]]);
  const r = await esperar(ok, 'c3', { cadaMs: 0 });
  assert.equal(r.estado, 'live');
  assert.equal(r.anterior.id, 'dep2');

  const mal = renderFalso([[d('dep3', 'c3', 'build_failed'), d('dep2', 'c2', 'live')]]);
  assert.equal((await esperar(mal, 'c3', { cadaMs: 0 })).estado, 'build_failed');
});

test('esperar: si otro commit lo reemplazó no se revisa este', async () => {
  const r = renderFalso([[d('dep4', 'c4', 'live'), d('dep3', 'c3', 'deactivated'), d('dep2', 'c2', 'deactivated')]]);
  assert.equal((await esperar(r, 'c3', { cadaMs: 0 })).estado, 'reemplazado');
});

test('revertir: pide el rollback al deploy anterior y espera a que quede en vivo', async () => {
  const r = renderFalso([[d('depR', 'c2', 'update_in_progress')], [d('depR', 'c2', 'live')]]);
  const res = await revertir(r, 'dep2', { cadaMs: 0 });
  assert.deepEqual(r.rollbacks, ['dep2']);
  assert.deepEqual(res, { ok: true, id: 'depR' });
});

test('cliente de Render: usa la API v1 con la clave y no la imprime en errores', async () => {
  const f = fetchFalso({
    [`GET https://api.render.com/v1/services/srv1/deploys?limit=20`]: json([{ deploy: d('dep1', 'c1', 'live'), cursor: 'x' }]),
    [`POST https://api.render.com/v1/services/srv1/rollback`]: texto('prohibido', 403),
  });
  const c = cliente({ apiKey: 'rnd_secreta', serviceId: 'srv1', fetch: f });
  assert.equal((await c.deploys())[0].id, 'dep1');
  assert.equal(f.llamadas[0].init.headers.Authorization, 'Bearer rnd_secreta');
  await assert.rejects(c.rollback('dep0'), (e) => !e.message.includes('rnd_secreta') && /403/.test(e.message));
  assert.equal(JSON.parse(f.llamadas[1].init.body).deployId, 'dep0');
  assert.throws(() => cliente({ serviceId: 'srv1' }), /RENDER_API_KEY/);
});

// ─── Telegram ────────────────────────────────────────────────────────────

test('telegram: sin secretos no falla; con secretos envía al chat privado', async () => {
  assert.equal(await avisar('hola', {}), false);
  const f = fetchFalso({ 'POST https://api.telegram.org/botTOK/sendMessage': json({ ok: true }) });
  assert.equal(await avisar('x'.repeat(5000), { token: 'TOK', chatId: '123', fetch: f }), true);
  const cuerpo = JSON.parse(f.llamadas[0].init.body);
  assert.equal(cuerpo.chat_id, '123');
  assert.ok(cuerpo.text.length <= 3901);
});
