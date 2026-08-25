// Load test COMBINADO: simula un día real donde, al mismo tiempo, hay
// operadores en el tramo de ida (DPI→Recinto) y operadores en el tramo de
// retorno (Recinto→DPI) mandando GPS concurrentemente a POST /tracking/posiciones.
//
// Antes de este cambio (ver tracking.service.ts, ingestarPosiciones) solo el
// tramo de retorno insertaba en posiciones_gps — la ida se rechazaba con 400
// sin tocar la tabla. Ahora ambos tramos insertan, así que el volumen de
// escritura real en un día de elecciones puede ser el doble del que ya se
// midió antes (ver "Capacidad para GPS de operadores en retorno" en el
// README). Este script mide justo ese escenario combinado.
//
// Se espera 100% de status 200 en ambos tramos — cualquier otro código es un
// error real (antes, para el script de ida vieja, 400 era el "éxito").
//
// Requiere DOS operadores sembrados en el mismo evento ACTIVO local:
//   pnpm --filter @cne/api exec ts-node --transpile-only loadtest/seed-tracking-posiciones.ts
//   pnpm --filter @cne/api exec ts-node --transpile-only loadtest/seed-tracking-posiciones-ida.ts
//
// Uso:
//   node apps/api/loadtest/tracking-posiciones-combinado.mjs

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';

const RETORNO_EMAIL = process.env.RETORNO_EMAIL ?? 'loadtest.operador@cne-imbabura.gob.ec';
const RETORNO_PASSWORD = process.env.RETORNO_PASSWORD ?? 'LoadT3s!';
const IDA_EMAIL = process.env.IDA_EMAIL ?? 'loadtest.ida@cne-imbabura.gob.ec';
const IDA_PASSWORD = process.env.IDA_PASSWORD ?? 'LoadT3s!';

const INTERVAL_MS = 10000; // mismo intervalo que EnTransitoScreen/EnRetornoScreen (~10s)
const JITTER_MS = 2000;

const RETORNO_LAT = 0.361;
const RETORNO_LNG = -78.115;
const IDA_LAT = 0.35849;
const IDA_LNG = -78.11886;

const STAGES = [
  { totalVus: 5, durationMs: 45_000 },
  { totalVus: 10, durationMs: 45_000 },
  { totalVus: 20, durationMs: 45_000 },
  { totalVus: 40, durationMs: 45_000 },
  { totalVus: 80, durationMs: 45_000 },
];

function jitterCoord(base) {
  return base + (Math.random() - 0.5) * 0.001;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`Login falló (${email}): ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.accessToken;
}

async function postPosicion(token, baseLat, baseLng) {
  const started = performance.now();
  try {
    const res = await fetch(`${BASE_URL}/tracking/posiciones`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        posiciones: [
          {
            latitud: jitterCoord(baseLat),
            longitud: jitterCoord(baseLng),
            capturadoEn: new Date().toISOString(),
          },
        ],
      }),
    });
    const latencyMs = performance.now() - started;
    return { ok: res.status === 200, status: res.status, latencyMs };
  } catch (err) {
    return { ok: false, status: 0, latencyMs: performance.now() - started, error: String(err) };
  }
}

async function runStage(token, vus, durationMs, baseLat, baseLng) {
  const results = [];
  const deadline = Date.now() + durationMs;

  async function worker() {
    while (Date.now() < deadline) {
      const r = await postPosicion(token, baseLat, baseLng);
      results.push(r);
      const wait = INTERVAL_MS + (Math.random() - 0.5) * JITTER_MS;
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(wait, remaining)));
    }
  }

  await Promise.all(Array.from({ length: vus }, () => worker()));
  return results;
}

function summarize(results) {
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const errores = results.filter((r) => !r.ok);
  return {
    requests: results.length,
    errores: errores.length,
    errorRate: results.length ? errores.length / results.length : 0,
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    p99: percentile(latencies, 0.99),
    muestraErrores: errores.slice(0, 3).map((e) => e.status || e.error),
  };
}

async function main() {
  console.log(`→ Login como ida (${IDA_EMAIL}) y retorno (${RETORNO_EMAIL}) contra ${BASE_URL}`);
  const [tokenIda, tokenRetorno] = await Promise.all([
    login(IDA_EMAIL, IDA_PASSWORD),
    login(RETORNO_EMAIL, RETORNO_PASSWORD),
  ]);
  console.log('✓ Tokens obtenidos. Se espera 200 en el 100% de las respuestas de ambos tramos.\n');

  const summary = [];
  for (const stage of STAGES) {
    const vusIda = Math.floor(stage.totalVus / 2);
    const vusRetorno = stage.totalVus - vusIda;

    const [resIda, resRetorno] = await Promise.all([
      runStage(tokenIda, vusIda, stage.durationMs, IDA_LAT, IDA_LNG),
      runStage(tokenRetorno, vusRetorno, stage.durationMs, RETORNO_LAT, RETORNO_LNG),
    ]);

    const sIda = summarize(resIda);
    const sRetorno = summarize(resRetorno);
    const combinado = summarize([...resIda, ...resRetorno]);

    console.log(
      `VUs=${String(stage.totalVus).padStart(3)} (ida=${vusIda}/retorno=${vusRetorno})  ` +
        `reqs=${String(combinado.requests).padStart(4)}  errores=${String(combinado.errores).padStart(3)} (${(combinado.errorRate * 100).toFixed(1)}%)  ` +
        `p50=${combinado.p50?.toFixed(0)}ms  p95=${combinado.p95?.toFixed(0)}ms  p99=${combinado.p99?.toFixed(0)}ms`,
    );
    if (combinado.errores > 0) {
      console.log(`  ida: ${sIda.errores} errores ${JSON.stringify(sIda.muestraErrores)}`);
      console.log(`  retorno: ${sRetorno.errores} errores ${JSON.stringify(sRetorno.muestraErrores)}`);
    }

    summary.push({ vus: stage.totalVus, vusIda, vusRetorno, ...combinado });
  }

  console.log('\n--- Resumen (ida + retorno combinados) ---');
  console.table(
    summary.map((s) => ({
      VUs: s.vus,
      'ida/retorno': `${s.vusIda}/${s.vusRetorno}`,
      reqs: s.requests,
      'errores%': (s.errorRate * 100).toFixed(1),
      p50_ms: s.p50?.toFixed(0),
      p95_ms: s.p95?.toFixed(0),
      p99_ms: s.p99?.toFixed(0),
    })),
  );
}

main().catch((e) => {
  console.error('✗ Error en el load test combinado:', e);
  process.exit(1);
});
