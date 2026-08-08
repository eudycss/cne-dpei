// Prueba de estrés orientada al día de elecciones.
//
// Cómo correrla (requiere Docker):
//   docker run --rm -i \
//     -e BASE_URL=http://host.docker.internal:3000 \
//     -e TEST_EMAIL=admin@cne-imbabura.gob.ec \
//     -e TEST_PASSWORD=<password real del admin en tu DB local> \
//     -v "$(pwd)/apps/api/loadtest:/scripts" \
//     grafana/k6 run /scripts/election-day.js
//
// Si TEST_PASSWORD no es correcta, el escenario de lectura autenticada y el de
// carrera de refresh se saltan solos (con un aviso) — el resto de la prueba sigue.
//
// Escenarios:
//   1. login_burst        — ráfaga de logins con contraseña incorrecta contra un
//                            email real. Ejercita argon2.verify (CPU) + el nuevo
//                            rate limit de /auth/login (5 intentos/min por IP).
//   2. login_valid_trickle— logins válidos a ritmo bajo, para medir el costo real
//                            de emitir tokens (argon2.hash + insert de refresh token)
//                            sin chocar contra el propio rate limit.
//   3. catalog_read       — lectura autenticada sostenida (GET /tipos-evento),
//                            representa el tráfico de fondo de un día normal.
//   4. refresh_race       — dispara 5 refresh concurrentes con el MISMO refresh
//                            token para verificar que la rotación no genera una
//                            condición de carrera (debe ganar exactamente uno).

import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TEST_EMAIL = __ENV.TEST_EMAIL || 'admin@cne-imbabura.gob.ec';
const TEST_PASSWORD = __ENV.TEST_PASSWORD || 'Admin*Inicial2026';

export const options = {
  scenarios: {
    login_burst: {
      executor: 'ramping-vus',
      exec: 'loginBurst',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 20 }, // ráfaga de "clock-in" a las 7am
        { duration: '20s', target: 20 },
        { duration: '10s', target: 0 },
      ],
    },
    login_valid_trickle: {
      executor: 'constant-arrival-rate',
      exec: 'loginValid',
      rate: 2,
      timeUnit: '1m', // bajo el límite de 5/min para no chocar con el propio throttle
      duration: '50s',
      preAllocatedVUs: 3,
    },
    catalog_read: {
      executor: 'constant-arrival-rate',
      exec: 'catalogRead',
      rate: 30,
      timeUnit: '1s',
      duration: '50s',
      preAllocatedVUs: 20,
      startTime: '5s',
    },
    refresh_race: {
      executor: 'per-vu-iterations',
      exec: 'refreshRace',
      vus: 1,
      iterations: 1,
      startTime: '2s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1500'],
  },
};

export function setup() {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (res.status !== 200) {
    console.warn(
      `[setup] login con TEST_EMAIL/TEST_PASSWORD falló (status ${res.status}). ` +
        'catalog_read y refresh_race se saltarán. Pasa credenciales válidas con -e TEST_EMAIL= -e TEST_PASSWORD=.',
    );
    return { accessToken: null, refreshToken: null };
  }
  const body = res.json();
  return { accessToken: body.accessToken, refreshToken: body.refreshToken };
}

export function loginBurst() {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: TEST_EMAIL, password: 'contraseña-incorrecta-a-proposito' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, {
    'login inválido: 401 o 429 (nunca 5xx)': (r) => r.status === 401 || r.status === 429,
  });
  sleep(1);
}

export function loginValid() {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, {
    'login válido: 200 o 429 (nunca 5xx)': (r) => r.status === 200 || r.status === 429,
  });
}

export function catalogRead(data) {
  if (!data.accessToken) return;
  const res = http.get(`${BASE_URL}/tipos-evento`, {
    headers: { Authorization: `Bearer ${data.accessToken}` },
  });
  check(res, { 'catalog: 200': (r) => r.status === 200 });
}

export function refreshRace(data) {
  if (!data.refreshToken) return;
  const payload = JSON.stringify({ refreshToken: data.refreshToken });
  const headers = { 'Content-Type': 'application/json' };
  const requests = Array.from({ length: 5 }, () => ({
    method: 'POST',
    url: `${BASE_URL}/auth/refresh`,
    body: payload,
    params: { headers },
  }));
  const responses = http.batch(requests);
  const successes = responses.filter((r) => r.status === 200).length;
  const unauthorized = responses.filter((r) => r.status === 401).length;
  const serverErrors = responses.filter((r) => r.status >= 500).length;
  check(
    { successes, unauthorized, serverErrors },
    {
      'refresh concurrente: exactamente 1 ganador': (o) => o.successes === 1,
      'refresh concurrente: el resto 401 (no 5xx)': (o) => o.serverErrors === 0,
    },
  );
}
