# Sistema de Gestión de Trazabilidad y Logística Electoral

**CNE — Delegación Provincial de Imbabura**

Monorepo del sistema descrito en los documentos de requisitos y arquitectura. Esta
es la **Fase 1: Scaffold + base de identidad** (HU1 inicio de sesión, HU7 carga de
usuarios, HU9 asignación de roles), construida por capas y verificada end-to-end.

---

## Stack (Fase 1)

| Capa | Tecnología |
|---|---|
| Backend | NestJS 10 + TypeScript 5, Prisma 5 |
| Base de datos | PostgreSQL 16 + PostGIS 3.4 (Docker) |
| Auth | JWT (access 15m / refresh 7d) + argon2, RBAC con Guards |
| Web | React 18 + Vite + TanStack Query/Table |
| Móvil | React Native 0.74 (Expo SDK 51) — skeleton |
| Compartido | `@cne/shared-types`, `@cne/shared-validation` (Zod) |
| Monorepo | pnpm workspaces |

> Diferidos a fases posteriores (con abstracciones ya preparadas): Redis/BullMQ,
> MinIO, Socket.IO, Nginx, PgBouncer, FCM/SMTP. Ver la sección _Roadmap_.

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
│   ├── api/         Backend NestJS (auth, users, roles, audit) + Prisma
│   ├── web/         App web admin/supervisor (React + Vite)
│   └── mobile/      App móvil de campo (Expo) — login skeleton
├── packages/
│   ├── shared-types/        Interfaces TS compartidas
│   └── shared-validation/   Esquemas Zod compartidos
├── infra/postgres/  Extensiones e inicialización de la BD
├── modelo_datos.sql / seed_recintos.sql   Fuente del esquema y datos
└── docker-compose.yml
```

---

## Funcionalidades de la Fase 1

- **HU1** — Login con JWT, cambio obligatorio de contraseña inicial, política de
  contraseña fuerte, refresh tokens con rotación, logout.
- **HU7** — Alta manual de usuarios y **carga masiva** desde Excel (`.xlsx`) o
  CSV, con validación fila por fila y reporte de errores. Plantilla descargable.
- **HU9** — Asignación de roles a uno o varios usuarios.
- **HU16 (parcial)** — Endpoints de recuperación de contraseña (el enlace se
  imprime en consola vía `ConsoleNotifier`; se conectará SMTP en fase posterior).
- **HU17 (base)** — Interceptor global que registra acciones críticas
  (login, logout, cambios de contraseña, alta/edición de usuarios, carga masiva,
  asignación de roles) en `bitacora_auditoria` (tabla append-only e inmutable por trigger).

### Endpoints principales

| Método | Ruta | Rol | HU |
|---|---|---|---|
| POST | `/auth/login` | público | HU1 |
| POST | `/auth/refresh` | público | HU1 |
| POST | `/auth/change-password` | autenticado | HU1-CA3 |
| POST | `/auth/forgot-password` `/auth/reset-password` | público | HU16 |
| GET | `/users` | admin/supervisor | HU7 |
| POST | `/users` | admin | HU7-CA2 |
| POST | `/users/bulk` | admin | HU7-CA1 |
| GET | `/users/template.xlsx` | admin | HU7 |
| POST | `/users/assign-roles` | admin | HU9 |
| GET | `/roles` | admin/supervisor | HU9 |

Documentación interactiva: **http://localhost:3000/api/docs**

---

## Verificación

```bash
# Pruebas e2e del flujo completo de identidad (requiere postgres + seed)
pnpm --filter @cne/api test:e2e

# Typecheck/builds
pnpm --filter @cne/api build
pnpm --filter @cne/web build
pnpm --filter @cne/mobile build
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

## Roadmap (fases siguientes)

- **F2** Catálogos y eventos: militares (HU8), eventos electorales (HU20).
- **F3** Kits y asignaciones: QR + PDF (HU11), asignaciones (HU10, HU12).
- **F4** Día electoral: tracking (HU2–HU6), WebSocket en tiempo real, MinIO, GPS y
  cámara en móvil, Redis.
- **F5** Offline + incidencias: sincronización (HU13), incidencias (HU14).
- **F6** Notificaciones y alertas: BullMQ + FCM + SMTP (HU19), alertas (HU18).
- **F7** Dashboard y reportes: KPIs en tiempo real (HU15), exportes, bitácora (HU17).
- **F8** Producción: Nginx + TLS, PgBouncer, worker separado, hardening, pruebas de carga.

---

## Notas de seguridad (Fase 1)

- Contraseñas con **argon2id**. Tokens JWT firmados; refresh persistido y revocable.
- En Fase 1 los tokens se guardan en `localStorage` (web) y `expo-secure-store`
  (móvil). En el endurecimiento de producción el refresh token migrará a cookie
  `httpOnly` (ver `apps/web/src/lib/api.ts`).
- Secretos vía variables de entorno (`.env`), nunca hardcodeados.
- Helmet, CORS restringido al origen de la web, validación estricta con Zod.
