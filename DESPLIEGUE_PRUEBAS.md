# Guía de despliegue de prueba (gratis) — CNE Imbabura

Esta guía te lleva paso a paso para poner el sistema en internet usando **solo herramientas
gratuitas**, para que puedas probarlo desde cualquier lugar (incluyendo el celular con la app
móvil) sin depender de tu PC encendida.

**Esto es un entorno de PRUEBAS**, separado del despliegue final (VPS Ubuntu + PM2) que ya está
decidido para producción real. Sirve para validar que todo funciona end-to-end mientras no
tengas el VPS listo.

## Resumen de lo que vamos a montar

| Componente | Dónde | Costo |
|---|---|---|
| Base de datos (Postgres + PostGIS) | Supabase | Gratis |
| API (NestJS) | Render | Gratis |
| Web (React/Vite) | Vercel | Gratis |
| App móvil (APK Android) | EAS Build (Expo) | Gratis |

**Cuentas que necesitas crear** (todas gratis, puedes usar tu cuenta de GitHub para entrar a
varias y acelerar el proceso):

- [ ] Supabase — https://supabase.com
- [ ] Render — https://render.com
- [ ] Vercel — https://vercel.com
- [ ] Expo — https://expo.dev

Te recomiendo crearlas todas con el mismo correo y, donde se pueda, con "Continuar con GitHub"
(usando tu cuenta de GitHub, donde está tu repo `eudycss/cne-dpei`).

---

## Fase 0 — Antes de empezar: sube tus cambios a GitHub

Render y Vercel **no leen tu disco**, leen el repositorio de GitHub. Si tienes cambios sin subir
en tu rama actual (`probarweb`), no aparecerán en el despliegue.

1. Revisa qué tienes pendiente:
   ```powershell
   git status
   ```
2. Cuando quieras, dime y hacemos juntos el commit y push de lo que falte (no lo hago solo,
   porque puede haber archivos que no quieras subir, como `.env`).
3. En Render y Vercel vamos a desplegar desde la rama **`probarweb`** (donde está el trabajo
   actual). Cuando quieras "promover" a producción real, simplemente cambias la rama conectada
   a `main`.

---

## Fase 1 — Base de datos en Supabase

### 1.1 Crear cuenta y proyecto

1. Ve a https://supabase.com y entra con "Sign in with GitHub".
2. Click en **"New project"**.
3. Completa:
   - **Name**: `cne-imbabura` (o el nombre que quieras).
   - **Database Password**: genera una contraseña fuerte y **guárdala en un lugar seguro** (la
     necesitarás en un momento, no se vuelve a mostrar completa).
   - **Region**: elige la más cercana (ej. `South America (São Paulo)`). Para pruebas no es
     crítico, cualquier región funciona.
4. Click en **"Create new project"**. Espera 1-2 minutos mientras se aprovisiona.

### 1.2 Habilitar las extensiones PostGIS y uuid-ossp

El `schema.prisma` de este proyecto requiere las extensiones `postgis` y `uuid-ossp`
(`apps/api/prisma/schema.prisma`, bloque `datasource`).

1. En el menú lateral de Supabase, ve a **SQL Editor**.
2. Click en **"New query"**.
3. Pega y ejecuta (botón "Run"):
   ```sql
   CREATE EXTENSION IF NOT EXISTS postgis;
   CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
   ```
4. Deberías ver "Success. No rows returned".

### 1.3 Obtener la cadena de conexión (DATABASE_URL)

> ⚠️ La "conexión directa" de Supabase (`db.<ref>.supabase.co:5432`) **solo funciona por
> IPv6**. La mayoría de redes (sobre todo en Ecuador) no tienen IPv6, así que vamos a usar el
> **Connection Pooler (Session mode)**, que es compatible con IPv4 y también gratis.

1. En el menú lateral, ve a **Project Settings** (ícono de engranaje) → **Database**.
2. Busca la sección **"Connection string"** → pestaña **"URI"** → busca la opción
   **"Connection pooling"** (a veces aparece como un switch/dropdown junto a la URI) y elige el
   modo **"Session"** (puerto `5432`).
3. Copia la URI, que se verá algo así (nota que el host ahora termina en
   `pooler.supabase.com`, y el usuario es `postgres.<ref-del-proyecto>`, no solo `postgres`):
   ```
   postgresql://postgres.xxxxxxxxxxxxxxxx:[YOUR-PASSWORD]@aws-0-xx-xxxx-1.pooler.supabase.com:5432/postgres
   ```
4. Reemplaza `[YOUR-PASSWORD]` (bórralo **junto con los corchetes `[` `]`**, no los dejes) por
   la contraseña que guardaste en el paso 1.1, y agrega `?schema=public` al final. Queda así:
   ```
   postgresql://postgres.xxxxxxxxxxxxxxxx:TU_PASSWORD@aws-0-xx-xxxx-1.pooler.supabase.com:5432/postgres?schema=public
   ```
5. **Guarda este valor completo** — lo necesitas en la Fase 3 y la Fase 4. Llamémoslo
   `SUPABASE_DATABASE_URL` en esta guía.

> ⚠️ Importante: el plan gratuito de Supabase **pausa el proyecto tras 7 días sin actividad**.
> Si vuelves después de varios días y la API no responde, entra al dashboard de Supabase y
> verás un botón para "reanudar" el proyecto.

---

## Fase 2 — Generar secretos de producción

Estos valores **nunca deben ser los de `.env.example`** (son de ejemplo, inseguros). Vamos a
generar valores nuevos localmente.

Abre PowerShell en cualquier carpeta y ejecuta cada comando por separado. Copia cada resultado
a un bloc de notas temporal — los usarás en la Fase 3.

1. **JWT_ACCESS_SECRET**:
   ```powershell
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```
2. **JWT_REFRESH_SECRET** (vuelve a ejecutar el mismo comando — cada vez genera un valor
   distinto, necesitas dos valores diferentes):
   ```powershell
   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
   ```
3. **STORAGE_ENCRYPTION_KEY** (debe ser exactamente 64 caracteres hex = 32 bytes):
   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

Al final deberías tener 3 valores distintos guardados.

---

## Fase 3 — Desplegar el API (NestJS) en Render

### 3.1 Crear cuenta y conectar GitHub

1. Ve a https://render.com → "Get Started" → "Sign in with GitHub" → autoriza acceso al
   repositorio `eudycss/cne-dpei` (puedes dar acceso solo a ese repo).

### 3.2 Crear el Web Service

1. En el dashboard de Render, click **"New +"** → **"Web Service"**.
2. Selecciona el repositorio `eudycss/cne-dpei`.
3. Configura:
   - **Name**: `cne-imbabura-api`
   - **Branch**: `probarweb`
   - **Region**: déjala en la opción por defecto (no es crítico para pruebas).
   - **Root Directory**: déjalo **vacío** (es un monorepo, construimos desde la raíz).
   - **Runtime**: `Node`
   - **Build Command**:
     ```
     corepack enable && corepack prepare pnpm@latest --activate && pnpm install --frozen-lockfile && pnpm --filter @cne/shared-types build && pnpm --filter @cne/shared-validation build && pnpm --filter @cne/api db:generate && pnpm --filter @cne/api build
     ```
   - **Start Command**:
     ```
     pnpm --filter @cne/api start
     ```
   - **Instance Type**: `Free`

### 3.3 Variables de entorno

Antes de hacer click en "Create Web Service", busca la sección **"Environment Variables"** y
agrega cada una de estas (botón "Add Environment Variable"):

| Variable | Valor | Notas |
|---|---|---|
| `DATABASE_URL` | el `SUPABASE_DATABASE_URL` de la Fase 1.3 | |
| `API_PORT` | `10000` | Render espera que tu app escuche en el puerto 10000 por defecto. Sin esto, el deploy fallará por "timeout" aunque el build sea exitoso. |
| `WEB_ORIGIN` | `http://localhost:5173` (provisional) | Lo actualizaremos en la Fase 6 con la URL real de Vercel. |
| `JWT_ACCESS_SECRET` | el primer valor generado en la Fase 2 | |
| `JWT_REFRESH_SECRET` | el segundo valor generado en la Fase 2 | |
| `JWT_ACCESS_TTL` | `15m` | |
| `JWT_REFRESH_TTL` | `7d` | |
| `STORAGE_ENCRYPTION_KEY` | el tercer valor generado en la Fase 2 | |
| `STORAGE_DIR` | `storage` | ⚠️ En el plan gratis de Render el disco es temporal: los archivos subidos (fotos, PDFs de kits) se borran cada vez que el servicio se reinicia o redepliega. Aceptable para pruebas. |
| `BREVO_API_KEY` | (déjalo vacío) | Sin esto, el sistema imprime los correos en los logs en vez de enviarlos — suficiente para probar. |

**No** definas `NODE_ENV=production` por ahora: si lo dejas sin definir, Swagger queda disponible
en `/api/docs`, lo que te ayuda mucho a probar la API desde el navegador con la "nueva a esto"
sin necesitar Postman.

### 3.4 Crear y esperar el deploy

1. Click **"Create Web Service"**.
2. Render empieza a construir — esto puede tardar 5-10 minutos la primera vez. Puedes ver el
   progreso en la pestaña **"Logs"**.
3. Cuando termine, verás un estado **"Live"** y una URL arriba, algo como:
   ```
   https://cne-imbabura-api.onrender.com
   ```
   **Guarda esta URL** — la llamaremos `API_URL` en el resto de la guía.

### 3.5 Verificar que el API responde

Abre en el navegador:
```
https://cne-imbabura-api.onrender.com/api/docs
```
Deberías ver la interfaz de Swagger con todos los endpoints. Si la primera carga tarda 30-50
segundos y luego responde, es normal: el plan gratis de Render "duerme" el servicio tras 15
minutos sin tráfico y tarda en despertar.

> Si ves un error 502 o "Application failed to respond" de forma persistente (no solo la
> primera vez), revisa los logs de Render — probablemente falta una variable de entorno o el
> `API_PORT` no coincide. Dime el error exacto y lo resolvemos.

---

## Fase 4 — Crear las tablas y el usuario admin en Supabase

Las tablas no existen todavía en la base de datos de Supabase — hay que correr las migraciones
de Prisma y el seed **desde tu PC**, apuntando temporalmente a Supabase.

1. Abre PowerShell en la carpeta del proyecto:
   ```powershell
   cd c:\Projects\cne-imbabura
   ```
2. Define la variable de entorno `DATABASE_URL` **solo para esta sesión de PowerShell** (no
   modifica ningún archivo). Usa **comillas simples** `'...'` — si tu contraseña tiene `$`,
   con comillas dobles PowerShell intenta interpretarlo como variable y falla:
   ```powershell
   $env:DATABASE_URL = 'postgresql://postgres.xxxxxxxxxxxxxxxx:TU_PASSWORD@aws-0-xx-xxxx-1.pooler.supabase.com:5432/postgres?schema=public'
   ```
   (usa el mismo `SUPABASE_DATABASE_URL` de la Fase 1.3, sin corchetes)
3. Aplica las migraciones a Supabase:
   ```powershell
   pnpm --filter @cne/api db:migrate:deploy
   ```
   Deberías ver una lista de migraciones aplicándose una por una, terminando en
   "All migrations have been successfully applied."
4. Crea los roles, cantones, recintos y el usuario admin inicial:
   ```powershell
   pnpm --filter @cne/api db:seed
   ```
5. Cierra esa ventana de PowerShell (o abre una nueva) para que `$env:DATABASE_URL` deje de
   estar definida y no interfiera con tu desarrollo local normal.

### Si ves `P1011: Error opening a TLS connection ... os error 10054`

Algunos ISP en Ecuador bloquean/cortan conexiones **TLS sobre puertos de base de datos**
(5432, 6543), aunque el puerto 443 (HTTPS normal) funcione bien. Síntoma: `Test-NetConnection`
al pooler da `TcpTestSucceeded: True`, pero Prisma corta con "An existing connection was
forcibly closed by the remote host".

**Solución:** activa los **datos móviles (hotspot) de tu celular**, conecta la PC a esa red, y
vuelve a correr el comando de la Fase 4. Es un paso único — luego puedes volver a tu wifi normal.

### Si ves `function uuid_generate_v4() does not exist`

Supabase instala la extensión `uuid-ossp` en el schema `extensions`, pero Prisma fuerza
`search_path=public` (por el `?schema=public` de la URL), así que no la encuentra. Pasa solo
la **primera vez** que migras un proyecto Supabase nuevo.

**Solución** (con `$env:DATABASE_URL` ya definido, desde `apps/api`):
```powershell
cd apps/api
'DROP EXTENSION IF EXISTS "uuid-ossp"; CREATE EXTENSION "uuid-ossp" SCHEMA public;' | Out-File -Encoding utf8 fix-ext.sql
npx prisma db execute --file fix-ext.sql --schema prisma/schema.prisma
npx prisma migrate resolve --rolled-back 20260101000000_init --schema prisma/schema.prisma
Remove-Item fix-ext.sql
cd ../..
```
Luego repite el paso 3 (`db:migrate:deploy`) y el paso 4 (`db:seed`) normalmente.

> El usuario admin creado es el de tu `apps/api/.env` actual (`ADMIN_EMAIL`,
> `ADMIN_INITIAL_PASSWORD`, etc.) — los mismos datos que usas en local, pero ahora también
> existen en la base de Supabase.

### Si olvidaste la contraseña después de cambiarla en el navegador (primer login)

**Síntoma:** Completaste el cambio de contraseña forzado (HU1-CA3) en la web y ya no recuerdas
la contraseña nueva. El login con `Admin*Inicial2026` ahora da 401.

**Ojo con "Forgot password" si configuraste `BREVO_API_KEY` real en Render:** el endpoint
`/auth/forgot-password` enviará un correo real a `ADMIN_EMAIL` (ej.
`admin@cne-imbabura.gob.ec`). Si ese dominio no existe/no recibe correo, el link de reseteo
**nunca llega** — no esperes el correo, usa el método directo de abajo.

**Solución — resetear directo en Supabase (sin necesitar conexión Prisma/hotspot):**

1. Genera el hash localmente (es solo cómputo, no toca la BD), desde `apps/api`:
   ```powershell
   cd apps/api
   node -e "require('argon2').hash('Admin*Inicial2026').then(h => console.log(h))"
   cd ../..
   ```
2. Copia el hash (`$argon2id$v=19$...`).
3. En Supabase → **SQL Editor** → "New query", pega y ejecuta (reemplaza `<hash>`):
   ```sql
   UPDATE usuarios
   SET password_hash = '<hash>', debe_cambiar_pwd = true
   WHERE email = 'admin@cne-imbabura.gob.ec';
   ```
4. Inicia sesión de nuevo con `Admin*Inicial2026` — te pedirá cambiar la contraseña otra vez.

> Esto evita por completo el problema de TLS/ISP (P1011) porque el SQL Editor de Supabase
> corre en el navegador (HTTPS 443), no necesita que tu PC se conecte directo a la base.

### Verificar en Swagger

1. Ve a `https://TU-API.onrender.com/api/docs`.
2. Busca el endpoint `POST /auth/login`, click "Try it out".
3. Body de ejemplo:
   ```json
   {
     "email": "admin@cne-imbabura.gob.ec",
     "password": "Admin*Inicial2026"
   }
   ```
   (usa los valores reales de tu `.env`, estos son solo el ejemplo de `.env.example`)
4. Click "Execute" → deberías recibir `200 OK` con `accessToken` y `refreshToken`.

Si esto funciona, **el backend en internet ya está 100% operativo**.

---

## Fase 5 — Desplegar el frontend Web en Vercel

### 5.1 Crear cuenta e importar el proyecto

1. Ve a https://vercel.com → "Sign Up" → "Continue with GitHub" → autoriza acceso al repo.
2. Click **"Add New..."** → **"Project"**.
3. Busca y selecciona `eudycss/cne-dpei` → "Import".

### 5.2 Configurar el build (monorepo)

En la pantalla de configuración del proyecto:

1. **Root Directory**: click "Edit" y selecciona `apps/web`.
2. Justo debajo aparecerá una opción tipo **"Include source files outside of the Root
   Directory in the Build Step"** — **actívala**. Es necesaria porque `apps/web` depende de
   `packages/shared-types` y `packages/shared-validation`, que están fuera de esa carpeta.
3. **Framework Preset**: debería detectar `Vite` automáticamente. Si no, selecciónalo
   manualmente.
4. **Build Command** — reemplaza el comando por defecto con:
   ```
   cd ../.. && pnpm --filter @cne/shared-types build && pnpm --filter @cne/shared-validation build && pnpm --filter @cne/web build
   ```
5. **Output Directory**: `dist` (relativo a `apps/web`, déjalo en el valor por defecto).
6. **Install Command**: déjalo en el valor por defecto (Vercel detecta `pnpm-lock.yaml` en la
   raíz y corre `pnpm install` para todo el monorepo automáticamente).

### 5.3 Variable de entorno

En la sección **"Environment Variables"**, agrega:

| Variable | Valor |
|---|---|
| `VITE_API_URL` | `https://cne-imbabura-api.onrender.com` (tu `API_URL` de la Fase 3.3, **sin** `/` al final) |

### 5.4 Deploy

1. Click **"Deploy"**. Espera 2-5 minutos.
2. Al terminar, Vercel te da una URL pública, algo como:
   ```
   https://cne-imbabura.vercel.app
   ```
   **Guarda esta URL** — la llamaremos `WEB_URL`.

> Si el build falla con un error relacionado a `@cne/shared-types` no encontrado, avísame con
> el log del error y lo ajustamos — puede que el comando de build necesite un pequeño cambio.

### Si ves `404: NOT_FOUND` al navegar o refrescar una ruta (ej. `/login`, `/change-password`)

**Síntoma:** La pantalla inicial (`/`) carga bien, pero al navegar a otra ruta de React Router
(o refrescar con F5 estando en `/login`, `/change-password`, etc.) Vercel responde con una
página de error `404: NOT_FOUND` (formato `Code: NOT_FOUND`, `ID: iadX:iadX::...`).

**Causa:** Es una SPA — todas las rutas las maneja React Router en el navegador. Vercel, por
defecto, busca un archivo estático que coincida con esa ruta y, al no encontrarlo, devuelve su
propio 404 antes de que el JS de React llegue a cargar.

**Solución:** ya está resuelto en el repo con `apps/web/vercel.json`:

```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

Si este archivo se borra o el problema reaparece en un proyecto Vercel nuevo, vuelve a crearlo
en `apps/web/vercel.json` y haz commit/push (Vercel redepliega solo).

---

## Fase 6 — Conectar el frontend con el backend (CORS)

El backend solo acepta peticiones desde los orígenes listados en `WEB_ORIGIN`. Ahora que
tenemos la URL real de Vercel, hay que actualizarla:

1. Ve a Render → tu servicio `cne-imbabura-api` → pestaña **"Environment"**.
2. Edita la variable `WEB_ORIGIN` y pon tu `WEB_URL` exacta (sin `/` al final), por ejemplo:
   ```
   https://cne-imbabura.vercel.app
   ```
   Si quieres seguir probando también desde tu localhost, puedes poner varios separados por
   coma:
   ```
   https://cne-imbabura.vercel.app,http://localhost:5173
   ```
3. Guarda — Render redepliega automáticamente con la nueva variable (1-2 minutos).

### Verificar

1. Abre `https://cne-imbabura.vercel.app` en el navegador.
2. Deberías ver la pantalla de login.
3. Inicia sesión con el usuario admin (mismas credenciales de la Fase 4).
4. Si ves un error de CORS en la consola del navegador (F12 → pestaña "Console"), revisa que
   `WEB_ORIGIN` en Render coincida **exactamente** (https, sin `/` final) con la URL que ves en
   la barra de direcciones.

Si el login funciona y entras al dashboard, **la web ya está 100% operativa en internet**.

---

## Fase 7 — App móvil: generar el APK con EAS Build

### 7.1 Crear cuenta Expo

1. Ve a https://expo.dev → "Sign Up".

### 7.2 Instalar y configurar EAS CLI

1. En PowerShell:
   ```powershell
   npm install -g eas-cli
   ```
2. Inicia sesión con la cuenta que creaste:
   ```powershell
   eas login
   ```

### 7.3 Apuntar la app a la API pública

1. Abre `apps/mobile/eas.json`. Actualmente el perfil `preview` tiene:
   ```json
   "env": {
     "EXPO_PUBLIC_API_URL": "http://192.168.137.1:3000"
   }
   ```
2. Cambia ese valor por tu `API_URL` de Render (con `https://`):
   ```json
   "env": {
     "EXPO_PUBLIC_API_URL": "https://cne-imbabura-api.onrender.com"
   }
   ```
   Avísame cuando quieras y hago este cambio yo mismo en el archivo.

### 7.4 Generar el build

1. Desde la carpeta del proyecto:
   ```powershell
   cd c:\Projects\cne-imbabura\apps\mobile
   eas build -p android --profile preview
   ```
2. Si es la primera vez, EAS te preguntará si quieres crear/vincular un proyecto Expo — acepta
   (responde "Yes"/"y" a las preguntas por defecto).
3. El build corre **en los servidores de Expo** (no en tu PC), tarda aproximadamente 10-20
   minutos. Verás una barra de progreso y un link al final.
4. El plan gratis de EAS permite un número limitado de builds de Android por mes — más que
   suficiente para pruebas.

### 7.5 Instalar el APK en un Android

1. Cuando termine, EAS te da un link (y un código QR) para descargar el `.apk`.
2. En el celular Android, abre ese link (o escanea el QR) y descarga el archivo.
3. Si Android bloquea la instalación ("No se permiten instalaciones de fuentes desconocidas"),
   ve a Ajustes → permitir instalación desde el navegador/archivos para esa app.
4. Instala y abre la app. Ahora debería conectarse a `https://cne-imbabura-api.onrender.com`
   en vez de tu red local — funciona desde cualquier red (datos móviles, otro WiFi, etc.).

---

## Fase 8 — Checklist final de verificación end-to-end

- [ ] `https://TU-API.onrender.com/api/docs` carga Swagger.
- [ ] Login desde Swagger devuelve `accessToken`.
- [ ] `https://TU-WEB.vercel.app` carga la pantalla de login.
- [ ] Login desde la web funciona sin errores de CORS en la consola.
- [ ] El dashboard web muestra datos (cantones, recintos, etc. del seed).
- [ ] El APK instalado en un Android se conecta y permite iniciar sesión como operador.
- [ ] El flujo del operador (Salida DPI, etc.) registra eventos visibles desde el monitoreo
      web.

---

## Limitaciones a tener en cuenta (plan gratis)

| Limitación | Dónde | Impacto |
|---|---|---|
| El servicio "duerme" tras ~15 min sin tráfico | Render | La primera petición después de inactividad tarda 30-50s. Normal, no es un error. |
| Disco temporal — se borra en cada redeploy/restart | Render | Fotos y PDFs subidos no persisten entre reinicios. |
| Proyecto se pausa tras 7 días sin actividad | Supabase | Si nadie usa el sistema una semana, entra al dashboard de Supabase y reanuda el proyecto manualmente. |
| Límite de builds Android por mes | EAS | De sobra para pruebas, pero no generes builds innecesarios. |

---

## Próximos pasos

Cuando este entorno de prueba funcione bien y quieras pasar al despliegue final (VPS Ubuntu +
PM2), el proceso es distinto (sin Render/Vercel/Supabase) — lo planificamos aparte cuando
llegue el momento. Esta guía no se modifica para eso, se crea una nueva.
