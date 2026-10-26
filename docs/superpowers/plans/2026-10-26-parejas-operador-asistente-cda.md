# Parejas Operador + Asistente CDA — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada Operador CDA y su Asistente CDA (pareja por evento) entren a la app con su cédula y vean/operen su recinto, kits y militares con un estado compartido.

**Architecture:** Cada `OperadorCda` (grupo OPERADOR/ASISTENTE) se vincula a un `Usuario` (rol `OPERADOR_CDA`) para reusar JWT, guards y todo el tracking keyeado por `operadorId`. Un modelo nuevo `ParejaCda` por evento une operador, asistente opcional y recinto; el tracking resuelve el estado por pareja. Se entrega en 6 PRs independientes contra `probarweb`, más APK.

**Tech Stack:** NestJS + Prisma (PostgreSQL/PostGIS), Zod (`@cne/shared-validation`), React + Vite + TanStack Query, Expo 51, Jest/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-parejas-operador-asistente-cda-design.md`

## Global Constraints

- Contraseña inicial de cuentas CDA = `process.env.DEFAULT_RESET_PASSWORD ?? 'Cne2026!'` (misma fuente que `users.service.ts:157`), con `debeCambiarPwd = true`. Nunca se escribe la contraseña en logs ni respuestas.
- Login por **cédula o correo** en el mismo campo; los administrativos siguen con correo.
- Aplica **a partir del próximo evento**: nada de lo nuevo modifica kits, tracking ni asignaciones del evento ACTIVO actual.
- Una pareja por evento; un recinto con máximo una pareja por evento.
- Validación con Zod de `@cne/shared-validation`; tras tocar `packages/shared-*` recompilar ambos (`pnpm --filter @cne/shared-types build && pnpm --filter @cne/shared-validation build`).
- Tras tocar `schema.prisma`: migración + `pnpm --filter @cne/api db:generate`. Migraciones en producción y `git push` solo con confirmación del usuario.
- Pruebas unitarias en cada tarea; al cerrar cada PR, revisión con el subagente `revisor-calidad`.
- Textos de UI en español; mensajes de error de login genéricos ("Credenciales inválidas"), sin revelar si la cédula existe.

## Review Focus

1. Cédula con espacios o guiones pegados (`"100 123 4567"`, `" 1001234567 "`) → se normaliza a 10 dígitos y entra igual. (Test en Task 1.1.)
2. APK vieja que sigue enviando `{ email, password }` → debe seguir funcionando para administrativos. (Test en Task 1.1 y 1.2.)
3. Login offline tras haber entrado online con cédula → debe aceptar la misma cédula sin red. (Test en Task 1.4.)
4. Correo escrito con mayúsculas → hoy `findUnique({ email })` es sensible a mayúsculas; mantener el comportamiento actual (no regresión). (Test en Task 1.2.)
5. Usuario desactivado que intenta entrar por cédula → "Credenciales inválidas", igual que por correo. (Test en Task 1.2.)

---

## Hoja de ruta por PR

Cada PR se planifica en detalle al empezarlo (depende de las interfaces del anterior). Este documento detalla el **PR 1**.

| PR | Contenido | Esquema |
|----|-----------|---------|
| **1** | Login por cédula o correo (API, web, móvil, offline) | No |
| 2 | `Usuario.email` opcional; `OperadorCda.usuarioId` único; crear/reutilizar cuenta al registrar/importar OPERADOR o ASISTENTE (si la cédula ya existe en `Usuario`, vincular y resetear contraseña); desactivar cuentas `OPERADOR_CDA` sin vínculo (acción manual de admin, no automática); indicador web "aún no cambió la contraseña" | Sí |
| 3 | Modelo `ParejaCda` (eventoId, operadorCdaId, asistenteCdaId?, recintoId, asistenteHabilitado, fuenteGpsUsuarioId?) con uniques (evento+operador), (evento+asistente), (evento+recinto); CRUD web manual; import Excel con plantilla (crea Operadores CDA faltantes); al asignar recinto, kits del recinto/evento → `operadorId` = usuario del operador | Sí |
| 4 | Tracking compartido por pareja: `miAsignacion`, `validarKit`, recepción y marcas resuelven por pareja; asistente no habilitado = solo lectura (403 en escrituras); duplicado del mismo paso → vale el primero por `ocurridoEn`, el segundo se ignora y va a bitácora; alertas una vez por pareja, notificadas a ambos | No |
| 5 | Fuente GPS: primera posición aceptada fija la fuente; posiciones de otro integrante se descartan; web para habilitar asistente y cambiar fuente GPS (Técnico Supervisor y Administrador); reemplazo de integrante libera la fuente si era él | Posible |
| 6 | APK: pantalla de pareja, rol asistente (solo lectura vs habilitado), compilar y probar en celular real | No |

---

## PR 1 — Login por cédula o correo

Rama: `feat/parejas-cda` (ya creada desde `origin/probarweb`, contiene el commit del diseño).

### Task 1.1: Esquema `loginSchema` acepta cédula o correo

**Files:**
- Modify: `packages/shared-validation/src/index.ts` (`loginSchema`, ~línea 90)
- Test: `packages/shared-validation/src/index.test.ts` (o el spec existente del paquete; si no hay, crear `login-schema.test.ts` junto a `index.ts`)

**Interfaces:**
- Produces: `loginSchema` → `{ usuario: string; password: string }`, donde `usuario` es una cédula normalizada (10 dígitos) o un correo. `export type LoginInput = z.infer<typeof loginSchema>`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('loginSchema', () => {
  it('acepta cédula válida', () => {
    expect(loginSchema.parse({ usuario: '1001234567', password: 'x' }).usuario).toBe('1001234567');
  });
  it('normaliza espacios y guiones en la cédula', () => {
    expect(loginSchema.parse({ usuario: ' 100 123-4567 ', password: 'x' }).usuario).toBe('1001234567');
  });
  it('acepta correo', () => {
    expect(loginSchema.parse({ usuario: 'admin@cne-imbabura.gob.ec', password: 'x' }).usuario)
      .toBe('admin@cne-imbabura.gob.ec');
  });
  it('acepta el campo legado email (APK viejas)', () => {
    expect(loginSchema.parse({ email: 'admin@cne-imbabura.gob.ec', password: 'x' }).usuario)
      .toBe('admin@cne-imbabura.gob.ec');
  });
  it('rechaza algo que no es cédula ni correo', () => {
    expect(loginSchema.safeParse({ usuario: 'abc', password: 'x' }).success).toBe(false);
  });
  it('rechaza cédula con dígito verificador inválido', () => {
    expect(loginSchema.safeParse({ usuario: '1234567890', password: 'x' }).success).toBe(false);
  });
});
```

Usar en los tests cédulas que pasen `isValidCedulaEcuatoriana` (ajustar `1001234567` a una válida si no lo es).

- [ ] **Step 2: Run** `pnpm --filter @cne/shared-validation test` → FAIL.
- [ ] **Step 3: Implement** con `z.preprocess` que copie `email` → `usuario` si falta `usuario`, quite espacios/guiones solo si el valor no contiene `@`, y luego `z.union([cedulaSchema, emailSchema])` con mensaje "Ingrese su cédula o correo".
- [ ] **Step 4: Run** tests → PASS; recompilar ambos paquetes compartidos.
- [ ] **Step 5: Commit** `feat(auth): loginSchema acepta cédula o correo`.

### Task 1.2: `AuthService.login` busca por cédula o correo

**Files:**
- Modify: `apps/api/src/auth/auth.service.ts:30` (`login`)
- Modify: `apps/api/src/auth/auth.controller.ts:29-46` (body `usuario`, Swagger)
- Modify: `packages/shared-types/src/index.ts:32` (`LoginResponse.user` agrega `cedula: string`)
- Test: `apps/api/src/auth/auth.service.spec.ts`

**Interfaces:**
- Consumes: `LoginInput` (Task 1.1).
- Produces: `AuthService.login(usuario: string, password: string): Promise<LoginResponse>`; `LoginResponse.user.cedula`.

- [ ] **Step 1: Failing tests** en `describe('login')`:
  - `'entra con cédula'` → `prisma.usuario.findUnique` llamado con `{ where: { cedula: '1001234567' }, ... }` y devuelve tokens con `user.cedula`.
  - `'entra con correo'` → `findUnique` con `{ where: { email } }` (sin cambiar mayúsculas).
  - `'usuario inactivo por cédula → UnauthorizedException("Credenciales inválidas")'`.
  - `'contraseña errónea por cédula → UnauthorizedException("Credenciales inválidas")'`.
- [ ] **Step 2: Run** `pnpm --filter @cne/api test -- auth.service.spec.ts` → FAIL.
- [ ] **Step 3: Implement**: `const where = usuario.includes('@') ? { email: usuario } : { cedula: usuario }`; agregar `cedula: user.cedula` a `user` de la respuesta. Controller: `@Body(new ZodValidationPipe(loginSchema)) body: LoginInput` → `this.auth.login(body.usuario, body.password)`; Swagger con propiedad `usuario` (ejemplo cédula y correo).
- [ ] **Step 4: Run** tests de auth + `pnpm --filter @cne/api test` completo → PASS (actualizar specs/e2e que envían `{ email }` solo si fallan; el legado debe seguir aceptado).
- [ ] **Step 5: Commit** `feat(auth): login por cédula o correo`.

### Task 1.3: Login web con campo "Cédula o correo"

**Files:**
- Modify: `apps/web/src/pages/Login.tsx:8-50`
- Modify: `apps/web/src/auth/AuthContext.tsx:24,45-48` (`login(usuario, password)` envía `{ usuario, password }`; `SessionUser` agrega `cedula`)
- Test: `apps/web/src/pages/Login.test.tsx`

- [ ] **Step 1: Failing tests**: el campo tiene label accesible "Cédula o correo" (`getByLabelText`), `type="text"`, `autoComplete="username"`; enviar `1001234567` hace POST `/auth/login` con `{ usuario: '1001234567', password }`; el test existente con correo sigue pasando (seleccionar por label, no por `input[type="email"]`).
- [ ] **Step 2: Run** `pnpm --filter @cne/web test -- Login.test.tsx` → FAIL.
- [ ] **Step 3: Implement**: renombrar estado a `usuario`, `<label htmlFor="login-usuario">Cédula o correo</label>` con `id` en el input, `inputMode="text"`.
- [ ] **Step 4: Run** tests web → PASS.
- [ ] **Step 5: Commit** `feat(web): login con cédula o correo`.

### Task 1.4: Login móvil online y offline con cédula

**Files:**
- Modify: `apps/mobile/src/screens/LoginScreen.tsx:28-100` (label "Cédula o correo", `keyboardType="default"`, `autoComplete="username"`, `autoCapitalize="none"`, textos de error con "cédula o correo")
- Modify: `apps/mobile/src/auth/AuthContext.tsx:21,35-36,74-101` (`login(usuario, password)` envía `{ usuario, password }`; `SessionUser.cedula`)
- Modify: `apps/mobile/src/lib/offlineAuth.ts` (verificador guarda `cedula` y `email`; `verificarLoginOffline(usuario, password)` acepta coincidencia con cualquiera de los dos)
- Test: `apps/mobile/src/lib/offlineAuth.test.ts`, `apps/mobile/src/screens/LoginScreen.test.tsx`

**Interfaces:**
- Produces: `verificarLoginOffline(usuario: string, password: string): Promise<ResultadoLoginOffline>`; `SessionUserSnapshot.cedula: string`.

- [ ] **Step 1: Failing tests** (offlineAuth):
  - `'acepta la cédula tras un login online'` → guardar con `{ cedula: '1001234567', email: 'a@b.ec', ... }`, verificar con `' 1001234567 '` → `ok: true`.
  - `'sigue aceptando el correo'` → `'A@B.ec'` → `ok: true`.
  - `'verificador viejo sin cedula sigue funcionando por correo'` (JSON guardado sin `cedula`).
  - `'cédula de otra persona → invalido'`.
  LoginScreen: el campo tiene `accessibilityLabel="Cédula o correo"` y `login` recibe lo escrito.
- [ ] **Step 2: Run** `pnpm --filter @cne/mobile test -- offlineAuth LoginScreen` → FAIL.
- [ ] **Step 3: Implement**: normalizar entrada (`trim`, minúsculas si contiene `@`, quitar espacios/guiones si no); comparar con `verificador.email` o `verificador.cedula`.
- [ ] **Step 4: Run** tests móviles completos → PASS.
- [ ] **Step 5: Commit** `feat(mobile): login online y offline con cédula o correo`.

### Task 1.5: Cierre del PR 1

- [ ] `pnpm test` en la raíz → todo verde (reportar salida real si algo falla).
- [ ] Invocar `revisor-calidad` sobre el diff del PR; corregir hallazgos con commits aparte.
- [ ] Pedir confirmación al usuario antes de `git push` y de abrir el PR contra `probarweb` (el hook pre-push crea `deploy/*`; mergear a mano).
