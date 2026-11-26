/**
 * Deploys de la API en Render (API pública v1): esperar el deploy de un commit
 * y volver al deploy anterior (rollback). La clave va en RENDER_API_KEY (secreto
 * de GitHub); nunca se imprime.
 *
 * Uso:
 *   node infra/deploy/render.mjs esperar <sha>       → espera a que el deploy del commit termine
 *   node infra/deploy/render.mjs ultimo <sha>        → ¿sigue siendo el deploy más reciente?
 *   node infra/deploy/render.mjs rollback <deployId> → vuelve a ese deploy y espera a que quede en vivo
 *
 * Según la documentación de Render, el rollback por API NO apaga el autodeploy
 * (el del dashboard sí); igual se verifica después y se avisa si quedó apagado.
 */

const BASE = 'https://api.render.com/v1';
export const TERMINADOS_OK = new Set(['live']);
export const TERMINADOS_MAL = new Set(['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled', 'deactivated']);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export function cliente({ apiKey, serviceId, fetch: f = fetch, intentos = 3, esperaMs = 5_000 }) {
  if (!apiKey) throw new Error('Falta RENDER_API_KEY (secreto de GitHub)');
  if (!serviceId) throw new Error('Falta RENDER_SERVICE_ID');
  const pedir = async (ruta, init = {}) => {
    let ultimo;
    for (let i = 1; i <= intentos; i++) {
      try {
        const r = await f(`${BASE}${ruta}`, {
          ...init,
          headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...init.headers },
        });
        if (r.ok) return r.json();
        ultimo = new Error(`Render ${init.method ?? 'GET'} ${ruta} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
        // 4xx (salvo 429) no se arregla reintentando: clave inválida, sin permiso, etc.
        if (r.status < 500 && r.status !== 429) throw ultimo;
      } catch (e) {
        ultimo = e;
        if (/→ 4\d\d/.test(e.message) && !/→ 429/.test(e.message)) throw e;
      }
      if (i < intentos) await dormir(esperaMs);
    }
    throw ultimo;
  };
  return {
    /** Últimos deploys, del más nuevo al más viejo. */
    async deploys(limite = 20) {
      const filas = await pedir(`/services/${serviceId}/deploys?limit=${limite}`);
      return filas.map((f) => f.deploy ?? f);
    },
    async rollback(deployId) {
      return pedir(`/services/${serviceId}/rollback`, { method: 'POST', body: JSON.stringify({ deployId }) });
    },
    async servicio() {
      return pedir(`/services/${serviceId}`);
    },
  };
}

/** El deploy de `sha` y el que estaba en vivo antes (al que se vuelve si falla). */
export function ubicar(deploys, sha) {
  const i = deploys.findIndex((d) => d.commit?.id === sha);
  if (i === -1) return { actual: null, anterior: null };
  const anterior = deploys.slice(i + 1).find((d) => d.status === 'live' || d.status === 'deactivated') ?? null;
  return { actual: deploys[i], anterior };
}

/** Espera a que el deploy de `sha` termine; devuelve el estado final. */
export async function esperar(render, sha, { cadaMs = 20_000, maxMs = 25 * 60_000, sinDeployMs = 6 * 60_000 } = {}) {
  const inicio = Date.now();
  const fin = inicio + maxMs;
  while (Date.now() < fin) {
    const lista = await render.deploys();
    const { actual, anterior } = ubicar(lista, sha);
    // Render no creó deploy para este commit (p. ej. lo agrupó con otro push).
    if (!actual && Date.now() - inicio > sinDeployMs) return { estado: 'sin_deploy', actual: null, anterior: null };
    // Un commit más nuevo lo reemplazó (desactivado o cancelado): su workflow lo revisa.
    const masNuevo = lista[0]?.commit?.id && lista[0].commit.id !== sha;
    if (actual && masNuevo && (actual.status === 'deactivated' || actual.status === 'canceled')) {
      return { estado: 'reemplazado', actual, anterior };
    }
    if (actual && (TERMINADOS_OK.has(actual.status) || TERMINADOS_MAL.has(actual.status))) {
      return { estado: actual.status, actual, anterior };
    }
    await dormir(cadaMs);
  }
  return { estado: 'tiempo_agotado', actual: null, anterior: null };
}

/** ¿El deploy más reciente sigue siendo el de `sha`? (si entró otro, no se revierte). */
export async function esUltimo(render, sha) {
  const lista = await render.deploys(5);
  return lista[0]?.commit?.id === sha;
}

/** Vuelve a `deployId`, espera a que quede en vivo y revisa que el autodeploy siga encendido. */
export async function revertir(render, deployId, { cadaMs = 20_000, maxMs = 15 * 60_000 } = {}) {
  const nuevo = await render.rollback(deployId);
  const id = nuevo?.id ?? nuevo?.deploy?.id;
  const fin = Date.now() + maxMs;
  let resultado = { ok: false, id, estado: 'tiempo_agotado' };
  while (Date.now() < fin) {
    await dormir(cadaMs);
    const d = (await render.deploys(10)).find((x) => x.id === id);
    if (d && TERMINADOS_OK.has(d.status)) {
      resultado = { ok: true, id, estado: 'live' };
      break;
    }
    if (d && TERMINADOS_MAL.has(d.status)) {
      resultado = { ok: false, id, estado: d.status };
      break;
    }
  }
  const servicio = await render.servicio().catch(() => null);
  return { ...resultado, autoDeploy: servicio?.autoDeploy ?? 'desconocido' };
}

const esCli = process.argv[1]?.endsWith('render.mjs');
if (esCli) {
  const [accion, valor] = process.argv.slice(2);
  const salida = async (pares) => {
    const texto = Object.entries(pares).map(([k, v]) => `${k}=${v ?? ''}`).join('\n');
    console.log(texto);
    if (process.env.GITHUB_OUTPUT) (await import('node:fs')).appendFileSync(process.env.GITHUB_OUTPUT, `${texto}\n`);
  };
  try {
    const render = cliente({ apiKey: process.env.RENDER_API_KEY, serviceId: process.env.RENDER_SERVICE_ID });
    if (accion === 'esperar') {
      const r = await esperar(render, valor);
      await salida({ estado: r.estado, deploy: r.actual?.id, anterior: r.anterior?.id });
    } else if (accion === 'ultimo') {
      await salida({ es_ultimo: await esUltimo(render, valor) });
    } else if (accion === 'rollback') {
      const r = await revertir(render, valor);
      await salida({ rollback_ok: r.ok, rollback_deploy: r.id, rollback_estado: r.estado, auto_deploy: r.autoDeploy });
      process.exit(r.ok ? 0 : 1);
    } else {
      console.error('Uso: render.mjs esperar <sha> | ultimo <sha> | rollback <deployId>');
      process.exit(2);
    }
  } catch (e) {
    // Sin secreto o error de la API de Render: se distingue en el aviso.
    const sinClave = /RENDER_API_KEY/.test(e.message);
    console.error(e.message);
    if (accion === 'esperar') await salida({ estado: sinClave ? 'sin_clave' : 'error_api' });
    process.exit(1);
  }
}
