/**
 * Deploys de la API en Render (API pública v1): esperar el deploy de un commit
 * y volver al deploy anterior (rollback). La clave va en RENDER_API_KEY (secreto
 * de GitHub); nunca se imprime.
 *
 * Uso:
 *   node infra/deploy/render.mjs esperar <sha>     → espera a que el deploy del commit termine
 *   node infra/deploy/render.mjs rollback <deployId> → vuelve a ese deploy y espera a que quede en vivo
 */

const BASE = 'https://api.render.com/v1';
export const TERMINADOS_OK = new Set(['live']);
export const TERMINADOS_MAL = new Set(['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled', 'deactivated']);

export function cliente({ apiKey, serviceId, fetch: f = fetch }) {
  if (!apiKey) throw new Error('Falta RENDER_API_KEY (secreto de GitHub)');
  if (!serviceId) throw new Error('Falta RENDER_SERVICE_ID');
  const pedir = async (ruta, init = {}) => {
    const r = await f(`${BASE}${ruta}`, {
      ...init,
      headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...init.headers },
    });
    if (!r.ok) throw new Error(`Render ${init.method ?? 'GET'} ${ruta} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
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
  };
}

/**
 * El deploy de `sha` y el que estaba en vivo antes (al que se vuelve si falla).
 * Si el commit no tiene deploy propio (Render agrupa pushes seguidos) se toma
 * el más reciente creado después.
 */
export function ubicar(deploys, sha) {
  const i = deploys.findIndex((d) => d.commit?.id === sha);
  if (i === -1) return { actual: null, anterior: null };
  const anterior = deploys.slice(i + 1).find((d) => d.status === 'live' || d.status === 'deactivated') ?? null;
  return { actual: deploys[i], anterior };
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera a que el deploy de `sha` termine; devuelve el estado final. */
export async function esperar(render, sha, { cadaMs = 20_000, maxMs = 25 * 60_000, sinDeployMs = 6 * 60_000 } = {}) {
  const inicio = Date.now();
  const fin = inicio + maxMs;
  while (Date.now() < fin) {
    const lista = await render.deploys();
    const { actual, anterior } = ubicar(lista, sha);
    // Render no creó deploy para este commit (p. ej. lo agrupó con otro push).
    if (!actual && Date.now() - inicio > sinDeployMs) return { estado: 'sin_deploy', actual: null, anterior: null };
    // Un commit más nuevo ya reemplazó a este: su propio workflow lo revisará.
    if (actual && actual.status === 'deactivated' && lista[0]?.commit?.id !== sha) {
      return { estado: 'reemplazado', actual, anterior };
    }
    if (actual && (TERMINADOS_OK.has(actual.status) || TERMINADOS_MAL.has(actual.status))) {
      return { estado: actual.status, actual, anterior };
    }
    await dormir(cadaMs);
  }
  return { estado: 'tiempo_agotado', actual: null, anterior: null };
}

/** Vuelve a `deployId` y espera a que el rollback quede en vivo. */
export async function revertir(render, deployId, { cadaMs = 20_000, maxMs = 15 * 60_000 } = {}) {
  const nuevo = await render.rollback(deployId);
  const id = nuevo?.id ?? nuevo?.deploy?.id;
  const fin = Date.now() + maxMs;
  while (Date.now() < fin) {
    await dormir(cadaMs);
    const d = (await render.deploys(10)).find((x) => x.id === id);
    if (d && TERMINADOS_OK.has(d.status)) return { ok: true, id };
    if (d && TERMINADOS_MAL.has(d.status)) return { ok: false, id, estado: d.status };
  }
  return { ok: false, id, estado: 'tiempo_agotado' };
}

const esCli = process.argv[1]?.endsWith('render.mjs');
if (esCli) {
  const [accion, valor] = process.argv.slice(2);
  const render = cliente({ apiKey: process.env.RENDER_API_KEY, serviceId: process.env.RENDER_SERVICE_ID });
  const salida = async (pares) => {
    const texto = Object.entries(pares).map(([k, v]) => `${k}=${v ?? ''}`).join('\n');
    console.log(texto);
    if (process.env.GITHUB_OUTPUT) (await import('node:fs')).appendFileSync(process.env.GITHUB_OUTPUT, `${texto}\n`);
  };
  if (accion === 'esperar') {
    const r = await esperar(render, valor);
    await salida({ estado: r.estado, deploy: r.actual?.id, anterior: r.anterior?.id });
  } else if (accion === 'rollback') {
    const r = await revertir(render, valor);
    await salida({ rollback_ok: r.ok, rollback_deploy: r.id, rollback_estado: r.estado ?? 'live' });
    process.exit(r.ok ? 0 : 1);
  } else {
    console.error('Uso: render.mjs esperar <sha> | rollback <deployId>');
    process.exit(2);
  }
}
