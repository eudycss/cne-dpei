# Pruebas de estrés — día de elecciones

Ver `election-day.js`. Requiere Docker y el API corriendo localmente.

```bash
docker run --rm -i \
  -e BASE_URL=http://host.docker.internal:3000 \
  -e TEST_EMAIL=k6-loadtest@cne-imbabura.gob.ec \
  -e TEST_PASSWORD='LoadTest*2026Temp' \
  -v "$(pwd)/loadtest:/scripts" \
  grafana/k6 run /scripts/election-day.js
```

El usuario `k6-loadtest@cne-imbabura.gob.ec` es una cuenta dedicada solo para
pruebas de carga (rol ADMINISTRADOR), creada con `create-loadtest-user.ts`.
No es el admin real. Bórrala en producción/antes de desplegar si no la quieres
en la base de datos:

```sql
DELETE FROM usuarios WHERE email = 'k6-loadtest@cne-imbabura.gob.ec';
```

## Capacidad para GPS de operadores en retorno (`tracking-posiciones.mjs`)

Mide cuántos operadores "en retorno" concurrentes (posteando GPS cada ~12s, igual
que `apps/mobile/src/lib/location.ts`) aguanta `POST /tracking/posiciones` antes de
degradarse. Es un script Node puro (sin k6/Docker) porque no requiere los
escenarios avanzados de k6 (`constant-arrival-rate`, `http.batch`) que sí usa
`election-day.js`.

```bash
# 1. Levanta la DB local y el API
pnpm db:up
pnpm dev:api

# 2. Siembra evento/operador/kit/tracking sintéticos (reusa el evento ACTIVO
#    local si ya existe uno; aborta si DATABASE_URL no apunta a localhost)
pnpm --filter @cne/api exec ts-node --transpile-only loadtest/seed-tracking-posiciones.ts

# 3. Corre el load test (stages 5→10→20→40→80 VUs, ~45s cada uno)
node apps/api/loadtest/tracking-posiciones.mjs
```

**Resultado local de referencia (2026-08-23, host dev de Sebastian, CPU sin
limitar, Postgres local):** 0% errores hasta 80 operadores concurrentes; p95 sube
de 376ms (5 VUs) a 1.7s (80 VUs). No representativo del free tier real de
Render — solo mide el techo con CPU completa.

**Resultado real contra producción (2026-08-24, Render free tier 0.1 vCPU /
512MB, Supabase real, endpoint `https://cne-imbabura-api.onrender.com`):**

| VUs | reqs | errores | p50 | p95 | p99 |
|---|---|---|---|---|---|
| 5 | 20 | 0% | 597ms | 2310ms | 2310ms |
| 10 | 40 | 0% | 538ms | 2493ms | 2494ms |
| 20 | 80 | 0% | 534ms | 1207ms | 1320ms |
| 40 | 160 | 0% | 551ms | 2663ms | 2864ms |
| 80 | 318 | 0% | 594ms | 4789ms | 4930ms |

**0% errores hasta 80 operadores en retorno simultáneos.** El p50 se mantiene
estable (~530-600ms) en todos los escalones — dominado por el round-trip de red
a Supabase, no por el CPU de Render — mientras que el p95/p99 sí crece con la
carga (de 2.3s a 4.8s), señal de cola de espera bajo presión, no de fallas.
Conclusión práctica: para la escala real de operadores CDA de Imbabura (decenas,
no cientos), el free tier aguanta el patrón de tracking GPS sin caerse; el techo
real no se alcanzó ni a 80 VUs. Si se necesita p95 más bajo bajo carga alta, el
cuello de botella a atacar primero sería la latencia Render↔Supabase (región/
pooler), no el plan de Render.

Prueba corrida con datos 100% sintéticos (`LOADTEST-*`) enganchados al evento
`ACTIVO` real existente (no se creó uno nuevo, para no romper el supuesto de
"un solo evento activo" del sistema) y borrados inmediatamente después —
incluidas las filas de `posiciones_gps` que generó la propia prueba. Antes de
repetir esto: confirmar que el proyecto de Supabase esté en estado "Active" (se
pausa solo tras ~1 semana sin tráfico) y hacerlo en horario sin uso real.
