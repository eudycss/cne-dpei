# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Electoral logistics traceability system for CNE Imbabura (Ecuador). pnpm monorepo with three clients (API, web, mobile) and two shared packages. The README describes a "Fase 1" (auth/users/roles) scope, but the codebase has since grown well past that — domains for catalog, eventos, kits, asignaciones, militares, tracking, incidencias, alertas, and notifications are all implemented (see API domains below). Treat the README's phase/roadmap claims as historical, not current.

## Commands

```bash
# Install all dependencies (run from root)
pnpm install

# Database lifecycle
pnpm db:up          # Start PostgreSQL 16 + PostGIS Docker container
pnpm db:down        # Stop database
pnpm db:reset       # Drop and recreate database
pnpm db:migrate     # Run Prisma migrations
pnpm db:seed        # Seed roles, cantons, 137 precincts, and initial admin

# Build shared packages (required before running apps for the first time)
pnpm --filter @cne/shared-types build
pnpm --filter @cne/shared-validation build

# Development servers
pnpm dev:api        # NestJS backend → http://localhost:3000, Swagger → /api/docs
pnpm dev:web        # Vite React frontend → http://localhost:5173
pnpm dev:mobile     # Expo mobile app

# Testing
pnpm --filter @cne/api test          # API unit tests (Jest)
pnpm --filter @cne/api test:e2e      # API end-to-end tests (supertest, needs Postgres + seed)
pnpm --filter @cne/web test          # Web unit tests (Vitest, single run)
pnpm --filter @cne/web test:watch    # Web unit tests (Vitest, watch mode)
pnpm --filter @cne/mobile test       # Mobile unit tests (Jest via jest-expo)
pnpm test                            # All packages (pnpm -r test)

# Run a single test file (Jest projects: api, mobile)
pnpm --filter @cne/api test -- users.service.spec.ts
pnpm --filter @cne/mobile test -- geo.test.ts

# Production builds
pnpm --filter @cne/api build
pnpm --filter @cne/web build
pnpm --filter @cne/mobile build      # tsc --noEmit (typecheck only, no bundle)

# Prisma utilities (run from apps/api)
pnpm --filter @cne/api db:studio     # Open Prisma Studio
pnpm --filter @cne/api db:generate   # Regenerate Prisma client after schema changes
```

## Environment Setup

```bash
cp .env.example .env
cp .env apps/api/.env
```

Key `.env` variables: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `WEB_ORIGIN`, and initial admin credentials (`ADMIN_EMAIL`, `ADMIN_CEDULA`, `ADMIN_PASSWORD`, etc.).

## Architecture

### Monorepo Layout

| Path | Purpose |
|------|---------|
| `apps/api` | NestJS backend (sole source of truth for business logic) |
| `apps/web` | React + Vite admin/supervisor UI |
| `apps/mobile` | React Native + Expo 51 field operator app |
| `packages/shared-types` | TypeScript interfaces shared across all apps |
| `packages/shared-validation` | Zod schemas shared across all apps |
| `infra/postgres` | PostgreSQL init SQL (uuid-ossp + postgis extensions) |

All packages live under the `@cne/*` npm namespace. The shared packages must be built with `tsup` before the apps can import them.

### API (NestJS)

Domain-driven modular structure. Each domain folder under `apps/api/src/` follows the pattern: `module`, `controller`, `service`, with `*.service.spec.ts` unit tests colocated. Domains: `auth`, `users`, `roles`, `catalog` (cantones/recintos/tipos de evento), `eventos`, `kits`, `asignaciones`, `militares`, `tracking` (GPS/eventos de trazabilidad electoral), `incidencias`, `alertas`, `notifications`, `storage` (encrypted file storage), `db` (Prisma module/service), `common` (shared guards, decorators, interceptors, pipes).

**Authentication flow:** JWT access tokens (15 min) + refresh tokens (7 days) with rotation. Passwords are hashed with argon2id. First-login forced password change is enforced by a guard. RBAC is implemented via `@Roles()` decorator + `RolesGuard` (in `common/`).

**Roles:** `ADMINISTRADOR`, `TECNICO_SUPERVISOR`, `OPERADOR_CDA` (checked via `@Roles(...)` per endpoint — not `ADMIN`/`SUPERVISOR`, a naming mismatch worth double-checking if you see those shorter forms elsewhere).

**Request validation:** `common/zod-body.pipe.ts` + `common/zod-validation.filter.ts` validate request bodies against the Zod schemas from `@cne/shared-validation`, not `class-validator` DTOs (those packages are present as deps but validation is Zod-driven).

**Audit logging:** A global interceptor (`common/audit.interceptor.ts`) writes to `bitacora_auditoria`, which has an immutable trigger — rows cannot be updated or deleted.

**Notifications:** `auth/notifier.ts` currently uses a console-based notifier (prints reset links to stdout) — no SMTP/FCM wired up yet.

**Swagger:** Auto-generated and available at `http://localhost:3000/api/docs` in development.

### Database

PostgreSQL 16 + PostGIS 3.4, managed via Prisma ORM. Schema source of truth is `apps/api/prisma/schema.prisma`. The `modelo_datos.sql` file is for reference only (not run directly). Migrations live in `apps/api/prisma/migrations/`.

### Web Frontend

React 18 + Vite. Server state managed with **TanStack Query** (not Redux/Zustand). Complex tables use **TanStack Table**. Routing via React Router v6. `apps/web/src/pages/` is organized by domain (one folder per API domain: `eventos`, `kits`, `asignaciones`, `militares`, `recintos`, `alertas`, `incidencias`, etc.), each with its own `*.test.tsx` files colocated (Vitest + Testing Library). `apps/web/src/lib/queries/` holds TanStack Query hooks per domain.

### Mobile

Expo SDK 51 (React Native 0.74). Tokens stored in `expo-secure-store` (**never** `AsyncStorage`). `apps/mobile/src/lib/` has the API client, geolocation, push notifications, and an offline request queue (`offline-queue.ts`) with colocated `*.test.ts` Jest specs. `apps/mobile/src/screens/` holds one screen per field-operator flow (llegada/salida de DPI y recinto, tránsito, retorno, kits verificados, incidencias, alertas, monitoreo for supervisors). Login and the core field-operator flows are functional; treat screens not listed here as in progress.

For building the Android APK locally (Gradle, no EAS), see `apps/mobile/README.md`.

### Shared Packages

`@cne/shared-types`: TypeScript `interface` / `type` definitions only (no runtime code).  
`@cne/shared-validation`: Zod schemas that can be used for both API DTO validation and frontend form validation.

Changes to either shared package require rebuilding them (`pnpm --filter @cne/<pkg> build`) before the consuming apps will pick them up.

## Rules for Claude

### Scope
- Only modify files directly related to the requested task. Do not refactor, clean up, or "improve" surrounding code unless explicitly asked.
- One task at a time. Do not combine multiple changes in a single response unless the user groups them explicitly.
- For complex changes (new domain, schema change, multi-file feature), propose a plan and wait for approval before writing any code.

### Code quality
- Always apply clean code principles: avoid spaghetti code, keep functions/components simple and readable.
- Before writing new code, check if an existing pattern, function, or component can be reused instead of duplicating logic.

### Mandatory steps after certain changes
- **Modified `packages/shared-types` or `packages/shared-validation`** → always rebuild both:
  ```bash
  pnpm --filter @cne/shared-types build
  pnpm --filter @cne/shared-validation build
  ```
- **Modified `apps/api/prisma/schema.prisma`** → always run `pnpm --filter @cne/api db:generate` after migrating.
- **Modified `.env`** → always sync to `apps/api/.env`:
  ```bash
  cp .env apps/api/.env
  ```

### Environment notes
- `WEB_ORIGIN` must match the exact port Vite is using (default 5173, but Vite increments if the port is taken).
- `STORAGE_ENCRYPTION_KEY` must be a 64-character hex string. Generate with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```

### Troubleshooting

**CORS error on login (`No 'Access-Control-Allow-Origin'`)**
`apps/api/.env` and the root `.env` can drift. NestJS reads `apps/api/.env`, so if Vite started on a different port, CORS will block the browser. Fix:
1. Check which port Vite actually started on (it prints it in the terminal).
2. Update `WEB_ORIGIN` in `apps/api/.env` to match.
3. Restart the API (`pnpm dev:api`).
Always keep both `.env` files in sync — run `cp .env apps/api/.env` after any change to the root `.env`.

**Login returns 401 but the user exists in the database**
If `debe_cambiar_pwd = false` in the `usuarios` table, the initial password was already changed in a prior session. To reset it back to the seed value, run from `apps/api`:
```bash
node -e "
const argon2 = require('argon2');
argon2.hash(process.env.ADMIN_INITIAL_PASSWORD ?? 'Admin*Inicial2026').then(h => console.log(h));
"
```
Then update the hash directly in the DB:
```sql
UPDATE usuarios
SET password_hash = '<hash>', debe_cambiar_pwd = true
WHERE email = 'admin@cne-imbabura.gob.ec';
```
