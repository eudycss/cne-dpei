/**
 * Pruebas de humo contra producción, después de cada deploy.
 *
 * Solo LEEN: ninguna crea, cambia ni borra datos (tampoco intenta un login, que
 * dejaría filas en la bitácora). Cada prueba es "crítica" (si falla, la API se
 * revierte al deploy anterior) o "aviso" (solo se avisa por Telegram).
 *
 * Uso: node infra/deploy/smoke.mjs <url-api> <url-web>   → sale con 1 si falla una crítica.
 */

const TOKEN_FALSO = 'x'.repeat(43);

/** @typedef {{ nombre: string, critica: boolean, correr: (ctx: Ctx) => Promise<void> }} Prueba */
/** @typedef {{ api: string, web: string, fetch: typeof fetch }} Ctx */

function falla(mensaje) {
  throw new Error(mensaje);
}

async function esperarEstado(respuesta, esperado) {
  if (respuesta.status !== esperado) {
    const cuerpo = (await respuesta.text().catch(() => '')).slice(0, 200);
    falla(`respondió ${respuesta.status} (se esperaba ${esperado}): ${cuerpo}`);
  }
}

/** @type {Prueba[]} */
export const PRUEBAS = [
  {
    nombre: 'API viva (/health)',
    critica: true,
    async correr({ api, fetch }) {
      const r = await fetch(`${api}/health`);
      await esperarEstado(r, 200);
      const cuerpo = await r.json();
      if (cuerpo?.status !== 'ok') falla(`cuerpo inesperado: ${JSON.stringify(cuerpo)}`);
    },
  },
  {
    nombre: 'Rutas protegidas piden sesión (401)',
    critica: true,
    async correr({ api, fetch }) {
      await esperarEstado(await fetch(`${api}/custodia/informe`), 401);
    },
  },
  {
    nombre: 'Validación de formularios (400)',
    critica: true,
    async correr({ api, fetch }) {
      const r = await fetch(`${api}/publico/foto-cda/cedula/consultar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cedula: '123' }),
      });
      await esperarEstado(r, 400);
    },
  },
  {
    // Recorre multer + Zod + base de datos (busca la visita) sin guardar nada.
    // Es la prueba que habría detectado el "Too many parts" del 26-nov.
    nombre: 'Subida de fotos del informe (multipart → 410 visita vencida)',
    critica: true,
    async correr({ api, fetch }) {
      const fd = new FormData();
      fd.append('token', TOKEN_FALSO);
      fd.append('posicion', '1');
      fd.append('consentimiento', 'true');
      fd.append('version', 'LOPDP-2026-11-INFORME');
      fd.append('foto', new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), 'humo.jpg');
      await esperarEstado(await fetch(`${api}/publico/informe-cda/foto`, { method: 'POST', body: fd }), 410);
    },
  },
  {
    nombre: 'Web carga (index + script principal)',
    critica: false,
    async correr({ web, fetch }) {
      const r = await fetch(`${web}/`);
      await esperarEstado(r, 200);
      const html = await r.text();
      if (!html.includes('id="root"')) falla('el HTML no tiene <div id="root">');
      const script = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
      if (!script) falla('el HTML no enlaza el script principal');
      await esperarEstado(await fetch(new URL(script, `${web}/`)), 200);
    },
  },
  {
    nombre: 'Página pública /informe-cda responde',
    critica: false,
    async correr({ web, fetch }) {
      await esperarEstado(await fetch(`${web}/informe-cda`), 200);
    },
  },
];

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Corre todas las pruebas. Cada una se reintenta (la API de Render puede estar
 * arrancando) antes de darla por fallida.
 */
export async function correrPruebas({ api, web, fetch: f = fetch, intentos = 3, esperaMs = 10_000, pruebas = PRUEBAS }) {
  const ctx = { api: api.replace(/\/$/, ''), web: web.replace(/\/$/, ''), fetch: f };
  const resultados = [];
  for (const p of pruebas) {
    let error = null;
    for (let i = 1; i <= intentos; i++) {
      try {
        await p.correr(ctx);
        error = null;
        break;
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
        if (i < intentos) await dormir(esperaMs);
      }
    }
    resultados.push({ nombre: p.nombre, critica: p.critica, ok: error === null, error });
  }
  return {
    resultados,
    fallaCritica: resultados.some((r) => r.critica && !r.ok),
    fallaAviso: resultados.some((r) => !r.critica && !r.ok),
  };
}

/** Resumen legible (para el log y para Telegram). */
export function resumen(resultados) {
  return resultados
    .map((r) => `${r.ok ? '✅' : r.critica ? '❌' : '⚠️'} ${r.nombre}${r.ok ? '' : ` — ${r.error}`}`)
    .join('\n');
}

const esCli = import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('smoke.mjs');
if (esCli) {
  const [api, web] = process.argv.slice(2);
  if (!api || !web) {
    console.error('Uso: node infra/deploy/smoke.mjs <url-api> <url-web>');
    process.exit(2);
  }
  const r = await correrPruebas({ api, web });
  console.log(resumen(r.resultados));
  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_OUTPUT, `falla_critica=${r.fallaCritica}\nfalla_aviso=${r.fallaAviso}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `resumen<<FIN\n${resumen(r.resultados)}\nFIN\n`);
  }
  process.exit(r.fallaCritica ? 1 : 0);
}
