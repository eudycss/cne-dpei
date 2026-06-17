# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Electoral logistics traceability system for CNE Imbabura (Ecuador). Phase 1 monorepo with three clients and two shared packages.

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
pnpm --filter @cne/api test:e2e      # API end-to-end tests (supertest)

# Production builds
pnpm --filter @cne/api build
pnpm --filter @cne/web build

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

Domain-driven modular structure. Each domain folder under `apps/api/src/` follows the pattern: `module`, `controller`, `service`, `dto`, `entities`. Current domains: `auth`, `users`, `roles`, `catalog`, `eventos`, `kits`, `asignaciones`, `militares`, `common`.

**Authentication flow:** JWT access tokens (15 min) + refresh tokens (7 days) with rotation. Passwords are hashed with argon2id. First-login forced password change is enforced by the `MustChangePasswordGuard`. RBAC is implemented via `@Roles()` decorator + `RolesGuard`.

**Roles:** `ADMIN`, `SUPERVISOR`, `OPERADOR_CDA`.

**Audit logging:** A global interceptor writes to `bitacora_auditoria`, which has an immutable trigger — rows cannot be updated or deleted.

**Swagger:** Auto-generated and available at `http://localhost:3000/api/docs` in development.

### Database

PostgreSQL 16 + PostGIS 3.4, managed via Prisma ORM. Schema source of truth is `apps/api/prisma/schema.prisma`. The `modelo_datos.sql` file is for reference only (not run directly). Migrations live in `apps/api/prisma/migrations/`.

### Web Frontend

React 18 + Vite. Server state managed with **TanStack Query** (not Redux/Zustand). Complex tables use **TanStack Table**. Routing via React Router v6.

### Mobile

Expo SDK 51 (React Native 0.74). Tokens stored in `expo-secure-store` (never `AsyncStorage`). Currently skeleton — login is functional; other screens are in progress.

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
