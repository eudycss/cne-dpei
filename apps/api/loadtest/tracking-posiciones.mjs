// Load test casero para POST /tracking/posiciones (sin k6/Docker — Node puro,
// fetch nativo). Mide cuántos "operadores en retorno" concurrentes aguanta la
// API antes de que la latencia/errores se disparen.
//
// Uso:
//   BASE_URL=http://localhost:3000 EMAIL=... PASSWORD=... node apps/api/loadtest/tracking-posiciones.mjs
//
// Requiere haber corrido antes:
//   pnpm --filter @cne/api exec ts-node --transpile-only loadtest/seed-tracking-posiciones.ts

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.EMAIL ?? 'loadtest.operador@cne-imbabura.gob.ec';
const PASSWORD = process.env.PASSWORD ?? 'LoadT3s!';

// Réplica del intervalo real del móvil (apps/mobile/src/lib/location.ts):
// background cada 15s, foreground cada 10s. Usamos ~12s de promedio ± jitter.
const INTERVAL_MS = 12000;
const JITTER_MS = 3000;

const RECINTO_LAT = 0.361;
const RECINTO_LNG = -78.115;

const STAGES = [
  { vus: 5, durationMs: 45_000 },
  { vus: 10, durationMs: 45_000 },
  { vus: 20, durationMs: 45_000 },
  { vus: 40, durationMs: 45_000 },
  { vus: 80, durationMs: 45_000 },
];

function jitterCoord(base) {
  return base + (Math.random() - 0.5) * 0.001; // ~±50m
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

async function login() {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`Login falló: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.accessToken;
}

async function postPosicion(token) {
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
            latitud: jitterCoord(RECINTO_LAT),
            longitud: jitterCoord(RECINTO_LNG),
            capturadoEn: new Date().toISOString(),
          },
        ],
      }),
    });
    const latencyMs = performance.now() - started;
    return { ok: res.ok, status: res.status, latencyMs };
  } catch (err) {
    return { ok: false, status: 0, latencyMs: performance.now() - started, error: String(err) };
  }
}

async function runStage(token, vus, durationMs) {
  const results = [];
  const deadline = Date.now() + durationMs;

  async function worker() {
    while (Date.now() < deadline) {
      const r = await postPosicion(token);
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

function summarize(vus, results) {
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const errores = results.filter((r) => !r.ok);
  const p50 = percentile(latencies, 0.5);
  const p95 = percentile(latencies, 0.95);
  const p99 = percentile(latencies, 0.99);
  const errorRate = results.length ? errores.length / results.length : 0;

  console.log(
    `VUs=${String(vus).padStart(3)}  reqs=${String(results.length).padStart(4)}  ` +
      `errors=${String(errores.length).padStart(3)} (${(errorRate * 100).toFixed(1)}%)  ` +
      `p50=${p50?.toFixed(0)}ms  p95=${p95?.toFixed(0)}ms  p99=${p99?.toFixed(0)}ms`,
  );
  if (errores.length > 0) {
    const sample = errores.slice(0, 3).map((e) => e.status || e.error);
    console.log(`  ejemplos de error: ${JSON.stringify(sample)}`);
  }
  return { vus, requests: results.length, errorRate, p50, p95, p99 };
}

async function main() {
  console.log(`→ Login como ${EMAIL} contra ${BASE_URL}`);
  const token = await login();
  console.log('✓ Token obtenido\n');

  console.log(
    `Intervalo simulado por operador: ~${INTERVAL_MS / 1000}s (± ${JITTER_MS / 1000}s), igual que el móvil real.\n`,
  );

  const summary = [];
  for (const stage of STAGES) {
    const results = await runStage(token, stage.vus, stage.durationMs);
    summary.push(summarize(stage.vus, results));
  }

  console.log('\n--- Resumen ---');
  console.table(summary.map((s) => ({
    VUs: s.vus,
    reqs: s.requests,
    'error%': (s.errorRate * 100).toFixed(1),
    p50_ms: s.p50?.toFixed(0),
    p95_ms: s.p95?.toFixed(0),
    p99_ms: s.p99?.toFixed(0),
  })));
}

main().catch((e) => {
  console.error('✗ Error en el load test:', e);
  process.exit(1);
});
