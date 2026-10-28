# Parejas Operador CDA + Asistente CDA en la app — Diseño

Fecha: 2026-10-26 · Autor del pedido: Sebastian Cabascango (DPEI Imbabura)

## Intención

Hoy los kits, el recinto y el militar que ve la app móvil están ligados a
cuentas del apartado **Usuarios** con rol `OPERADOR_CDA`. En realidad quienes van
al recinto son las personas del listado **Operadores CDA** (`OperadorCda`, grupos
`OPERADOR` y `ASISTENTE`), que ya está completo para operadores. Se quiere que
cada Operador CDA tenga su Asistente CDA (pareja por evento) y que ambos vean en
la app el recinto asignado, sus kits y los militares de ese recinto, reusando
todo el flujo de campo que ya existe.

El asistente es un **respaldo**: normalmente la app la usa el operador; el
asistente actúa solo en emergencia (ej. el operador no tiene celular Android).

## Decisiones del usuario

### Acceso
- Cada persona de Operadores CDA (grupo OPERADOR o ASISTENTE) tiene cuenta propia
  en la app, "en la misma modalidad que Usuarios".
- **Entra con su cédula** (no hay correos por ahora) + contraseña inicial
  `Cne2026!` = la misma del reseteo de Usuarios (`DEFAULT_RESET_PASSWORD`, fallback
  `Cne2026!` en `users.service.ts:157`). Cambio obligatorio en el primer ingreso
  (`debeCambiarPwd`).
- Los usuarios administrativos siguen entrando con correo.
- Las cuentas viejas de Usuarios con rol `OPERADOR_CDA` **se reemplazan y se
  desactivan**.
- **Aplica a partir del próximo evento electoral.** El evento activo actual sigue
  funcionando con las cuentas viejas; no se migran sus kits, tracking ni
  asignaciones de supervisor.

### Parejas
- **Una pareja por evento electoral**: operador + asistente (opcional) + recinto.
  El historial de eventos anteriores se conserva.
- Operador sin asistente trabaja solo.
- **Un recinto tiene como máximo una pareja por evento** (unique eventoId+recintoId).
- Se arman de dos formas, ambas obligatorias:
  1. **Excel**: por fila, operador (nombre, cédula, celular), asistente (nombre,
     cédula, celular; puede venir vacío) y recinto.
  2. **A mano en la web**: crear/cambiar pareja eligiendo operador, asistente y
     recinto (ej. asistente nuevo o reemplazo de último minuto).
- Si una cédula del Excel no existe en Operadores CDA, **se crea automáticamente**
  con nombre y celular del Excel (y su cuenta); el resto de datos se completa luego.

### Recinto, kit, militar
- El militar sigue ligado al recinto (sin cambios).
- El kit **se asigna automáticamente**: la pareja ve los kits del recinto asignado,
  no se eligen a mano.

### Comportamiento en la app
- Asistente **no habilitado**: solo ve recinto, kits y militares.
- Asistente **habilitado** por un Técnico Supervisor o Administrador (desde la web,
  para esa pareja): puede hacer las mismas acciones que el operador.
- Operador y asistente habilitado trabajan **sobre un único estado compartido**:
  si uno marca "en tránsito", el otro lo ve; leen y escriben el estado del mismo
  kit/pareja. Cada acción registra quién la hizo.
- **GPS**: el primero de los dos que se conecta queda como fuente del GPS durante
  toda la jornada. Si deja de enviar, **no cambia sola**: un Técnico Supervisor o
  Administrador cambia la fuente desde la web.
- Habilitar asistente y cambiar fuente GPS: **cualquier Técnico Supervisor o
  Administrador** (no solo el asignado).

## Objetivos
- Login por cédula para Operadores CDA sin romper el login por correo.
- Modelo de pareja por evento (operador, asistente opcional, recinto, asistente
  habilitado sí/no, fuente GPS).
- Importación Excel de parejas + gestión manual en web.
- App: ambos ven la asignación; estado de tracking compartido por pareja.
- Transición: desactivar cuentas viejas `OPERADOR_CDA`.

## No objetivos
- Correo para operadores/asistentes (más adelante).
- Cambiar cómo se asignan militares a recintos.
- Otros grupos CDA (DIGITADOR, SUPERVISOR, etc.) no entran en parejas.
- Conmutación automática de la fuente GPS.

## Anti-objetivos (sería un fracaso aunque "funcione")
- Que operador y asistente generen estados distintos / duplicados para el mismo kit
  (dos "llegada al recinto" contradictorios, alertas dobles).
- Que el asistente no habilitado pueda marcar algo.
- Que los administrativos dejen de poder entrar con su correo.
- Perder el historial de tracking/actas de eventos anteriores ligado a cuentas viejas.

## Restricciones del proyecto
- Cambios de esquema vía migración Prisma; `db:generate` después; confirmación del
  usuario antes de aplicar migraciones en producción y antes de cualquier push.
- Validación con Zod en `@cne/shared-validation` (recompilar paquetes compartidos).
- Pruebas unitarias obligatorias; revisión con `revisor-calidad`.
- RBAC web duplicado (memoria `cne_dpei_web_rbac_pattern`); hay permisos por acción
  y módulos por rol (PR #110/#112) que deben respetarse.
- Excel ya tiene utilidades en `operadores-cda/excel-operadores-cda.ts`.
- Varias PRs + APK nueva al final.

## Contexto técnico relevante (hallazgos)
- Todo el flujo de campo se keyea por `operadorId` = id de **Usuario** tomado del
  JWT: `KitElectoral.operadorId`, `EventoTracking`, `RecepcionKit`, `PosicionGps`,
  `Incidencia`, `Alerta`, `AsignacionSupervisor`, y `tracking.service.ts`
  (`miAsignacion`, `validarKit` exige `kit.operadorId === operadorId`).
- `OperadorCda` no tiene email, login ni vínculo con `Usuario`.
- `Usuario.email` es obligatorio y único; `AuthService.login` y `loginSchema` solo
  aceptan email; `forgotPassword` va por email.
- Login tiene `@Throttle` 5/min; no hay bloqueo por intentos por cuenta.

## Decisiones de diseño tomadas por Claude (revisables)
- **Vincular `OperadorCda` → `Usuario`** (`usuarioId` único y opcional en
  `OperadorCda`) en vez de inventar un segundo sistema de login. Así se reusan
  JWT, refresh, `debeCambiarPwd`, guards y todo el tracking existente. La cuenta se
  crea al registrar/importar un OPERADOR o ASISTENTE, con rol `OPERADOR_CDA`, sin
  correo (hacer `email` opcional) y `cedula` como identificador de login.
- Login acepta **cédula o correo** en el mismo campo (10 dígitos → cédula).
- Pareja como modelo nuevo `ParejaCda` (eventoId, operadorCdaId, asistenteCdaId?,
  recintoId, asistenteHabilitado, fuenteGpsUsuarioId?, timestamps); unique
  (eventoId, operadorCdaId), (eventoId, asistenteCdaId) y (eventoId, recintoId).
- Estado compartido: el tracking se resuelve **por pareja** (el servicio traduce el
  usuario del JWT a su pareja del evento activo y consulta/escribe eventos de
  cualquiera de los dos integrantes); `operadorId` en las filas sigue guardando
  quién lo hizo.
- Kits: al asignar recinto a la pareja, los kits de ese recinto/evento quedan con
  `operadorId` = usuario del operador (el asistente accede vía pareja).
- GPS: posiciones de quien no es la fuente se descartan (no se guardan).
- Seguridad por contraseña inicial común: en la web, indicador "aún no cambió la
  contraseña"; considerar bloqueo temporal por intentos fallidos por cédula.
- Reemplazo de cuentas viejas: si la cédula de una cuenta vieja coincide con un
  `OperadorCda`, se **reutiliza y vincula** esa cuenta (email opcional, contraseña
  reseteada a la inicial, conserva historial) porque `Usuario.cedula` es único;
  las que no coinciden se desactivan. Se ejecuta antes de armar parejas del
  próximo evento, sin tocar datos del evento activo. Nada se borra.
- Marcas offline simultáneas del mismo paso: vale la primera por `ocurridoEn`; la
  segunda se ignora y queda registrada (bitácora), sin error en la app.
- Reemplazo de integrante: la pareja es la identidad del estado; el nuevo hereda
  el avance; si el que sale era la fuente GPS, la fuente queda libre.
- Fuente GPS: solo el operador o un asistente habilitado; "conectarse primero" =
  primer envío de posición aceptado en el evento.
- Alertas automáticas: una sola vez por pareja, notificadas a ambos integrantes.

## Dejado al builder
- Partición exacta en PRs y orden (sugerido: auth por cédula → cuentas + vínculo →
  parejas + Excel + web → tracking compartido + GPS → transición → APK).
- Diseño de pantallas web siguiendo estilo Figma existente.
- Formato exacto de columnas del Excel (plantilla descargable).
