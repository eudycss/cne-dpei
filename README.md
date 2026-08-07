# Sistema de Gestión de Trazabilidad y Logística Electoral

**CNE — Delegación Provincial de Imbabura**

Monorepo del sistema descrito en los documentos de requisitos y arquitectura.
Cubre identidad y RBAC (HU1, HU7, HU9, HU16), catálogos (recintos, cantones,
tipos de evento), gestión de eventos electorales, kits (HU11, HU12), asignaciones
operador↔supervisor (HU10), militares, trazabilidad del día electoral con cola
offline (HU2–HU6, HU13), incidencias (HU14), alertas de anomalías (HU18) y
notificaciones in-app (HU19 parcial — sin SMTP/FCM todavía).

---

## Stack

| Capa | Tecnología |
|---|---|
| Backend | NestJS 10 + TypeScript 5, Prisma 5, validación con Zod (`@cne/shared-validation`) |
| Base de datos | PostgreSQL 16 + PostGIS 3.4 (Docker) |
| Auth | JWT (access 15m / refresh 7d) + argon2, RBAC con Guards (roles `ADMINISTRADOR`, `TECNICO_SUPERVISOR`, `OPERADOR_CDA`) |
| Web | React 18 + Vite + TanStack Query/Table, tests con Vitest + Testing Library |
| Móvil | React Native 0.74 (Expo SDK 51), cola offline, tests con Jest (`jest-expo`) |
| Compartido | `@cne/shared-types`, `@cne/shared-validation` (Zod) |
| Monorepo | pnpm workspaces |

> Aún no implementado (ver _Roadmap_): Redis/BullMQ, MinIO, Socket.IO, Nginx,
> PgBouncer, envío real de correo/push (SMTP/FCM) — las notificaciones hoy son
> in-app o se imprimen en consola.

---

## Pre-requisitos

- **Docker Desktop** (en ejecución)
- **Node.js 20+** (probado con 22)
- **pnpm 9** — si no lo tienes: `npm install -g pnpm@9`
- (Opcional, para la app móvil) un emulador Android/iOS o la app **Expo Go** en un teléfono

---

## Puesta en marcha

```bash
# 1. Variables de entorno
cp .env.example .env            # ajusta secretos/credenciales si quieres
# Genera la clave de cifrado de archivos y agrégala al .env:
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# → copia el resultado como valor de STORAGE_ENCRYPTION_KEY en .env
cp .env apps/api/.env           # Prisma CLI lee el .env junto al schema

# 2. Dependencias
pnpm install

# 3. Base de datos (Docker)
pnpm db:up                      # levanta postgres + PostGIS

# 4. Compilar paquetes compartidos (los consumen api/web/mobile)
pnpm --filter @cne/shared-types build
pnpm --filter @cne/shared-validation build

# 5. Migraciones y datos semilla
pnpm db:migrate                 # aplica la migración inicial
pnpm db:seed                    # roles + cantones + 137 recintos + admin

# 6. Levantar backend y web (en terminales separadas)
pnpm dev:api                    # http://localhost:3000  (Swagger: /api/docs)
pnpm dev:web                    # http://localhost:5173

# 7. (Opcional) app móvil
pnpm dev:mobile                 # Expo
```

### Credenciales del administrador inicial

Definidas en `.env` (`ADMIN_*`). Por defecto:

- **Email:** `admin@cne-imbabura.gob.ec`
- **Contraseña:** `Admin*Inicial2026`

Al primer login el sistema obliga a cambiarla (HU1-CA3).

---

## Estructura

```
cne-imbabura/
├── apps/
│   ├── api/         Backend NestJS: auth, users, roles, catalog, eventos, kits,
│   │                asignaciones, militares, tracking, incidencias, alertas,
│   │                notifications, storage, db (Prisma), common (RBAC/audit)
│   ├── web/         App web admin/supervisor (React + Vite), páginas por dominio
│   └── mobile/      App móvil de campo (Expo) — flujos completos de operador
│                    y supervisor, cola offline
├── packages/
│   ├── shared-types/        Interfaces TS compartidas
│   └── shared-validation/   Esquemas Zod compartidos
├── infra/postgres/  Extensiones e inicialización de la BD
├── modelo_datos.sql / seed_recintos.sql   Fuente del esquema y datos
└── docker-compose.yml
```

---

## Funcionalidades

- **Identidad (HU1, HU7, HU9, HU16)** — Login con JWT, cambio obligatorio de
  contraseña inicial, política de contraseña fuerte, refresh tokens con
  rotación, logout. Alta manual y **carga masiva** de usuarios (Excel/CSV) con
  validación fila por fila y plantilla descargable. Asignación de roles.
  Recuperación de contraseña con páginas web dedicadas (el enlace se imprime en
  consola vía `ConsoleNotifier`; SMTP real pendiente).
- **Auditoría (HU17)** — Interceptor global que registra acciones críticas en
  `bitacora_auditoria` (tabla append-only e inmutable por trigger).
- **Catálogos** — Cantones, 137 recintos, y tipos de evento editables desde el
  panel de administración.
- **Eventos electorales** — Alta/edición, activación/cierre, configuración de
  márgenes de alerta por evento.
- **Kits electorales (HU11, HU12)** — Alta y carga masiva de kits, asignación
  a recintos, generación de PDF con QR, congelamiento de asignaciones una vez
  iniciada la jornada electoral.
- **Asignaciones (HU10)** — Vínculo operador↔supervisor, carga masiva
  Excel/CSV, plantilla descargable.
- **Militares** — Alta, edición, baja y carga masiva del personal militar
  asociado a cada recinto.
- **Trazabilidad del día electoral (HU2–HU6, HU13)** — Flujo completo del
  operador de CDA (salida DPI, foto militar, validación y recepción de kit,
  llegada/salida de recinto, posiciones GPS, retorno) con cola offline en la
  app móvil; vistas de supervisor (estado de CDAs, operadores en retorno,
  llegada manual a recintos de difícil acceso, reportes de flujo).
- **Incidencias (HU14)** — Reporte con foto desde el operador, seguimiento y
  cambio de estado, comentarios, desde el panel de supervisor/admin.
- **Alertas (HU18)** — Evaluación automática de anomalías (retrasos, etc.) y
  listado para supervisores.
- **Notificaciones (HU19, parcial)** — Notificaciones in-app (web y móvil);
  sin integración SMTP/FCM todavía.

### Endpoints principales

| Método | Ruta | Rol | Dominio |
|---|---|---|---|
| POST | `/auth/login`, `/auth/refresh`, `/auth/logout` | público / autenticado | Auth |
| POST | `/auth/change-password` | autenticado | Auth (HU1-CA3) |
| POST | `/auth/forgot-password`, `/auth/reset-password` | público | Auth (HU16) |
| GET/POST/PATCH | `/users`, `/users/bulk`, `/users/:id/reset-password`, `/users/assign-roles` | admin | Users (HU7, HU9) |
| GET | `/roles` | admin/supervisor | Roles |
| GET/POST/PATCH/DELETE | `/recintos`, `/recintos/bulk`, `/cantones`, `/tipos-evento` | admin/supervisor | Catalog |
| GET/POST/PATCH | `/eventos`, `/eventos/:id/activate`, `/eventos/:id/close`, `/eventos/:id/config-alertas` | admin/supervisor | Eventos |
| GET/POST/PATCH | `/kits`, `/kits/bulk`, `/kits/:id/asignar`, `/kits/pdf-qr` | admin/supervisor | Kits (HU11, HU12) |
| GET/POST/PUT/DELETE | `/asignaciones`, `/asignaciones/bulk` | admin/supervisor | Asignaciones (HU10) |
| GET/POST/PATCH/DELETE | `/militares`, `/militares/bulk` | admin/supervisor | Militares |
| POST | `/tracking/salida-dpi`, `/tracking/recepcion-kit`, `/tracking/llegada-recinto`, `/tracking/posiciones`, `/tracking/llegada-dpi`, … | operador | Tracking (HU2–HU6) |
| GET | `/tracking/estado-cdas`, `/tracking/operadores-en-retorno`, `/tracking/reporte-flujo` | supervisor/admin | Tracking |
| POST | `/tracking/llegada-recinto-manual` | supervisor/admin | Tracking (HU13-B) |
| POST/GET | `/incidencias`, `/incidencias/mias`, `/incidencias/:id/estado` | operador / supervisor | Incidencias (HU14) |
| GET/PATCH | `/alertas`, `/alertas/:id` | supervisor/admin | Alertas (HU18) |
| GET/PATCH | `/notificaciones/mias`, `/notificaciones/:id/leida` | autenticado | Notifications |

Documentación interactiva y lista completa de endpoints: **http://localhost:3000/api/docs**

---

## Verificación

```bash
# Tests unitarios por app
pnpm --filter @cne/api test           # Jest (specs colocados por servicio)
pnpm --filter @cne/web test           # Vitest + Testing Library
pnpm --filter @cne/mobile test        # Jest (jest-expo)

# Pruebas e2e del flujo completo de identidad (requiere postgres + seed)
pnpm --filter @cne/api test:e2e

# Typecheck/builds
pnpm --filter @cne/api build
pnpm --filter @cne/web build
pnpm --filter @cne/mobile build       # tsc --noEmit
```

Flujo manual sugerido: login web con el admin → cambio de contraseña forzado →
`/users` → "Cargar Excel/CSV" (usa la plantilla) → asignar rol `OPERADOR_CDA` →
login en la app móvil con ese operador → ver pantalla de inicio por rol.

---

## Scripts útiles (raíz)

| Script | Descripción |
|---|---|
| `pnpm db:up` / `db:down` / `db:reset` | Postgres en Docker |
| `pnpm db:migrate` / `db:seed` | Migración / datos semilla |
| `pnpm dev:api` / `dev:web` / `dev:mobile` | Servidores de desarrollo |
| `pnpm build` | Build de todos los paquetes |
| `pnpm test` | Tests de todos los paquetes |

---

## Solución de problemas frecuentes

### Error de CORS al hacer login (`No 'Access-Control-Allow-Origin'`)

Vite incrementa el puerto automáticamente si el `5173` está ocupado (pasa a `5174`, `5175`, etc.). El backend NestJS lee `WEB_ORIGIN` de `apps/api/.env` para configurar CORS — si ese valor no coincide con el puerto real de Vite, el navegador bloquea la petición.

**Solución:**
1. Fíjate en qué puerto arrancó Vite (lo imprime en la terminal, ej. `➜  Local: http://localhost:5174`).
2. Actualiza `WEB_ORIGIN` en `apps/api/.env` con ese puerto.
3. Reinicia la API (`Ctrl+C` → `pnpm dev:api`).

Para evitar la deriva entre archivos, sincroniza siempre ambos `.env` después de cualquier cambio:
```bash
cp .env apps/api/.env
```

---

### Login devuelve 401 pero el usuario existe

Si el admin ya inició sesión antes y completó el cambio de contraseña obligatorio, la contraseña del seed (`Admin*Inicial2026`) ya no es válida. Para restablecerla:

```bash
# Desde apps/api — genera un nuevo hash argon2id
node -e "const a=require('argon2'); a.hash('Admin*Inicial2026').then(h=>console.log(h))"
```

Luego actualiza en la base de datos:
```sql
UPDATE usuarios
SET password_hash = '<hash_generado>', debe_cambiar_pwd = true
WHERE email = 'admin@cne-imbabura.gob.ec';
```

---

## Roadmap (pendiente)

La mayoría de los dominios funcionales (catálogos, eventos, kits, asignaciones,
militares, tracking del día electoral con GPS/cámara, incidencias, alertas,
notificaciones in-app) ya están implementados — ver _Funcionalidades_ arriba.
Lo que sigue pendiente es principalmente infraestructura y canales de entrega:

- **Notificaciones reales** — conectar SMTP y FCM (hoy: in-app + `ConsoleNotifier`
  para reset de contraseña) (HU19).
- **Tiempo real** — WebSocket/Socket.IO para tracking en vivo en el panel web
  (hoy: polling vía TanStack Query).
- **Cola de trabajos** — Redis + BullMQ para notificaciones/alertas asíncronas.
- **Almacenamiento de archivos** — MinIO u otro object storage (hoy: `storage`
  guarda archivos cifrados localmente con AES-256-GCM).
- **Dashboard y reportes (HU15)** — KPIs en tiempo real y exportes más allá de
  los reportes de `tracking` ya existentes.
- **Producción** — Nginx + TLS, PgBouncer, worker separado para jobs, hardening
  y pruebas de carga.

---

## Notas de seguridad

- Contraseñas con **argon2id**. Tokens JWT firmados; refresh persistido y revocable.
- Hoy los tokens se guardan en `localStorage` (web) y `expo-secure-store`
  (móvil). En el endurecimiento de producción el refresh token migrará a cookie
  `httpOnly` (ver `apps/web/src/lib/api.ts`).
- Archivos (fotos de incidencias/militares) cifrados en reposo con AES-256-GCM
  (`apps/api/src/storage`).
- Secretos vía variables de entorno (`.env`), nunca hardcodeados.
- Helmet, CORS restringido al origen de la web, validación estricta con Zod.
