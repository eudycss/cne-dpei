# Alertas de enlaces caídos (CDAs Imbabura)

## Contexto

El CNE lleva a nivel nacional una hoja de Google Sheets (PRTG) con el estado de
conectividad de 1780 CDAs (Centros de Digitalización de Actas) en las 24
provincias. La pestaña **"INF"** de esa hoja tiene, entre otras, las columnas
`PROVINCIA`, `CODIGO DE RECINTO`, `LOCALIDAD` (nombre del recinto) y una
columna de estado con valores de texto `ACTIVO` / `FALLO`.

Hoy nadie en el sistema CNE Imbabura se entera automáticamente cuando un
enlace de un CDA de Imbabura se cae — hay que abrir la hoja manualmente. El
pedido es: cuando el estado de un enlace de Imbabura pase a `FALLO`, avisar
por correo, por Telegram, y con un aviso emergente dentro de la app (web y
móvil).

Se descartó leer el color de celda de la pestaña "monitoreo" (más compleja de
leer vía API) a favor de leer el texto `ACTIVO`/`FALLO` de la pestaña "INF",
por decisión explícita del usuario ("lo que sea más fácil y rápido de
implementar").

## Alcance

- **Solo enlaces con `PROVINCIA = 'IMBABURA'`** (55 de los 1780 registros
  actuales). Fuera de alcance: monitorear las otras 23 provincias.
- Revisión automática **cada 5 minutos**, igual que el cron de HU18
  (`AlertasService.evaluarAnomalias`).
- Solo se notifica en la **transición** ACTIVO→FALLO (no en cada revisión
  mientras sigue caído), para no saturar correo/Telegram/campanita.
- **Excepción, agregada el 2026-09-23 tras hallazgo en producción:** la
  primera vez que se ve un recinto (sin `estadoAnterior` registrado, es
  decir la fila aún no existe en `enlaces_recinto`) y ya llega en `FALLO`,
  **sí se notifica**. Sin esto, un enlace que ya estaba caído antes de que
  arrancara el monitoreo (o tras un reset de base) queda mudo para siempre
  — nunca pasa por ACTIVO, así que nunca hay transición que detectar. Se
  comprobó el caso real: 7 de 55 recintos de Imbabura llevaban caídos desde
  antes del primer ciclo y jamás dispararon alerta. El costo de notificar
  también en este caso es acotado (dispara una sola vez por recinto, no en
  cada ciclo) y el riesgo de quedarse callado es peor que el de una alerta
  de más.
- El aviso emergente en web/móvil es visible solo para roles
  `ADMINISTRADOR` y `TECNICO_SUPERVISOR` (no `OPERADOR_CDA`).
- Fuera de alcance explícitamente: leer color de celda, cubrir provincias
  fuera de Imbabura, más de un canal de Telegram/chat, historial/dashboard de
  disponibilidad histórica (solo estado actual + notificación de cambio).

## Arquitectura

### Nuevo dominio `enlaces` (independiente de `alertas`)

La tabla `alertas` existente (HU18) exige un `eventoId` de un evento
electoral activo — los enlaces se monitorean todo el año, no solo el día de
elecciones, así que no encaja ahí. Se crea un dominio nuevo, paralelo:

```
apps/api/src/enlaces/
  enlaces.module.ts
  enlaces.service.ts       # cron + lectura de Sheets + diff + notificar
  enlaces.controller.ts    # GET listado, CRUD de correos de config_enlaces
  sheets-enlaces.client.ts # wrapper delgado sobre googleapis (Sheets API)
```

### Modelo de datos (Prisma)

```prisma
model EnlaceRecinto {
  codigoRecinto   String        @id @map("codigo_recinto") @db.VarChar(20)
  nombreRecinto   String        @map("nombre_recinto") @db.VarChar(255)
  estado          EstadoEnlace  @default(ACTIVO)
  estadoAnterior  EstadoEnlace? @map("estado_anterior")
  actualizadoEn   DateTime      @updatedAt @map("actualizado_en") @db.Timestamptz(6)

  @@map("enlaces_recinto")
}

enum EstadoEnlace {
  ACTIVO
  FALLO

  @@map("estado_enlace")
}

model ConfigEnlaces {
  id        Int      @id @default(1)
  correos   String[] @default([])
  chatIdTelegram String? @map("chat_id_telegram")

  @@map("config_enlaces")
}
```

`ConfigEnlaces` es una fila única (singleton, `id=1`), igual de simple que
`ConfigAlerta` pero sin llave por evento.

### Flujo del cron (cada 5 min)

1. `EnlacesService.revisarEnlaces()`:
   - Lee la pestaña "INF" vía `sheets-enlaces.client.ts` (Google Sheets API,
     credencial de cuenta de servicio).
   - Filtra filas con `PROVINCIA = 'IMBABURA'`.
   - Para cada fila, upsert en `enlaces_recinto` por `codigoRecinto`,
     guardando `estadoAnterior` = valor previo antes de sobrescribir.
   - Si `estado nuevo = FALLO` y `estadoAnterior !== FALLO` (incluye el caso
     `estadoAnterior` inexistente, primera vez que se ve el recinto) →
     dispara `notificarCaida(codigoRecinto, nombreRecinto)`.
2. `notificarCaida()`:
   - Envía correo (Brevo) a cada dirección de `ConfigEnlaces.correos`.
   - Envía mensaje a Telegram (`TelegramNotifier.sendMensaje`) si
     `chatIdTelegram` está configurado.
   - Encola una fila en `notificaciones` (tabla ya existente de HU19) con
     `tipoEvento = 'ENLACE_CAIDO'` y `payload = {codigoRecinto, nombreRecinto}`
     para cada usuario con rol `ADMINISTRADOR` o `TECNICO_SUPERVISOR`.

### Acceso a Google Sheets

- Librería `googleapis` (paquete nuevo en `apps/api`).
- Credencial de cuenta de servicio en variable de entorno
  `GOOGLE_SHEETS_CREDENTIALS_JSON` (contenido del JSON de la clave,
  serializado; se parsea en runtime — mismo patrón que otros secretos del
  proyecto, nunca committeado).
- `GOOGLE_SHEETS_ID` y `GOOGLE_SHEETS_TAB_INF` (nombre de la pestaña) también
  como variables de entorno, para no hardcodear el ID de la hoja en código.
- Pasos manuales previos (los hace el usuario, no el código):
  1. Crear proyecto en Google Cloud Console.
  2. Habilitar "Google Sheets API".
  3. Crear cuenta de servicio, generar clave JSON.
  4. Compartir la hoja con el correo de la cuenta de servicio (rol Lector).
  5. Cargar el JSON como variable de entorno en Render.

### Correo (reutiliza infraestructura existente)

`BrevoNotifier` (`apps/api/src/auth/notifier.ts`) ya envía correo real en
producción vía Brevo. Se le agrega un método:

```ts
sendEnlaceCaido(destinatarios: string[], codigoRecinto: string, nombreRecinto: string): Promise<void>
```

No se introduce un proveedor de correo nuevo.

### Telegram (integración nueva)

```
apps/api/src/enlaces/telegram-notifier.ts
```

- Usa la API HTTP de Telegram Bot (`fetch` a
  `https://api.telegram.org/bot<TOKEN>/sendMessage`), sin librería adicional
  (igual de simple que la llamada a Brevo).
- `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` como variables de entorno.
- El usuario crea el bot con @BotFather y lo agrega a un grupo de Telegram;
  el `chat_id` de ese grupo se obtiene con una llamada simple a
  `getUpdates` una vez que alguien escribe en el grupo (se documenta el
  paso exacto en el plan de implementación).
- Si `TELEGRAM_BOT_TOKEN`/`chatIdTelegram` no están configurados, el envío a
  Telegram se omite silenciosamente (no bloquea correo ni popup) — mismo
  principio de degradación que ya usa `resolveNotifier()` para correo.

### Aviso emergente en web y móvil

Reutiliza la tabla `notificaciones` y el mecanismo de campanita que ya
existen (HU19). Cambio necesario en ambos clientes: cuando llega una
notificación no leída con `tipoEvento = 'ENLACE_CAIDO'`, además de aparecer
en la lista de la campanita, se muestra una vez como modal/toast al abrir o
refrescar la app (no se repite si ya se mostró esa notificación).

- **Web**: modal reutilizando el patrón visual ya existente en
  `apps/web/src/pages/alertas/AlertasPage.tsx`.
- **Móvil**: `Alert.alert` o un modal ligero (patrón ya usado en
  `VerificacionDpiScreen.tsx`/pantallas de tracking), disparado desde el
  mismo polling de notificaciones que ya alimenta la campanita.
- Visibilidad: el backend solo encola estas notificaciones para usuarios con
  rol `ADMINISTRADOR` o `TECNICO_SUPERVISOR` — los clientes no necesitan
  lógica de rol adicional, ya reciben solo lo que les corresponde.

### Pantalla nueva en web: `apps/web/src/pages/enlaces/EnlacesPage.tsx`

- Lista de `enlaces_recinto` de Imbabura con su estado actual (para
  consulta manual, sin depender de abrir la hoja de Google).
- Formulario simple para administrar `ConfigEnlaces.correos` (agregar/quitar
  direcciones) — resuelve "el correo que yo agregue".
- Solo accesible a rol `ADMINISTRADOR` (gestión de configuración).

## Manejo de errores

- Si la lectura de Google Sheets falla (cuota excedida, credencial inválida,
  hoja movida) → se loguea el error y se **mantiene el último estado
  conocido** en `enlaces_recinto` (no se generan falsas alertas de "todo
  cayó" por un fallo de lectura). Mismo principio que ya usa el cron de HU18.
- Si el envío a Brevo o Telegram falla para un enlace, no bloquea el envío
  a los demás canales ni a los demás enlaces del mismo ciclo (cada canal se
  envuelve en su propio try/catch).

## Testing

- `enlaces.service.spec.ts`: mock de `sheets-enlaces.client.ts` — verifica
  que notifica en la transición ACTIVO→FALLO y también en la primera carga
  de un recinto que ya llega en FALLO (sin `estadoAnterior`), que NO
  renotifica en FALLO→FALLO (ya estaba caído y sigue caído), que filtra
  correctamente por `PROVINCIA = 'IMBABURA'`, y que un error de lectura no
  borra el estado existente.
- `telegram-notifier.spec.ts`: verifica el payload enviado y que un fallo de
  red no lanza excepción no controlada.
- Extensión de los tests de `notifier.ts` para el nuevo método
  `sendEnlaceCaido`.
- Web: test de `EnlacesPage.tsx` (listado + alta/baja de correos) y del
  modal disparado por `tipoEvento = 'ENLACE_CAIDO'`.
- Móvil: test del disparo del modal en el flujo de notificaciones existente.

## Fuera de alcance (explícitamente descartado)

- Leer color de celda de la pestaña "monitoreo" (se usa la columna de texto
  de la pestaña "INF" en su lugar).
- Monitorear provincias distintas a Imbabura.
- Historial/dashboard de disponibilidad a lo largo del tiempo — solo estado
  actual y notificación del cambio.
- Múltiples chats/grupos de Telegram — un solo `chat_id` fijo.
- Reintentos con backoff para Brevo/Telegram — mismo nivel de robustez que
  el resto del proyecto hoy (sin backoff en `NotificationsService`).
