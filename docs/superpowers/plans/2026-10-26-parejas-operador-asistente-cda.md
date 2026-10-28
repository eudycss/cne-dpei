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

---

## PR 2 — Cuentas de la app para Operadores y Asistentes CDA

Detallado el 2026-10-28. PR 1 = #120 (en producción).

### Decisiones del usuario (2026-10-28)
- **Cuentas viejas con cédula coincidente (68):** se vinculan y **conservan su contraseña** (no se resetea).
- **Asistente CDA que ya es Administrador:** su misma cuenta recibe además el rol `OPERADOR_CDA`.
- **Personas sin cuenta (~51):** se crean con un **botón de la web** ("Crear y vincular cuentas", solo Administrador); las altas manuales e importaciones nuevas crean su cuenta automáticamente.
- **Bloqueo por intentos:** 5 contraseñas erróneas seguidas → cuenta bloqueada 15 min (mismo mensaje genérico); un Administrador puede desbloquear.
- **Desactivar en Operadores CDA** → la cuenta de la app se desactiva también; al reactivar, vuelve.
- **Cambio de Operador/Asistente a otro cargo CDA** → se quita el rol `OPERADOR_CDA` y se cierran sus sesiones; si vuelve, se devuelve.

### Decisiones de Claude (revisables)
- El vínculo de las 68 cuentas lo hace el mismo botón (no una migración de datos): el efecto es igual y queda probado con tests.
- Al quitar la cuenta (desactivar o cambiar de cargo) **solo se desactiva la cuenta si `OPERADOR_CDA` era su único rol**; si tiene otros (el caso del Administrador), solo se le quita ese rol. Así nunca se deja sin acceso a un Administrador.
- Si la cuenta vinculada estaba inactiva y la persona está activa en Operadores CDA, se reactiva.
- `apellidosNombres` → `apellidos` = dos primeras palabras, `nombres` = el resto (con 2 palabras: 1 y 1; con 1: apellidos = esa, nombres = "-"). Se puede corregir en Usuarios.
- Al quitar rol o desactivar se revocan sus refresh tokens (el access token muere en ≤15 min).
- Las 10 cuentas `OPERADOR_CDA` sin persona en Operadores CDA se desactivan con un segundo botón ("Desactivar cuentas sin vínculo"), con confirmación; solo las que tienen `OPERADOR_CDA` como único rol.

### Review Focus (PR 2)
1. Administrador que además es Asistente CDA y se le desactiva en CDA → sigue entrando como Administrador. (Task 2.3)
2. Cuenta sin correo en la web (Usuarios, menú de usuario, editar usuario) → muestra la cédula y guardar no falla. (Task 2.1 / 2.6)
3. "Olvidé mi contraseña" con una cuenta sin correo → respuesta genérica, sin error. (Task 2.1)
4. Usuario bloqueado que acierta la contraseña → sigue con "Credenciales inválidas" y no reinicia el contador; al vencer los 15 min entra. (Task 2.2)
5. Pulsar "Crear y vincular" dos veces o a la vez → no duplica cuentas ni falla por índice único. (Task 2.3)

### Task 2.1: Esquema, migración y `email` opcional
**Files:** `apps/api/prisma/schema.prisma`, nueva migración, `packages/shared-types`, `auth/*`, `users/*`, `apps/web` (Layout, Usuarios), `apps/mobile/src/lib/offlineAuth.ts`.
- `Usuario.email String? @unique`; `Usuario.intentosFallidos Int @default(0) @map("intentos_fallidos")`; `Usuario.bloqueadoHasta DateTime? @map("bloqueado_hasta") @db.Timestamptz(6)`.
- `OperadorCda.usuarioId String? @unique @map("usuario_id") @db.Uuid` con relación a `Usuario` (`onDelete: SetNull`).
- Tipos: `email: string | null` en `UserDto`, `LoginResponse.user`, `JwtPayload`, `CurrentUser`. Notifier: no envía si no hay correo. `forgotPassword` sigue buscando por correo (sin cambios de respuesta).
- Web: menú de usuario y tabla de Usuarios muestran la cédula cuando no hay correo. Móvil: el verificador offline acepta `email` nulo.
- Tests: `forgotPassword` con usuario sin correo no notifica; `UsersList` muestra la cédula sin correo; `offlineAuth` guarda y valida sesión sin correo.

### Task 2.2: Bloqueo por intentos fallidos
**Files:** `auth/auth.service.ts` (+spec), `users/users.controller.ts`, `users/users.service.ts` (+spec), web Usuarios.
- Constantes `MAX_INTENTOS_LOGIN = 5`, `BLOQUEO_LOGIN_MS = 15 * 60_000`.
- En `login`: `argon2.verify` siempre se ejecuta (se mantiene el hash señuelo). Si `bloqueadoHasta > ahora` → 401 genérico sin tocar el contador. Fallo → `intentosFallidos` con `increment` atómico; al llegar a 5 → `bloqueadoHasta = ahora + 15 min` e `intentosFallidos = 0`. Éxito → ambos a 0/null.
- `POST /users/:id/desbloquear` (ADMINISTRADOR). `resetPassword` también desbloquea. `UserDto.bloqueadoHasta`.
- Web Usuarios: insignia "Bloqueada hasta HH:MM" y botón "Desbloquear".
- Tests: 5.º fallo bloquea; bloqueado + contraseña correcta → 401 y `verify` llamado; bloqueo vencido → entra y reinicia; éxito reinicia contador; desbloquear limpia ambos campos.

### Task 2.3: `CuentasCdaService`
**Files:** `operadores-cda/cuentas-cda.service.ts` (+spec), `operadores-cda/nombre-cda.ts` (+spec).
- `asegurarCuenta(tx, operadorId)`: si ya tiene `usuarioId` → reactiva y garantiza rol; si existe `Usuario` con su cédula → vincula, agrega `OPERADOR_CDA`, reactiva si hace falta, **no toca la contraseña**; si no → crea `Usuario` (cédula, sin correo, nombres/apellidos partidos, teléfono, hash de `DEFAULT_RESET_PASSWORD ?? 'Cne2026!'`, `debeCambiarPwd: true`) con rol `OPERADOR_CDA` y lo vincula. Choque P2002 concurrente → reintenta leyendo el existente.
- `retirarCuenta(tx, operadorId)`: quita `OPERADOR_CDA`; si era su único rol → `activo: false`; revoca refresh tokens. Sin vínculo → no hace nada.
- `sincronizar()`: `asegurarCuenta` a cada OPERADOR/ASISTENTE activo sin cuenta → `{ vinculadas, creadas }`.
- `resumen()`: `{ conCuenta, sinCuenta, pendientesCambioPwd, bloqueadas, cuentasSinVinculo }`.
- `desactivarSinVinculo()`: cuentas activas cuyo único rol es `OPERADOR_CDA` y sin `OperadorCda` vinculado → inactivas + refresh revocados → `{ desactivadas }`.
- `partirNombre("CABASCANGO PEREZ JUAN SEBASTIAN")` → `{ apellidos: "CABASCANGO PEREZ", nombres: "JUAN SEBASTIAN" }`; 2 palabras, 1 palabra y espacios repetidos con test.
- Tests clave: cuenta vieja coincidente conserva `passwordHash`; Administrador recibe rol y conserva los suyos; `retirarCuenta` con dos roles no desactiva; creación usa `debeCambiarPwd: true` y nunca devuelve la contraseña.

### Task 2.4: Enganchar el ciclo de vida en `OperadoresCdaService`
- `crear` (grupo OPERADOR/ASISTENTE) → `asegurarCuenta` en la misma transacción.
- `importar(aplicar)` → transacción interactiva; `asegurarCuenta` por cada fila OPERADOR/ASISTENTE (activa).
- `cambiarActivo(false)` → `retirarCuenta`; `cambiarActivo(true)` → `asegurarCuenta`.
- `cambiarCargo`: de OPERADOR/ASISTENTE a otro → `retirarCuenta`; de otro a OPERADOR/ASISTENTE → `asegurarCuenta`; entre OPERADOR y ASISTENTE → sin cambios.
- DTO `OperadorCda.cuenta: 'SIN_CUENTA' | 'PENDIENTE_CAMBIO' | 'ACTIVA' | 'BLOQUEADA' | 'INACTIVA'`.
- Tests por cada transición.

### Task 2.5: Endpoints
- `GET /operadores-cda/cuentas/resumen`, `POST /operadores-cda/cuentas/sincronizar`, `POST /operadores-cda/cuentas/desactivar-sin-vinculo` — solo ADMINISTRADOR, auditados por el interceptor global. Swagger.

### Task 2.6: Web
- Operadores CDA (pestañas Operadores y Asistentes): columna "Cuenta app" con insignia (Sin cuenta / Debe cambiar contraseña / Activa / Bloqueada / Inactiva) y filtro.
- Panel "Cuentas de la app" (solo Administrador): conteos del resumen, botón "Crear y vincular cuentas" (confirmación que indica la contraseña inicial y que se cambia al primer ingreso) y "Desactivar cuentas sin vínculo" (confirmación con el número). Mensajes con `role="status"`/`role="alert"`. Estilo Figma existente.
- Tests de insignias, confirmaciones y que un Técnico Supervisor no ve el panel.

### Task 2.7: Cierre del PR 2
- Suites completas + tsc de API, web, móvil y shared; `revisor-calidad`; corregir hallazgos.
- Pedir confirmación antes del push/PR. **El merge aplica la migración en producción** (Render corre `db:migrate:deploy`): pedir confirmación explícita antes de mergear y verificar `list_deploys` después.
- Tras el deploy: el Administrador pulsa "Crear y vincular cuentas" cuando lo decida.
