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

### Tramo de ida (DPI→Recinto, `tracking-posiciones-ida.mjs`)

`POST /tracking/posiciones` está pensado solo para el tramo de retorno: el
guard de `ingestarPosiciones` exige que exista `SALIDA_RECINTO` y rechaza con
400 si no. Pero `EnTransitoScreen.tsx` (tramo de ida) también llama
`iniciarRastreoPrimerPlano()` cada 10s y manda posiciones igual — el móvil
traga esos 400 en silencio (`location.ts`). En un día real ese tráfico de
"descarte" coexiste con el tráfico válido de retorno, así que vale medir si
también aguanta concurrencia.

```bash
BASE_URL=https://cne-imbabura-api.onrender.com node apps/api/loadtest/tracking-posiciones-ida.mjs
```

Requiere un operador con `SALIDA_DPI` registrada y sin `SALIDA_RECINTO` (en
producción se sembró a mano vía Supabase MCP, ya que
`seed-tracking-posiciones.ts` está bloqueado a localhost).

**Resultado real contra producción (2026-08-25, mismo entorno que arriba):**

| VUs | reqs | inesperados | p50 | p95 | p99 |
|---|---|---|---|---|---|
| 5 | 25 | 0% | 541ms | 1981ms | 1998ms |
| 10 | 49 | 0% | 502ms | 2199ms | 2314ms |
| 20 | 100 | 0% | 495ms | 1051ms | 1164ms |
| 40 | 193 | 0% | 519ms | 2106ms | 2342ms |
| 80 | 362 | 0% | 565ms | 4019ms | 4416ms |

**100% de las respuestas fueron el 400 esperado** (0% de status inesperado) en
todos los escalones, con un perfil de latencia prácticamente igual al del
retorno — el guard de dos `findFirst` en transacción no le cuesta más a Render
que el camino que sí inserta. Conclusión: el tráfico de descarte del tramo de
ida no agrega riesgo de capacidad aparte del que ya mide el test de retorno.

Sembrado y limpiado igual que el test de retorno: usuario y `EventoTracking`
sintéticos vía Supabase MCP, borrados y verificados en 0 inmediatamente
después de la corrida.

**Nota:** esta prueba midió el comportamiento ANTES de generalizar
`ingestarPosiciones` a ambos tramos (ver commit siguiente). Con el backend
actualizado, el tramo de ida ya no responde 400 sino 200 e inserta en
`posiciones_gps` — ver la sección siguiente.

### Prueba combinada (ida + retorno escribiendo a la vez, `tracking-posiciones-combinado.mjs`)

Tras generalizar `ingestarPosiciones` para aceptar GPS en ambos tramos
(`EN_TRANSITO` y `EN_RETORNO`, ver `deriveEstadoOperador`), el volumen real de
escrituras a `posiciones_gps` en un día de elecciones puede ser el doble del
medido arriba — antes solo el retorno insertaba, ahora también la ida. Esta
prueba simula ambos tramos concurrentes contra el mismo evento.

```bash
# 1. DB local + API (con el código nuevo, en watch mode)
pnpm db:up
pnpm dev:api

# 2. Sembrar los DOS operadores sintéticos (mismo evento ACTIVO local)
pnpm --filter @cne/api exec ts-node --transpile-only loadtest/seed-tracking-posiciones.ts
pnpm --filter @cne/api exec ts-node --transpile-only loadtest/seed-tracking-posiciones-ida.ts

# 3. Correr el test combinado (reparte los VUs de cada escalón mitad ida / mitad retorno)
node apps/api/loadtest/tracking-posiciones-combinado.mjs
```

**Resultado local (2026-08-24, host dev de Sebastian, CPU sin limitar, Postgres
local — no representativo del free tier de Render, solo valida el código bajo
concurrencia):**

| VUs totales | ida/retorno | reqs | errores | p50 | p95 | p99 |
|---|---|---|---|---|---|---|
| 5 | 2/3 | 25 | 0% | 32ms | 101ms | 113ms |
| 10 | 5/5 | 50 | 0% | 30ms | 85ms | 166ms |
| 20 | 10/10 | 100 | 0% | 31ms | 81ms | 105ms |
| 40 | 20/20 | 200 | 0% | 30ms | 180ms | 183ms |
| 80 | 40/40 | 401 | 0% | 29ms | 291ms | 292ms |

**0% errores hasta 80 operadores concurrentes (40 en ida + 40 en retorno
escribiendo a la vez).** Se verificó manualmente que las filas realmente se
insertan (`posiciones_gps` creció para ambos operadores, no solo devolvió
200 sin persistir) y que `GET /tracking/operadores-en-retorno` distingue
correctamente `estado: "EN_TRANSITO"` vs `"EN_RETORNO"` para cada uno.

Esto valida que el código soporta la concurrencia combinada (sin deadlocks,
sin degradación por compartir la tabla `posiciones_gps` entre ambos tramos),
pero **no reemplaza** la medición de capacidad real de Render — para eso hace
falta repetir este mismo test contra producción una vez desplegado el cambio
(mismo método que las dos secciones anteriores: datos sintéticos, limpieza
inmediata).
