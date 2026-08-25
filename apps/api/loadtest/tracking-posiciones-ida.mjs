// Variante de tracking-posiciones.mjs para el tramo de IDA (DPI→Recinto).
//
// A diferencia del retorno, el backend RECHAZA con 400 cualquier posición
// mandada durante la ida (ver ingestarPosiciones en tracking.service.ts: exige
// SALIDA_RECINTO previa). El móvil igual la manda desde EnTransitoScreen.tsx
// (iniciarRastreoPrimerPlano cada 10s) y traga el error silenciosamente.
//
// Este script mide si ese tráfico "de descarte" (auth + 2 findFirst en
// transacción, sin INSERT) también aguanta concurrencia, ya que en un día
// real coexiste con el tráfico válido de retorno. Se espera 100% de status
// 400 — eso es éxito aquí, no falla. Solo cuenta como error un status
// distinto de 400 (5xx, timeout, etc.) o el status esperado ausente.
//
// Uso:
//   BASE_URL=https://cne-imbabura-api.onrender.com node apps/api/loadtest/tracking-posiciones-ida.mjs
//
// Requiere un operador con SALIDA_DPI registrada y SIN SALIDA_RECINTO (ver
// conversación — sembrado a mano vía Supabase MCP para producción, ya que
// seed-tracking-posiciones.ts está bloqueado a localhost).

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const EMAIL = process.env.EMAIL ?? 'loadtest.operador@cne-imbabura.gob.ec';
const PASSWORD = process.env.PASSWORD ?? 'LoadT3s!';

const INTERVAL_MS = 10000; // EnTransitoScreen usa iniciarRastreoPrimerPlano cada 10s
const JITTER_MS = 2000;

const DPI_LAT = 0.35849;
const DPI_LNG = -78.11886;

const STAGES = [
  { vus: 5, durationMs: 45_000 },
  { vus: 10, durationMs: 45_000 },
  { vus: 20, durationMs: 45_000 },
  { vus: 40, durationMs: 45_000 },
  { vus: 80, durationMs: 45_000 },
];

function jitterCoord(base) {
  return base + (Math.random() - 0.5) * 0.001;
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
            latitud: jitterCoord(DPI_LAT),
            longitud: jitterCoord(DPI_LNG),
            capturadoEn: new Date().toISOString(),
          },
        ],
      }),
    });
    const latencyMs = performance.now() - started;
    return { ok: res.status === 400, status: res.status, latencyMs };
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
  const inesperados = results.filter((r) => !r.ok);
  const p50 = percentile(latencies, 0.5);
  const p95 = percentile(latencies, 0.95);
  const p99 = percentile(latencies, 0.99);
  const unexpectedRate = results.length ? inesperados.length / results.length : 0;

  console.log(
    `VUs=${String(vus).padStart(3)}  reqs=${String(results.length).padStart(4)}  ` +
      `esperados(400)=${results.length - inesperados.length}  inesperados=${String(inesperados.length).padStart(3)} (${(unexpectedRate * 100).toFixed(1)}%)  ` +
      `p50=${p50?.toFixed(0)}ms  p95=${p95?.toFixed(0)}ms  p99=${p99?.toFixed(0)}ms`,
  );
  if (inesperados.length > 0) {
    const sample = inesperados.slice(0, 3).map((e) => e.status || e.error);
    console.log(`  ejemplos inesperados: ${JSON.stringify(sample)}`);
  }
  return { vus, requests: results.length, unexpectedRate, p50, p95, p99 };
}

async function main() {
  console.log(`→ Login como ${EMAIL} contra ${BASE_URL}`);
  const token = await login();
  console.log('✓ Token obtenido');
  console.log(
    'Este operador está en estado "ida" (SALIDA_DPI sin SALIDA_RECINTO): se espera',
    '400 en el 100% de las respuestas — es el comportamiento correcto del guard,',
    'no una falla. Solo cuenta como inesperado un status distinto de 400.\n',
  );

  const summary = [];
  for (const stage of STAGES) {
    const results = await runStage(token, stage.vus, stage.durationMs);
    summary.push(summarize(stage.vus, results));
  }

  console.log('\n--- Resumen (tramo de ida) ---');
  console.table(summary.map((s) => ({
    VUs: s.vus,
    reqs: s.requests,
    'inesperados%': (s.unexpectedRate * 100).toFixed(1),
    p50_ms: s.p50?.toFixed(0),
    p95_ms: s.p95?.toFixed(0),
    p99_ms: s.p99?.toFixed(0),
  })));
}

main().catch((e) => {
  console.error('✗ Error en el load test:', e);
  process.exit(1);
});
