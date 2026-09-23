# Alertas de Enlaces Caídos (CDAs Imbabura) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detectar automáticamente cuando un enlace de un CDA de Imbabura pasa a estado `FALLO` en la hoja de Google Sheets nacional del CNE, y avisar por correo (Brevo), Telegram y un aviso emergente en la app web/móvil, solo a roles `ADMINISTRADOR`/`TECNICO_SUPERVISOR`.

**Architecture:** Nuevo dominio `enlaces` en el backend (independiente de `alertas`/`eventoId`, porque los enlaces se monitorean todo el año). Un cron cada 5 minutos lee la pestaña "INF" de la hoja vía Google Sheets API (cuenta de servicio), filtra `PROVINCIA = 'IMBABURA'`, guarda el estado en una tabla nueva y notifica solo en la transición `ACTIVO → FALLO`. Reutiliza el `BrevoNotifier` existente para correo y la tabla `notificaciones` (HU19) existente para el aviso in-app; agrega un notificador de Telegram nuevo.

**Tech Stack:** NestJS + Prisma (backend), React + Vite + TanStack Query (web), React Native + Expo (móvil), `googleapis` (Google Sheets API), Brevo API (correo, ya integrado), Telegram Bot API (HTTP directo, sin librería).

**Spec:** `docs/superpowers/specs/2026-09-23-alertas-enlaces-caidos-design.md`

## Global Constraints

- Solo enlaces con `PROVINCIA = 'IMBABURA'` (filtrado en el cliente de lectura, nunca se procesan las otras 23 provincias).
- Revisión cada 5 minutos (`@Cron(CronExpression.EVERY_5_MINUTES)`), igual que `AlertasService.evaluarAnomalias`.
- Solo se notifica en la transición `ACTIVO → FALLO`, nunca en `FALLO → FALLO` ni en la primera carga si ya estaba `FALLO`.
- El aviso in-app (web/móvil) es visible solo para `ADMINISTRADOR` y `TECNICO_SUPERVISOR` — nunca `OPERADOR_CDA` ni `LECTOR`.
- Un error de lectura de la hoja de Google mantiene el último estado conocido en la base — nunca se generan alertas falsas de "todo cayó" por un fallo de lectura.
- Un fallo de un canal de notificación (Brevo, Telegram) nunca bloquea a los demás canales ni al resto del ciclo del cron.
- No se lee el color de celda de ninguna pestaña — solo el texto de la columna de estado de la pestaña "INF".
- No se agregan dependencias de notificación nuevas más allá de `googleapis` (Telegram se llama con `fetch` directo, igual que Brevo).

---

## Mapa de archivos

**Backend — nuevos:**
- `apps/api/src/enlaces/enlaces.module.ts`
- `apps/api/src/enlaces/enlaces.service.ts`
- `apps/api/src/enlaces/enlaces.service.spec.ts`
- `apps/api/src/enlaces/enlaces.controller.ts`
- `apps/api/src/enlaces/sheets-enlaces.client.ts`
- `apps/api/src/enlaces/sheets-enlaces.client.spec.ts`
- `apps/api/src/enlaces/telegram-notifier.ts`
- `apps/api/src/enlaces/telegram-notifier.spec.ts`
- `apps/api/src/auth/notifier.spec.ts`

**Backend — modificados:**
- `apps/api/prisma/schema.prisma`
- `apps/api/src/auth/notifier.ts`
- `apps/api/src/notifications/notifications.service.ts`
- `apps/api/src/notifications/notifications.service.spec.ts`
- `apps/api/src/app.module.ts`
- `apps/api/package.json` (nueva dependencia `googleapis`)
- `.env.example`

**Shared — modificados:**
- `packages/shared-types/src/index.ts`
- `packages/shared-validation/src/index.ts`

**Web — nuevos:**
- `apps/web/src/lib/queries/enlaces.ts`
- `apps/web/src/pages/enlaces/EnlacesPage.tsx`
- `apps/web/src/pages/enlaces/EnlacesPage.test.tsx`

**Web — modificados:**
- `apps/web/src/App.tsx`
- `apps/web/src/pages/Layout.tsx`
- `apps/web/src/lib/notifications.ts`
- `apps/web/src/lib/notifications.test.ts`
- `apps/web/src/components/NotificationsBell.tsx`
- `apps/web/src/components/NotificationsBell.test.tsx`

**Móvil — modificados:**
- `apps/mobile/src/lib/notifications.ts`
- `apps/mobile/src/lib/notifications.test.ts`
- `apps/mobile/src/components/AppBar.tsx`
- `apps/mobile/src/components/AppBar.test.tsx` (si no existe, se crea)

---

### Task 1: Modelo de datos (Prisma) + tipos compartidos

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `packages/shared-types/src/index.ts:717` (fin de archivo)

**Interfaces:**
- Produces: modelo Prisma `EnlaceRecinto` (`codigoRecinto`, `nombreRecinto`, `estado: EstadoEnlace`, `estadoAnterior: EstadoEnlace | null`, `actualizadoEn`), enum `EstadoEnlace` (`ACTIVO`/`FALLO`), modelo `ConfigEnlaces` (`id`, `correos: string[]`, `chatIdTelegram: string | null`). Tipos TS: `EnlaceRecinto`, `ConfigEnlacesResponse`, `AddCorreoEnlaceRequest`.

- [x] **Step 1: Agregar los modelos a `schema.prisma`**

Al final de `apps/api/prisma/schema.prisma`, después del modelo `Notificacion` (línea 481), agregar:

```prisma
// =====================================================================
// ENLACES CDAs (monitoreo de conectividad, independiente de eventoId)
// =====================================================================

enum EstadoEnlace {
  ACTIVO
  FALLO

  @@map("estado_enlace")
}

model EnlaceRecinto {
  codigoRecinto  String        @id @map("codigo_recinto") @db.VarChar(20)
  nombreRecinto  String        @map("nombre_recinto") @db.VarChar(255)
  estado         EstadoEnlace  @default(ACTIVO)
  estadoAnterior EstadoEnlace? @map("estado_anterior")
  actualizadoEn  DateTime      @updatedAt @map("actualizado_en") @db.Timestamptz(6)

  @@map("enlaces_recinto")
}

model ConfigEnlaces {
  id             Int      @id @default(1)
  correos        String[] @default([])
  chatIdTelegram String?  @map("chat_id_telegram")

  @@map("config_enlaces")
}
```

- [x] **Step 2: Generar y aplicar la migración** (nota: `prisma migrate dev` no funciona en shell no interactivo; se creó la carpeta de migración a mano `20260923120000_add_enlaces` y se aplicó con `db:migrate:deploy`, luego `db:generate`)

Run: `pnpm --filter @cne/api db:migrate -- --name add_enlaces`
Expected: crea `apps/api/prisma/migrations/<timestamp>_add_enlaces/migration.sql`, la aplica contra la base local, y corre `prisma generate` automáticamente.

- [x] **Step 3: Agregar los tipos compartidos**

Al final de `packages/shared-types/src/index.ts` (después de `UpdateEstadoAlertaRequest`, línea 717), agregar:

```ts

// ===================================================================
// Alertas de enlaces caídos (CDAs Imbabura)
// ===================================================================

export type EstadoEnlace = 'ACTIVO' | 'FALLO';

export interface EnlaceRecinto {
  codigoRecinto: string;
  nombreRecinto: string;
  estado: EstadoEnlace;
  actualizadoEn: string;
}

export interface ConfigEnlacesResponse {
  correos: string[];
  chatIdTelegram: string | null;
}

export interface AddCorreoEnlaceRequest {
  correo: string;
}
```

- [x] **Step 4: Rebuild de shared-types**

Run: `pnpm --filter @cne/shared-types build`
Expected: compila sin errores.

- [x] **Step 5: Commit** — hecho en `b43c224`

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations packages/shared-types/src/index.ts
git commit -m "feat(api): modelo de datos para enlaces caidos de CDAs Imbabura"
```

---

### Task 2: Validación compartida (correo)

**Files:**
- Modify: `packages/shared-validation/src/index.ts`

**Interfaces:**
- Consumes: `emailSchema` (ya existe en el mismo archivo, línea 57).
- Produces: `addCorreoEnlaceSchema` (zod), usado por `ZodValidationPipe` en el controller (Task 8) y por el tipo `AddCorreoEnlaceRequest` (Task 1).

- [x] **Step 1: Agregar el schema**

Al final de `packages/shared-validation/src/index.ts`, agregar:

```ts

export const addCorreoEnlaceSchema = z.object({
  correo: emailSchema,
});
```

- [x] **Step 2: Rebuild**

Run: `pnpm --filter @cne/shared-validation build`
Expected: compila sin errores.

- [x] **Step 3: Commit** — hecho en `c78d73b`

```bash
git add packages/shared-validation/src/index.ts
git commit -m "feat(shared-validation): schema para agregar correo de enlaces"
```

---

### Task 3: Extender `notifier.ts` con `sendEnlaceCaido`

**Files:**
- Modify: `apps/api/src/auth/notifier.ts`
- Create: `apps/api/src/auth/notifier.spec.ts`

**Interfaces:**
- Produces: `INotifier.sendEnlaceCaido(destinatarios: string[], codigoRecinto: string, nombreRecinto: string): Promise<void>` — implementado en `ConsoleNotifier` y `BrevoNotifier`. Consumido por `EnlacesService` (Task 7).

- [x] **Step 1: Escribir el test que falla**

Crear `apps/api/src/auth/notifier.spec.ts`:

```ts
import { BrevoNotifier, ConsoleNotifier } from './notifier';

describe('ConsoleNotifier', () => {
  it('sendEnlaceCaido no lanza y resuelve', async () => {
    const notifier = new ConsoleNotifier();
    await expect(
      notifier.sendEnlaceCaido(['a@b.com'], '978', 'Escuela Central'),
    ).resolves.toBeUndefined();
  });
});

describe('BrevoNotifier', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.BREVO_API_KEY = 'test-key';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.BREVO_API_KEY;
  });

  it('sendEnlaceCaido envía un correo a cada destinatario con codigo y nombre del recinto', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true });
    const notifier = new BrevoNotifier();

    await notifier.sendEnlaceCaido(['a@b.com', 'c@d.com'], '978', 'Escuela Central');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.to).toEqual([{ email: 'a@b.com' }]);
    expect(body.htmlContent).toContain('978');
    expect(body.htmlContent).toContain('Escuela Central');
  });

  it('sendEnlaceCaido lanza si Brevo responde con error', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const notifier = new BrevoNotifier();

    await expect(
      notifier.sendEnlaceCaido(['a@b.com'], '978', 'Escuela Central'),
    ).rejects.toThrow('Brevo 500: boom');
  });
});
```

- [x] **Step 2: Correr el test para verificar que falla**

Run: `pnpm --filter @cne/api test -- notifier.spec.ts`
Expected: FAIL — `sendEnlaceCaido` no existe en `INotifier`/`ConsoleNotifier`/`BrevoNotifier`.

- [x] **Step 3: Implementar `sendEnlaceCaido`**

En `apps/api/src/auth/notifier.ts`, modificar la interfaz (línea 3-6):

```ts
export interface INotifier {
  sendPasswordResetLink(email: string, link: string): Promise<void>;
  sendInitialPassword(email: string, password: string): Promise<void>;
  sendEnlaceCaido(destinatarios: string[], codigoRecinto: string, nombreRecinto: string): Promise<void>;
}
```

En `ConsoleNotifier` (después de `sendInitialPassword`, línea 20), agregar:

```ts

  async sendEnlaceCaido(destinatarios: string[], codigoRecinto: string, nombreRecinto: string): Promise<void> {
    this.log.warn(`[ENLACE CAIDO] ${codigoRecinto} - ${nombreRecinto} → ${destinatarios.join(', ')}`);
  }
```

En `BrevoNotifier` (después de `sendInitialPassword`, línea 79), agregar:

```ts

  async sendEnlaceCaido(destinatarios: string[], codigoRecinto: string, nombreRecinto: string): Promise<void> {
    for (const to of destinatarios) {
      await this.send(
        to,
        `Enlace caído: ${codigoRecinto} - ${nombreRecinto}`,
        `
          <h2>CNE Imbabura — Enlace caído</h2>
          <p>El enlace del siguiente recinto pasó a estado <strong>FALLO</strong>:</p>
          <p><strong>Código:</strong> ${codigoRecinto}<br/><strong>Recinto:</strong> ${nombreRecinto}</p>
        `,
      );
    }
    this.log.log(`[ENLACE CAIDO] correo enviado a ${destinatarios.length} destinatario(s)`);
  }
```

- [x] **Step 4: Correr el test para verificar que pasa**

Run: `pnpm --filter @cne/api test -- notifier.spec.ts`
Expected: PASS (3/3).

- [x] **Step 5: Commit**

```bash
git add apps/api/src/auth/notifier.ts apps/api/src/auth/notifier.spec.ts
git commit -m "feat(api): agregar sendEnlaceCaido a ConsoleNotifier y BrevoNotifier"
```

---

### Task 4: `TelegramNotifier`

**Files:**
- Create: `apps/api/src/enlaces/telegram-notifier.ts`
- Create: `apps/api/src/enlaces/telegram-notifier.spec.ts`

**Interfaces:**
- Produces: `TelegramNotifier.enviarEnlaceCaido(codigoRecinto: string, nombreRecinto: string): Promise<void>` (nunca lanza). Consumido por `EnlacesService` (Task 7).

- [x] **Step 1: Escribir el test que falla**

Crear `apps/api/src/enlaces/telegram-notifier.spec.ts`:

```ts
import { TelegramNotifier } from './telegram-notifier';

describe('TelegramNotifier', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  it('no llama a fetch si faltan TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID', async () => {
    global.fetch = jest.fn();
    const notifier = new TelegramNotifier();

    await notifier.enviarEnlaceCaido('978', 'Escuela Central');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('envía el mensaje con codigo y nombre del recinto al chat configurado', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok123';
    process.env.TELEGRAM_CHAT_ID = '-100200300';
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    const notifier = new TelegramNotifier();

    await notifier.enviarEnlaceCaido('978', 'Escuela Central');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.telegram.org/bottok123/sendMessage',
      expect.objectContaining({ method: 'POST' }),
    );
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(opts.body);
    expect(body.chat_id).toBe('-100200300');
    expect(body.text).toContain('978');
    expect(body.text).toContain('Escuela Central');
  });

  it('no lanza si fetch rechaza (error de red)', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'tok123';
    process.env.TELEGRAM_CHAT_ID = '-100200300';
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    const notifier = new TelegramNotifier();

    await expect(notifier.enviarEnlaceCaido('978', 'Escuela Central')).resolves.not.toThrow();
  });
});
```

- [x] **Step 2: Correr el test para verificar que falla**

Run: `pnpm --filter @cne/api test -- telegram-notifier.spec.ts`
Expected: FAIL — el módulo `./telegram-notifier` no existe.

- [x] **Step 3: Implementar `TelegramNotifier`**

Crear `apps/api/src/enlaces/telegram-notifier.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class TelegramNotifier {
  private readonly log = new Logger('TelegramNotifier');

  async enviarEnlaceCaido(codigoRecinto: string, nombreRecinto: string): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      this.log.warn(
        'TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID no configurados — se omite el aviso a Telegram',
      );
      return;
    }
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: `🔴 Enlace caído: ${codigoRecinto} — ${nombreRecinto}`,
        }),
      });
      if (!res.ok) {
        this.log.error(`Telegram respondió ${res.status} al enviar aviso de enlace caído`);
      }
    } catch (e) {
      this.log.error(`Error enviando aviso a Telegram: ${e}`);
    }
  }
}
```

- [x] **Step 4: Correr el test para verificar que pasa**

Run: `pnpm --filter @cne/api test -- telegram-notifier.spec.ts`
Expected: PASS (3/3).

- [x] **Step 5: Commit**

```bash
git add apps/api/src/enlaces/telegram-notifier.ts apps/api/src/enlaces/telegram-notifier.spec.ts
git commit -m "feat(api): notificador de Telegram para enlaces caidos"
```

---

### Task 5: `SheetsEnlacesClient` (lectura de Google Sheets)

**Files:**
- Create: `apps/api/src/enlaces/sheets-enlaces.client.ts`
- Create: `apps/api/src/enlaces/sheets-enlaces.client.spec.ts`
- Modify: `apps/api/package.json` (agregar dependencia `googleapis`)

**Interfaces:**
- Produces: `interface SheetEnlaceRow { codigoRecinto: string; nombreRecinto: string; estado: 'ACTIVO' | 'FALLO' }`, `SheetsEnlacesClient.leerEnlacesImbabura(): Promise<SheetEnlaceRow[]>`. Consumido por `EnlacesService` (Task 7).

- [x] **Step 1: Instalar `googleapis`**

Run: `pnpm --filter @cne/api add googleapis`
Expected: se agrega a `dependencies` en `apps/api/package.json` y se instala.

- [x] **Step 2: Escribir el test que falla**

Crear `apps/api/src/enlaces/sheets-enlaces.client.spec.ts`:

```ts
const valuesGetMock = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: jest.fn().mockImplementation(() => ({})) },
    sheets: jest.fn(() => ({ spreadsheets: { values: { get: valuesGetMock } } })),
  },
}));

import { SheetsEnlacesClient } from './sheets-enlaces.client';

const HEADER = [
  'PROVINCIA',
  'CODIGO DE RECINTO',
  'LOCALIDAD',
  'FALLO',
];

describe('SheetsEnlacesClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_SHEETS_CREDENTIALS_JSON = '{}';
    process.env.GOOGLE_SHEETS_ID = 'sheet-id';
  });

  it('filtra solo filas de PROVINCIA=IMBABURA y mapea codigo/nombre/estado', async () => {
    valuesGetMock.mockResolvedValue({
      data: {
        values: [
          HEADER,
          ['AZUAY', '1005', 'Escuela Azuay', 'ACTIVO'],
          ['IMBABURA', '982', 'Unidad Educativa Gonzalo Zaldumbide', 'FALLO'],
          ['IMBABURA', '983', 'Otra Escuela Imbabura', 'ACTIVO'],
        ],
      },
    });
    const client = new SheetsEnlacesClient();

    const rows = await client.leerEnlacesImbabura();

    expect(rows).toEqual([
      { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Gonzalo Zaldumbide', estado: 'FALLO' },
      { codigoRecinto: '983', nombreRecinto: 'Otra Escuela Imbabura', estado: 'ACTIVO' },
    ]);
  });

  it('descarta filas sin código de recinto', async () => {
    valuesGetMock.mockResolvedValue({
      data: { values: [HEADER, ['IMBABURA', '', 'Sin código', 'FALLO']] },
    });
    const client = new SheetsEnlacesClient();

    const rows = await client.leerEnlacesImbabura();

    expect(rows).toEqual([]);
  });

  it('devuelve arreglo vacío si la hoja no tiene filas de datos', async () => {
    valuesGetMock.mockResolvedValue({ data: { values: [HEADER] } });
    const client = new SheetsEnlacesClient();

    const rows = await client.leerEnlacesImbabura();

    expect(rows).toEqual([]);
  });
});
```

- [x] **Step 3: Correr el test para verificar que falla**

Run: `pnpm --filter @cne/api test -- sheets-enlaces.client.spec.ts`
Expected: FAIL — el módulo `./sheets-enlaces.client` no existe.

- [x] **Step 4: Implementar `SheetsEnlacesClient`**

Crear `apps/api/src/enlaces/sheets-enlaces.client.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { google } from 'googleapis';

export interface SheetEnlaceRow {
  codigoRecinto: string;
  nombreRecinto: string;
  estado: 'ACTIVO' | 'FALLO';
}

@Injectable()
export class SheetsEnlacesClient {
  async leerEnlacesImbabura(): Promise<SheetEnlaceRow[]> {
    const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS_JSON ?? '{}');
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth: auth as any });
    const spreadsheetId = process.env.GOOGLE_SHEETS_ID!;
    const tab = process.env.GOOGLE_SHEETS_TAB_INF ?? 'INF';

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A:AF`,
    });
    const rows = (res.data.values ?? []) as string[][];
    if (rows.length < 2) return [];

    const header = rows[0].map((h) => String(h ?? '').trim().toUpperCase());
    const idxProvincia = header.indexOf('PROVINCIA');
    const idxCodigo = header.indexOf('CODIGO DE RECINTO');
    const idxLocalidad = header.indexOf('LOCALIDAD');
    const idxEstado = header.indexOf('FALLO');

    const out: SheetEnlaceRow[] = [];
    for (const row of rows.slice(1)) {
      const provincia = (row[idxProvincia] ?? '').toString().trim().toUpperCase();
      if (provincia !== 'IMBABURA') continue;

      const codigoRecinto = (row[idxCodigo] ?? '').toString().trim();
      if (!codigoRecinto) continue;

      const estadoTexto = (row[idxEstado] ?? '').toString().trim().toUpperCase();
      out.push({
        codigoRecinto,
        nombreRecinto: (row[idxLocalidad] ?? '').toString().trim(),
        estado: estadoTexto === 'ACTIVO' ? 'ACTIVO' : 'FALLO',
      });
    }
    return out;
  }
}
```

- [x] **Step 5: Correr el test para verificar que pasa**

Run: `pnpm --filter @cne/api test -- sheets-enlaces.client.spec.ts`
Expected: PASS (3/3).

- [x] **Step 6: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/enlaces/sheets-enlaces.client.ts apps/api/src/enlaces/sheets-enlaces.client.spec.ts
git commit -m "feat(api): cliente de lectura de la hoja de enlaces (Google Sheets)"
```

---

### Task 6: `NotificationsService.encolarEnlaceCaido`

**Files:**
- Modify: `apps/api/src/notifications/notifications.service.ts`
- Modify: `apps/api/src/notifications/notifications.service.spec.ts`

**Interfaces:**
- Consumes: `this.prisma.usuario.findMany`, `this.prisma.notificacion.createMany` (ya usados en el archivo).
- Produces: `NotificationsService.encolarEnlaceCaido(opts: { codigoRecinto: string; nombreRecinto: string }): Promise<void>`. Consumido por `EnlacesService` (Task 7).

- [x] **Step 1: Escribir el test que falla**

En `apps/api/src/notifications/notifications.service.spec.ts`, agregar (después del bloque `describe('encolar* (supervisor + admins)', ...)`, antes de `describe('listMine', ...)`):

```ts

  describe('encolarEnlaceCaido', () => {
    it('encola PUSH para cada usuario activo con rol ADMINISTRADOR o TECNICO_SUPERVISOR', async () => {
      prisma.usuario.findMany.mockResolvedValueOnce([{ id: adminId }, { id: supervisorId }]);

      await service.encolarEnlaceCaido({ codigoRecinto: '978', nombreRecinto: 'Escuela Central' });

      expect(prisma.usuario.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            activo: true,
            roles: { some: { rol: { nombre: { in: ['ADMINISTRADOR', 'TECNICO_SUPERVISOR'] } } } },
          },
        }),
      );
      expect(prisma.notificacion.createMany).toHaveBeenCalledTimes(1);
      const filas = prisma.notificacion.createMany.mock.calls[0][0].data;
      expect(filas).toHaveLength(2);
      expect(filas.every((f: any) => f.tipoEvento === 'ENLACE_CAIDO' && f.canal === 'PUSH')).toBe(true);
      expect(filas[0].payload).toEqual({ codigoRecinto: '978', nombreRecinto: 'Escuela Central' });
    });

    it('no encola nada si no hay destinatarios', async () => {
      prisma.usuario.findMany.mockResolvedValueOnce([]);

      await service.encolarEnlaceCaido({ codigoRecinto: '978', nombreRecinto: 'Escuela Central' });

      expect(prisma.notificacion.createMany).not.toHaveBeenCalled();
    });
  });
```

- [x] **Step 2: Correr el test para verificar que falla**

Run: `pnpm --filter @cne/api test -- notifications.service.spec.ts`
Expected: FAIL — `encolarEnlaceCaido` no existe en `NotificationsService`.

- [x] **Step 3: Implementar el método**

En `apps/api/src/notifications/notifications.service.ts`, agregar después de `encolarAlerta` (línea 112, antes de `private async encolarParaSupervisorYAdmins`):

```ts

  /** Enlaces caídos: avisa a todos los ADMINISTRADOR y TECNICO_SUPERVISOR activos. */
  async encolarEnlaceCaido(opts: { codigoRecinto: string; nombreRecinto: string }): Promise<void> {
    const usuarios = await this.prisma.usuario.findMany({
      where: {
        activo: true,
        roles: { some: { rol: { nombre: { in: ['ADMINISTRADOR', 'TECNICO_SUPERVISOR'] } } } },
      },
      select: { id: true },
    });
    if (usuarios.length === 0) return;

    await this.prisma.notificacion.createMany({
      data: usuarios.map((u) => ({
        usuarioId: u.id,
        tipoEvento: 'ENLACE_CAIDO',
        canal: 'PUSH' as const,
        payload: { codigoRecinto: opts.codigoRecinto, nombreRecinto: opts.nombreRecinto } as any,
      })),
    });
  }
```

- [x] **Step 4: Correr el test para verificar que pasa**

Run: `pnpm --filter @cne/api test -- notifications.service.spec.ts`
Expected: PASS (todos los tests, incluidos los 2 nuevos).

- [x] **Step 5: Commit**

```bash
git add apps/api/src/notifications/notifications.service.ts apps/api/src/notifications/notifications.service.spec.ts
git commit -m "feat(api): encolar aviso in-app de enlace caido para admin y supervisor"
```

---

### Task 7: `EnlacesService` (núcleo: cron, diff, notificar, config)

**Files:**
- Create: `apps/api/src/enlaces/enlaces.service.ts`
- Create: `apps/api/src/enlaces/enlaces.service.spec.ts`

**Interfaces:**
- Consumes: `SheetsEnlacesClient.leerEnlacesImbabura()` (Task 5), `INotifier.sendEnlaceCaido()` (Task 3, vía `resolveNotifier()` de `../auth/notifier`), `TelegramNotifier.enviarEnlaceCaido()` (Task 4), `NotificationsService.encolarEnlaceCaido()` (Task 6).
- Produces: `EnlacesService.revisarEnlaces(): Promise<void>` (cron), `list(): Promise<EnlaceRecinto[]>`, `getConfig(): Promise<ConfigEnlacesResponse>`, `addCorreo(correo: string): Promise<ConfigEnlacesResponse>`, `removeCorreo(correo: string): Promise<ConfigEnlacesResponse>`. Consumido por `EnlacesController` (Task 8).

- [x] **Step 1: Escribir los tests que fallan**

Crear `apps/api/src/enlaces/enlaces.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { EnlacesService } from './enlaces.service';
import { PrismaService } from '../db/prisma.service';
import { SheetsEnlacesClient } from './sheets-enlaces.client';
import { TelegramNotifier } from './telegram-notifier';
import { NotificationsService } from '../notifications/notifications.service';

jest.mock('../auth/notifier', () => ({
  resolveNotifier: () => ({ sendEnlaceCaido: jest.fn().mockResolvedValue(undefined) }),
}));

describe('EnlacesService', () => {
  let service: EnlacesService;

  const prisma = {
    enlaceRecinto: { findUnique: jest.fn(), upsert: jest.fn(), findMany: jest.fn() },
    configEnlaces: { findUnique: jest.fn(), upsert: jest.fn() },
  };
  const sheetsClient = { leerEnlacesImbabura: jest.fn() };
  const telegram = { enviarEnlaceCaido: jest.fn().mockResolvedValue(undefined) };
  const notifications = { encolarEnlaceCaido: jest.fn().mockResolvedValue(undefined) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        EnlacesService,
        { provide: PrismaService, useValue: prisma },
        { provide: SheetsEnlacesClient, useValue: sheetsClient },
        { provide: TelegramNotifier, useValue: telegram },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = moduleRef.get(EnlacesService);
  });

  describe('revisarEnlaces', () => {
    it('notifica cuando un enlace pasa de ACTIVO a FALLO', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ codigoRecinto: '978', estado: 'ACTIVO' });
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: ['a@b.com'] });

      await service.revisarEnlaces();

      expect(prisma.enlaceRecinto.upsert).toHaveBeenCalledTimes(1);
      expect(telegram.enviarEnlaceCaido).toHaveBeenCalledWith('978', 'Escuela Central');
      expect(notifications.encolarEnlaceCaido).toHaveBeenCalledWith({
        codigoRecinto: '978',
        nombreRecinto: 'Escuela Central',
      });
    });

    it('NO notifica si el enlace sigue FALLO (ya estaba caído)', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ codigoRecinto: '978', estado: 'FALLO' });

      await service.revisarEnlaces();

      expect(telegram.enviarEnlaceCaido).not.toHaveBeenCalled();
      expect(notifications.encolarEnlaceCaido).not.toHaveBeenCalled();
    });

    it('NO notifica en la primera carga de un enlace ya FALLO (sin estado anterior)', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue(null);

      await service.revisarEnlaces();

      expect(telegram.enviarEnlaceCaido).not.toHaveBeenCalled();
      expect(notifications.encolarEnlaceCaido).not.toHaveBeenCalled();
    });

    it('si falla la lectura de la hoja, no toca la tabla ni notifica', async () => {
      sheetsClient.leerEnlacesImbabura.mockRejectedValue(new Error('cuota excedida'));

      await service.revisarEnlaces();

      expect(prisma.enlaceRecinto.upsert).not.toHaveBeenCalled();
      expect(telegram.enviarEnlaceCaido).not.toHaveBeenCalled();
    });

    it('un fallo en Telegram no impide encolar el aviso in-app', async () => {
      sheetsClient.leerEnlacesImbabura.mockResolvedValue([
        { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO' },
      ]);
      prisma.enlaceRecinto.findUnique.mockResolvedValue({ codigoRecinto: '978', estado: 'ACTIVO' });
      prisma.configEnlaces.findUnique.mockResolvedValue({ correos: [] });
      telegram.enviarEnlaceCaido.mockRejectedValueOnce(new Error('telegram caído'));

      await service.revisarEnlaces();

      expect(notifications.encolarEnlaceCaido).toHaveBeenCalled();
    });
  });

  describe('config de correos', () => {
    it('addCorreo agrega un correo sin duplicar', async () => {
      prisma.configEnlaces.findUnique.mockResolvedValue({ id: 1, correos: ['a@b.com'], chatIdTelegram: null });
      prisma.configEnlaces.upsert.mockResolvedValue({ id: 1, correos: ['a@b.com', 'c@d.com'], chatIdTelegram: null });

      const result = await service.addCorreo('c@d.com');

      expect(prisma.configEnlaces.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ correos: ['a@b.com', 'c@d.com'] }),
          update: expect.objectContaining({ correos: ['a@b.com', 'c@d.com'] }),
        }),
      );
      expect(result.correos).toEqual(['a@b.com', 'c@d.com']);
    });

    it('removeCorreo quita un correo existente', async () => {
      prisma.configEnlaces.findUnique.mockResolvedValue({ id: 1, correos: ['a@b.com', 'c@d.com'], chatIdTelegram: null });
      prisma.configEnlaces.upsert.mockResolvedValue({ id: 1, correos: ['c@d.com'], chatIdTelegram: null });

      const result = await service.removeCorreo('a@b.com');

      expect(prisma.configEnlaces.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: expect.objectContaining({ correos: ['c@d.com'] }) }),
      );
      expect(result.correos).toEqual(['c@d.com']);
    });
  });
});
```

- [x] **Step 2: Correr los tests para verificar que fallan**

Run: `pnpm --filter @cne/api test -- enlaces.service.spec.ts`
Expected: FAIL — el módulo `./enlaces.service` no existe.

- [x] **Step 3: Implementar `EnlacesService`**

Crear `apps/api/src/enlaces/enlaces.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { ConfigEnlacesResponse, EnlaceRecinto } from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { resolveNotifier } from '../auth/notifier';
import { SheetsEnlacesClient } from './sheets-enlaces.client';
import { TelegramNotifier } from './telegram-notifier';
import { NotificationsService } from '../notifications/notifications.service';

const CONFIG_ID = 1;

@Injectable()
export class EnlacesService {
  private readonly log = new Logger('EnlacesService');
  private readonly notifier = resolveNotifier();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sheetsClient: SheetsEnlacesClient,
    private readonly telegram: TelegramNotifier,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async revisarEnlaces(): Promise<void> {
    let filas: Awaited<ReturnType<SheetsEnlacesClient['leerEnlacesImbabura']>>;
    try {
      filas = await this.sheetsClient.leerEnlacesImbabura();
    } catch (e) {
      this.log.error(`No se pudo leer la hoja de enlaces — se mantiene el último estado conocido: ${e}`);
      return;
    }

    for (const fila of filas) {
      const anterior = await this.prisma.enlaceRecinto.findUnique({
        where: { codigoRecinto: fila.codigoRecinto },
      });

      await this.prisma.enlaceRecinto.upsert({
        where: { codigoRecinto: fila.codigoRecinto },
        create: {
          codigoRecinto: fila.codigoRecinto,
          nombreRecinto: fila.nombreRecinto,
          estado: fila.estado,
          estadoAnterior: null,
        },
        update: {
          nombreRecinto: fila.nombreRecinto,
          estado: fila.estado,
          estadoAnterior: anterior?.estado ?? null,
        },
      });

      const cayoAhora = anterior?.estado === 'ACTIVO' && fila.estado === 'FALLO';
      if (cayoAhora) {
        await this.notificarCaida(fila.codigoRecinto, fila.nombreRecinto);
      }
    }
  }

  private async notificarCaida(codigoRecinto: string, nombreRecinto: string): Promise<void> {
    const config = await this.prisma.configEnlaces.findUnique({ where: { id: CONFIG_ID } });
    const correos = config?.correos ?? [];
    if (correos.length > 0) {
      try {
        await this.notifier.sendEnlaceCaido(correos, codigoRecinto, nombreRecinto);
      } catch (e) {
        this.log.error(`Error enviando correo de enlace caído (${codigoRecinto}): ${e}`);
      }
    }

    try {
      await this.telegram.enviarEnlaceCaido(codigoRecinto, nombreRecinto);
    } catch (e) {
      this.log.error(`Error enviando Telegram de enlace caído (${codigoRecinto}): ${e}`);
    }

    try {
      await this.notifications.encolarEnlaceCaido({ codigoRecinto, nombreRecinto });
    } catch (e) {
      this.log.error(`Error encolando aviso in-app de enlace caído (${codigoRecinto}): ${e}`);
    }
  }

  async list(): Promise<EnlaceRecinto[]> {
    const rows = await this.prisma.enlaceRecinto.findMany({ orderBy: { codigoRecinto: 'asc' } });
    return rows.map((r: any) => ({
      codigoRecinto: r.codigoRecinto,
      nombreRecinto: r.nombreRecinto,
      estado: r.estado,
      actualizadoEn: r.actualizadoEn.toISOString(),
    }));
  }

  async getConfig(): Promise<ConfigEnlacesResponse> {
    const config = await this.prisma.configEnlaces.findUnique({ where: { id: CONFIG_ID } });
    return { correos: config?.correos ?? [], chatIdTelegram: config?.chatIdTelegram ?? null };
  }

  async addCorreo(correo: string): Promise<ConfigEnlacesResponse> {
    const actual = await this.getConfig();
    const correos = actual.correos.includes(correo) ? actual.correos : [...actual.correos, correo];
    return this.guardarCorreos(correos);
  }

  async removeCorreo(correo: string): Promise<ConfigEnlacesResponse> {
    const actual = await this.getConfig();
    const correos = actual.correos.filter((c) => c !== correo);
    return this.guardarCorreos(correos);
  }

  private async guardarCorreos(correos: string[]): Promise<ConfigEnlacesResponse> {
    const saved = await this.prisma.configEnlaces.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID, correos },
      update: { correos },
    });
    return { correos: saved.correos, chatIdTelegram: saved.chatIdTelegram ?? null };
  }
}
```

- [x] **Step 4: Correr los tests para verificar que pasan**

Run: `pnpm --filter @cne/api test -- enlaces.service.spec.ts`
Expected: PASS (9/9).

- [x] **Step 5: Commit**

```bash
git add apps/api/src/enlaces/enlaces.service.ts apps/api/src/enlaces/enlaces.service.spec.ts
git commit -m "feat(api): EnlacesService - cron, deteccion de transicion y notificacion"
```

---

### Task 8: `EnlacesController`, `EnlacesModule` y registro en `app.module.ts`

**Files:**
- Create: `apps/api/src/enlaces/enlaces.controller.ts`
- Create: `apps/api/src/enlaces/enlaces.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `EnlacesService` (Task 7), `addCorreoEnlaceSchema` (Task 2), `ZodValidationPipe`/`Roles`/`JwtAuthGuard`/`RolesGuard` (ya existen en `../common/`).
- Produces: endpoints `GET /enlaces`, `GET /enlaces/config`, `POST /enlaces/config/correos`, `DELETE /enlaces/config/correos` (body `{correo}`). Consumidos por `apps/web/src/lib/queries/enlaces.ts` (Task 9).

No hay test unitario dedicado para el controller — en este proyecto los controllers son delgados y se prueban a través del service (mismo patrón que `AlertasController`, `TrackingController`, etc., ninguno tiene spec propio).

- [ ] **Step 1: Crear el controller**

Crear `apps/api/src/enlaces/enlaces.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AddCorreoEnlaceRequest } from '@cne/shared-types';
import { addCorreoEnlaceSchema } from '@cne/shared-validation';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { ZodValidationPipe } from '../common/zod-body.pipe';
import { EnlacesService } from './enlaces.service';

@ApiTags('enlaces')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('enlaces')
export class EnlacesController {
  constructor(private readonly enlaces: EnlacesService) {}

  @Get()
  @Roles('ADMINISTRADOR', 'TECNICO_SUPERVISOR')
  @ApiOperation({ summary: 'Listar el estado actual de los enlaces de Imbabura' })
  list() {
    return this.enlaces.list();
  }

  @Get('config')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Ver la configuración de correos para avisos de enlaces caídos' })
  getConfig() {
    return this.enlaces.getConfig();
  }

  @Post('config/correos')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Agregar un correo a la lista de avisos de enlaces caídos' })
  addCorreo(@Body(new ZodValidationPipe(addCorreoEnlaceSchema)) body: AddCorreoEnlaceRequest) {
    return this.enlaces.addCorreo(body.correo);
  }

  @Delete('config/correos')
  @Roles('ADMINISTRADOR')
  @ApiOperation({ summary: 'Quitar un correo de la lista de avisos de enlaces caídos' })
  removeCorreo(@Body(new ZodValidationPipe(addCorreoEnlaceSchema)) body: AddCorreoEnlaceRequest) {
    return this.enlaces.removeCorreo(body.correo);
  }
}
```

- [ ] **Step 2: Crear el módulo**

Crear `apps/api/src/enlaces/enlaces.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { EnlacesController } from './enlaces.controller';
import { EnlacesService } from './enlaces.service';
import { SheetsEnlacesClient } from './sheets-enlaces.client';
import { TelegramNotifier } from './telegram-notifier';

@Module({
  imports: [NotificationsModule],
  controllers: [EnlacesController],
  providers: [EnlacesService, SheetsEnlacesClient, TelegramNotifier],
  exports: [EnlacesService],
})
export class EnlacesModule {}
```

- [ ] **Step 3: Registrar el módulo en `app.module.ts`**

En `apps/api/src/app.module.ts`, agregar el import junto a `import { AlertasModule } from './alertas/alertas.module';` (línea 23):

```ts
import { EnlacesModule } from './enlaces/enlaces.module';
```

Y agregar `EnlacesModule` al arreglo `imports`, justo después de `AlertasModule` (línea 69):

```ts
    AlertasModule,
    EnlacesModule,
```

- [ ] **Step 4: Documentar las variables de entorno nuevas**

En `.env.example`, al final del archivo, agregar:

```bash

# --- Alertas de enlaces caídos (CDAs Imbabura) ---
# Cuenta de servicio de Google Cloud con acceso de Lector a la hoja de
# enlaces (Google Sheets API habilitada). Contenido completo del JSON de la
# clave, en una sola línea.
GOOGLE_SHEETS_CREDENTIALS_JSON=
# ID de la hoja (el segmento entre /d/ y /edit en la URL de Google Sheets).
GOOGLE_SHEETS_ID=
# Nombre de la pestaña con el detalle de enlaces. Por defecto "INF".
GOOGLE_SHEETS_TAB_INF=INF

# Bot de Telegram (@BotFather) y chat/grupo donde se envían los avisos de
# enlaces caídos. Si se dejan vacíos, el aviso a Telegram se omite sin error.
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

- [ ] **Step 5: Verificar que el proyecto compila y los tests existentes siguen en verde**

Run: `pnpm --filter @cne/api build`
Expected: sin errores nuevos.

Run: `pnpm --filter @cne/api test`
Expected: todos los tests en verde, incluidos los de `enlaces/*` y `notifications.service.spec.ts`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/enlaces/enlaces.controller.ts apps/api/src/enlaces/enlaces.module.ts apps/api/src/app.module.ts .env.example
git commit -m "feat(api): endpoints de enlaces caidos y registro del modulo"
```

---

### Task 9: Cliente de queries en web

**Files:**
- Create: `apps/web/src/lib/queries/enlaces.ts`

**Interfaces:**
- Consumes: `api` (axios instance, `apps/web/src/lib/api.ts`), tipos `EnlaceRecinto`, `ConfigEnlacesResponse`, `AddCorreoEnlaceRequest` (`@cne/shared-types`, Task 1).
- Produces: `getEnlaces()`, `getConfigEnlaces()`, `addCorreoEnlace(correo: string)`, `removeCorreoEnlace(correo: string)`. Consumido por `EnlacesPage.tsx` (Task 10).

- [ ] **Step 1: Crear el archivo de queries**

Crear `apps/web/src/lib/queries/enlaces.ts`:

```ts
import type { ConfigEnlacesResponse, EnlaceRecinto } from '@cne/shared-types';
import { api } from '../api';

export async function getEnlaces(): Promise<EnlaceRecinto[]> {
  const { data } = await api.get<EnlaceRecinto[]>('/enlaces');
  return data;
}

export async function getConfigEnlaces(): Promise<ConfigEnlacesResponse> {
  const { data } = await api.get<ConfigEnlacesResponse>('/enlaces/config');
  return data;
}

export async function addCorreoEnlace(correo: string): Promise<ConfigEnlacesResponse> {
  const { data } = await api.post<ConfigEnlacesResponse>('/enlaces/config/correos', { correo });
  return data;
}

export async function removeCorreoEnlace(correo: string): Promise<ConfigEnlacesResponse> {
  const { data } = await api.delete<ConfigEnlacesResponse>('/enlaces/config/correos', { data: { correo } });
  return data;
}
```

- [ ] **Step 2: Verificar que compila**

Run: `pnpm --filter @cne/web build`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/queries/enlaces.ts
git commit -m "feat(web): cliente de queries para enlaces caidos"
```

---

### Task 10: `EnlacesPage.tsx`, ruta y navegación

**Files:**
- Create: `apps/web/src/pages/enlaces/EnlacesPage.tsx`
- Create: `apps/web/src/pages/enlaces/EnlacesPage.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/Layout.tsx`

**Interfaces:**
- Consumes: `getEnlaces`, `getConfigEnlaces`, `addCorreoEnlace`, `removeCorreoEnlace` (Task 9).

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/web/src/pages/enlaces/EnlacesPage.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ConfigEnlacesResponse, EnlaceRecinto } from '@cne/shared-types';

import { EnlacesPage } from './EnlacesPage';
import { api } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('sileo', () => ({ sileo: { success: vi.fn(), error: vi.fn() } }));

const apiGetMock = api.get as unknown as ReturnType<typeof vi.fn>;
const apiPostMock = api.post as unknown as ReturnType<typeof vi.fn>;

const enlaces: EnlaceRecinto[] = [
  { codigoRecinto: '978', nombreRecinto: 'Escuela Central', estado: 'FALLO', actualizadoEn: '2026-09-23T11:00:00.000Z' },
  { codigoRecinto: '982', nombreRecinto: 'Unidad Educativa Zaldumbide', estado: 'ACTIVO', actualizadoEn: '2026-09-23T11:00:00.000Z' },
];

const config: ConfigEnlacesResponse = { correos: ['admin@cne.gob.ec'], chatIdTelegram: null };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EnlacesPage />
    </QueryClientProvider>,
  );
}

describe('EnlacesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiGetMock.mockImplementation((url: string) => {
      if (url === '/enlaces') return Promise.resolve({ data: enlaces });
      if (url === '/enlaces/config') return Promise.resolve({ data: config });
      return Promise.resolve({ data: [] });
    });
  });

  it('lista los enlaces con su estado', async () => {
    renderPage();

    expect(await screen.findByText('Escuela Central')).toBeInTheDocument();
    expect(screen.getByText('Unidad Educativa Zaldumbide')).toBeInTheDocument();
    expect(screen.getByText('FALLO')).toBeInTheDocument();
    expect(screen.getByText('ACTIVO')).toBeInTheDocument();
  });

  it('lista los correos configurados y permite agregar uno nuevo', async () => {
    const user = userEvent.setup();
    apiPostMock.mockResolvedValue({ data: { correos: ['admin@cne.gob.ec', 'nuevo@cne.gob.ec'], chatIdTelegram: null } });
    renderPage();

    expect(await screen.findByText('admin@cne.gob.ec')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Nuevo correo'), 'nuevo@cne.gob.ec');
    await user.click(screen.getByText('Agregar'));

    expect(apiPostMock).toHaveBeenCalledWith('/enlaces/config/correos', { correo: 'nuevo@cne.gob.ec' });
    expect(await screen.findByText('nuevo@cne.gob.ec')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm --filter @cne/web test -- EnlacesPage.test.tsx`
Expected: FAIL — `./EnlacesPage` no existe.

- [ ] **Step 3: Implementar `EnlacesPage.tsx`**

Crear `apps/web/src/pages/enlaces/EnlacesPage.tsx`:

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { sileo } from 'sileo';
import type { EnlaceRecinto } from '@cne/shared-types';
import { addCorreoEnlace, getConfigEnlaces, getEnlaces, removeCorreoEnlace } from '../../lib/queries/enlaces';
import { formatearFechaHora } from '../../lib/notifications';

const ESTADO_COLOR: Record<EnlaceRecinto['estado'], string> = {
  ACTIVO: '#16a34a',
  FALLO: '#ef4444',
};

export function EnlacesPage() {
  const qc = useQueryClient();
  const [nuevoCorreo, setNuevoCorreo] = useState('');

  const { data: enlaces = [], isLoading } = useQuery({
    queryKey: ['enlaces'],
    queryFn: getEnlaces,
  });

  const { data: config } = useQuery({
    queryKey: ['enlaces-config'],
    queryFn: getConfigEnlaces,
  });

  const agregar = useMutation({
    mutationFn: (correo: string) => addCorreoEnlace(correo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enlaces-config'] });
      setNuevoCorreo('');
      sileo.success({ title: 'Correo agregado' });
    },
    onError: (e: any) => {
      sileo.error({ title: e?.response?.data?.message ?? 'No se pudo agregar el correo' });
    },
  });

  const quitar = useMutation({
    mutationFn: (correo: string) => removeCorreoEnlace(correo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['enlaces-config'] });
      sileo.success({ title: 'Correo eliminado' });
    },
    onError: (e: any) => {
      sileo.error({ title: e?.response?.data?.message ?? 'No se pudo eliminar el correo' });
    },
  });

  return (
    <>
      <h2>Enlaces (CDAs Imbabura)</h2>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Correos que reciben el aviso de enlace caído</h3>
        <ul style={{ paddingLeft: '1.1rem' }}>
          {(config?.correos ?? []).map((correo) => (
            <li key={correo} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
              {correo}
              <button
                className="btn secondary"
                disabled={quitar.isPending}
                onClick={() => quitar.mutate(correo)}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <label style={{ display: 'none' }} htmlFor="nuevo-correo-enlace">Nuevo correo</label>
          <input
            id="nuevo-correo-enlace"
            aria-label="Nuevo correo"
            type="email"
            value={nuevoCorreo}
            onChange={(e) => setNuevoCorreo(e.target.value)}
            placeholder="correo@cne.gob.ec"
            style={{ padding: '0.5rem 0.65rem', border: '1px solid #d1d5db', borderRadius: 6, fontSize: '0.9rem', flex: 1 }}
          />
          <button
            className="btn"
            disabled={!nuevoCorreo || agregar.isPending}
            onClick={() => agregar.mutate(nuevoCorreo)}
          >
            Agregar
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="muted">Cargando enlaces…</p>
      ) : enlaces.length === 0 ? (
        <p className="muted" style={{ textAlign: 'center', padding: '2rem 0' }}>
          No hay enlaces registrados todavía. Se completan en la primera revisión automática.
        </p>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Recinto</th>
                <th>Estado</th>
                <th>Actualizado</th>
              </tr>
            </thead>
            <tbody>
              {enlaces.map((e) => (
                <tr key={e.codigoRecinto}>
                  <td style={{ whiteSpace: 'nowrap' }}>{e.codigoRecinto}</td>
                  <td>{e.nombreRecinto}</td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: ESTADO_COLOR[e.estado], display: 'inline-block' }} />
                      {e.estado}
                    </span>
                  </td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: '0.85rem' }}>{formatearFechaHora(e.actualizadoEn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `pnpm --filter @cne/web test -- EnlacesPage.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 5: Agregar la ruta**

En `apps/web/src/App.tsx`, agregar el import junto a `import { AlertasPage } from './pages/alertas/AlertasPage';` (línea 19):

```ts
import { EnlacesPage } from './pages/enlaces/EnlacesPage';
```

Y agregar la ruta después del bloque de `/alertas` (después de línea 102, antes del comentario `{/* Reporte admin de NO-CDAs pendientes */}`):

```tsx

        {/* Enlaces caídos (CDAs Imbabura) — solo Administrador */}
        <Route
          path="/enlaces"
          element={
            <ProtectedRoute roles={['ADMINISTRADOR']}>
              <EnlacesPage />
            </ProtectedRoute>
          }
        />
```

- [ ] **Step 6: Agregar el enlace de navegación**

En `apps/web/src/pages/Layout.tsx`, agregar después de `puedeVerAlertas` (línea 14):

```ts
  const puedeVerEnlaces = user?.roles.includes('ADMINISTRADOR') ?? false;
```

Y agregar el `NavLink` después del bloque de `/alertas` (después de línea 53, antes de `{puedeVerReportes && (`):

```tsx
        {puedeVerEnlaces && (
          <NavLink to="/enlaces" className={({ isActive }) => (isActive ? 'active' : '')}>
            Enlaces
          </NavLink>
        )}
```

- [ ] **Step 7: Verificar que el proyecto compila y los tests existentes siguen en verde**

Run: `pnpm --filter @cne/web build`
Expected: sin errores.

Run: `pnpm --filter @cne/web test`
Expected: todos los tests en verde, incluido `Layout.test.tsx` y `App.test.tsx`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/enlaces apps/web/src/App.tsx apps/web/src/pages/Layout.tsx
git commit -m "feat(web): pagina de enlaces caidos, ruta y navegacion"
```

---

### Task 11: Aviso emergente en la web (toast al llegar `ENLACE_CAIDO`)

**Files:**
- Modify: `apps/web/src/lib/notifications.ts`
- Modify: `apps/web/src/lib/notifications.test.ts`
- Modify: `apps/web/src/components/NotificationsBell.tsx`
- Modify: `apps/web/src/components/NotificationsBell.test.tsx`

**Interfaces:**
- Consumes: `sileo` (ya usado en `AlertasPage.tsx`).
- Produces: `describirNotificacion` reconoce `ENLACE_CAIDO`; `NotificationsBell` dispara `sileo.error` una sola vez por notificación nueva de ese tipo.

- [ ] **Step 1: Escribir el test que falla para `describirNotificacion`**

En `apps/web/src/lib/notifications.test.ts`, agregar un caso para `ENLACE_CAIDO` (seguir el patrón de los casos existentes de `SALIDA_DPI`/`LLEGADA_RECINTO` en ese archivo — mismo `describe`, agregar):

```ts

  it('describe ENLACE_CAIDO con codigo y nombre del recinto', () => {
    const n = {
      id: 'n1',
      tipoEvento: 'ENLACE_CAIDO',
      canal: 'PUSH' as const,
      payload: { codigoRecinto: '978', nombreRecinto: 'Escuela Central' },
      creadoEn: '2026-09-23T11:00:00.000Z',
      leidaEn: null,
    };
    expect(describirNotificacion(n)).toBe('Enlace caído: 978 — Escuela Central');
  });
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm --filter @cne/web test -- notifications.test.ts`
Expected: FAIL — el `case 'ENLACE_CAIDO'` no existe, cae al `default` y devuelve `'ENLACE_CAIDO'` en vez del texto esperado.

- [ ] **Step 3: Implementar el caso en `describirNotificacion`**

En `apps/web/src/lib/notifications.ts`, agregar un `case` al `switch` de `describirNotificacion` (después de `case 'LLEGADA_DPI':`, línea 49-50):

```ts

    case 'ENLACE_CAIDO': {
      const codigo = (p.codigoRecinto as string) ?? '';
      const nombre = (p.nombreRecinto as string) ?? recinto;
      return `Enlace caído: ${codigo} — ${nombre}`;
    }
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `pnpm --filter @cne/web test -- notifications.test.ts`
Expected: PASS.

- [ ] **Step 5: Escribir el test que falla para el toast**

`apps/web/src/components/NotificationsBell.test.tsx` ya mockea `../lib/api` con `apiGetMock` (línea 10-14) y tiene un helper `item(id, creadoEn)` (línea 17-26) y `renderBell()` (línea 28-35) — no mockea `sileo` todavía. Agregar el mock de `sileo` junto al mock existente de `../lib/api` (línea 10-12):

```ts
vi.mock('sileo', () => ({ sileo: { error: vi.fn() } }));
```

Y agregar el import correspondiente después de `import { api } from '../lib/api';` (línea 8):

```ts
import { sileo } from 'sileo';

const sileoErrorMock = sileo.error as unknown as ReturnType<typeof vi.fn>;
```

Luego agregar un nuevo `describe` al final del archivo (después del `describe('NotificationsBell — paginación', ...)`, después de línea 149):

```ts

describe('NotificationsBell — aviso de enlace caído', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('muestra un toast la primera vez que llega una notificación ENLACE_CAIDO no leída', async () => {
    apiGetMock.mockResolvedValue({
      data: {
        items: [
          {
            id: 'n1',
            tipoEvento: 'ENLACE_CAIDO',
            canal: 'PUSH',
            payload: { codigoRecinto: '978', nombreRecinto: 'Escuela Central' },
            creadoEn: '2026-09-23T11:00:00.000Z',
            leidaEn: null,
          },
        ],
        total: 1,
        noLeidas: 1,
      },
    });

    renderBell();

    await waitFor(() => {
      expect(sileoErrorMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining('978') }),
      );
    });
  });

  it('no repite el toast en un segundo polling de la misma notificación', async () => {
    apiGetMock.mockResolvedValue({
      data: {
        items: [
          {
            id: 'n1',
            tipoEvento: 'ENLACE_CAIDO',
            canal: 'PUSH',
            payload: { codigoRecinto: '978', nombreRecinto: 'Escuela Central' },
            creadoEn: '2026-09-23T11:00:00.000Z',
            leidaEn: null,
          },
        ],
        total: 1,
        noLeidas: 1,
      },
    });

    renderBell();
    await waitFor(() => expect(sileoErrorMock).toHaveBeenCalledTimes(1));

    apiGetMock.mockResolvedValue({
      data: {
        items: [
          {
            id: 'n1',
            tipoEvento: 'ENLACE_CAIDO',
            canal: 'PUSH',
            payload: { codigoRecinto: '978', nombreRecinto: 'Escuela Central' },
            creadoEn: '2026-09-23T11:00:00.000Z',
            leidaEn: null,
          },
        ],
        total: 1,
        noLeidas: 1,
      },
    });
    await user.click(screen.getByLabelText('Notificaciones'));
    await user.click(screen.getByLabelText('Notificaciones'));

    expect(sileoErrorMock).toHaveBeenCalledTimes(1);
  });
});
```

En el segundo test, agregar `const user = userEvent.setup();` como primera línea del `it` (ya que `userEvent` se importa al inicio del archivo, línea 3).

- [ ] **Step 6: Correr el test para verificar que falla**

Run: `pnpm --filter @cne/web test -- NotificationsBell.test.tsx`
Expected: FAIL — no se llama a `sileo.error`.

- [ ] **Step 7: Implementar el disparo del toast**

En `apps/web/src/components/NotificationsBell.tsx`, agregar el import (línea 1-12, junto a los demás imports):

```ts
import { sileo } from 'sileo';
```

Agregar un `ref` para recordar qué notificaciones ya se mostraron como toast (después de `const openRef = useRef(open);` bloque, línea 33-36):

```ts

  const avisadasRef = useRef<Set<string>>(new Set());
```

Y agregar un nuevo `useEffect` después del `useEffect` que sincroniza `data` en `items` (después de línea 51):

```ts

  useEffect(() => {
    if (!data) return;
    for (const n of data.items) {
      if (n.tipoEvento !== 'ENLACE_CAIDO' || n.leidaEn || avisadasRef.current.has(n.id)) continue;
      avisadasRef.current.add(n.id);
      sileo.error({ title: describirNotificacion(n) });
    }
  }, [data]);
```

- [ ] **Step 8: Correr el test para verificar que pasa**

Run: `pnpm --filter @cne/web test -- NotificationsBell.test.tsx`
Expected: PASS.

- [ ] **Step 9: Correr toda la suite de web**

Run: `pnpm --filter @cne/web test`
Expected: todos los tests en verde.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/notifications.ts apps/web/src/lib/notifications.test.ts apps/web/src/components/NotificationsBell.tsx apps/web/src/components/NotificationsBell.test.tsx
git commit -m "feat(web): aviso emergente al recibir una notificacion de enlace caido"
```

---

### Task 12: Aviso emergente en móvil (`Alert.alert` al llegar `ENLACE_CAIDO`)

**Files:**
- Modify: `apps/mobile/src/lib/notifications.ts`
- Modify: `apps/mobile/src/lib/notifications.test.ts`
- Modify: `apps/mobile/src/components/AppBar.tsx`
- Modify (o crear si no existe): `apps/mobile/src/components/AppBar.test.tsx`

**Interfaces:**
- Produces: `describirNotificacion` (móvil) reconoce `ENLACE_CAIDO` igual que la versión web; `AppBar` dispara `Alert.alert` una sola vez por notificación nueva de ese tipo.

- [ ] **Step 1: Escribir el test que falla para `describirNotificacion`**

En `apps/mobile/src/lib/notifications.test.ts`, agregar (mismo caso que en Task 11, adaptado al `describe` existente de ese archivo):

```ts

  it('describe ENLACE_CAIDO con codigo y nombre del recinto', () => {
    const n = {
      id: 'n1',
      tipoEvento: 'ENLACE_CAIDO',
      canal: 'PUSH' as const,
      payload: { codigoRecinto: '978', nombreRecinto: 'Escuela Central' },
      creadoEn: '2026-09-23T11:00:00.000Z',
      leidaEn: null,
    };
    expect(describirNotificacion(n)).toBe('Enlace caído: 978 — Escuela Central');
  });
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `pnpm --filter @cne/mobile test -- notifications.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar el caso (idéntico a Task 11, Step 3)**

En `apps/mobile/src/lib/notifications.ts`, agregar el mismo `case` que en la web, después de `case 'LLEGADA_DPI':` (línea 49-50):

```ts

    case 'ENLACE_CAIDO': {
      const codigo = (p.codigoRecinto as string) ?? '';
      const nombre = (p.nombreRecinto as string) ?? recinto;
      return `Enlace caído: ${codigo} — ${nombre}`;
    }
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `pnpm --filter @cne/mobile test -- notifications.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificar si existe test de `AppBar` y escribir el caso que falla**

Run: `ls apps/mobile/src/components/AppBar.test.tsx`

Si no existe, crear `apps/mobile/src/components/AppBar.test.tsx` siguiendo el patrón de mocks de `apps/mobile/src/components/ErrorBoundary.test.tsx` (mock de `../theme/ThemeContext` con Proxy) y de `apps/mobile/src/lib/useMiAsignacion.test.tsx` (mock de `getMisNotificaciones`, `act`/`create` de `react-test-renderer`). Agregar (o crear el archivo con) el caso:

```tsx
import { act, create } from 'react-test-renderer';
import { Alert } from 'react-native';

jest.mock('../lib/notifications', () => ({
  getMisNotificaciones: jest.fn(),
  marcarNotificacionLeida: jest.fn(),
  describirNotificacion: jest.requireActual('../lib/notifications').describirNotificacion,
  formatearFechaHora: jest.requireActual('../lib/notifications').formatearFechaHora,
}));
jest.mock('../lib/offline-queue', () => ({ usePendingCount: () => 0 }));
jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { roles: ['ADMINISTRADOR'] } }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../theme/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'light',
    toggle: jest.fn(),
    colors: new Proxy({}, { get: () => '#000' }),
  }),
}));
// Se aíslan los demás hijos de AppBar (no son objeto de este test) para que
// sus propias dependencias no compliquen este test.
jest.mock('./Logo', () => ({ Logo: () => null }));
jest.mock('./MiRecintoModal', () => ({ MiRecintoModal: () => null }));
jest.mock('./ReportarIncidenciaModal', () => ({ ReportarIncidenciaModal: () => null }));
jest.mock('./NotificacionesModal', () => ({ NotificacionesModal: () => null }));

import { AppBar } from './AppBar';
import { getMisNotificaciones } from '../lib/notifications';

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe('AppBar — aviso de enlace caído', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it('muestra Alert.alert la primera vez que llega una notificación ENLACE_CAIDO no leída', async () => {
    (getMisNotificaciones as jest.Mock).mockResolvedValue({
      items: [
        {
          id: 'n1',
          tipoEvento: 'ENLACE_CAIDO',
          canal: 'PUSH',
          payload: { codigoRecinto: '978', nombreRecinto: 'Escuela Central' },
          creadoEn: '2026-09-23T11:00:00.000Z',
          leidaEn: null,
        },
      ],
      total: 1,
      noLeidas: 1,
    });

    await act(async () => {
      create(<AppBar />);
      await flushPromises();
    });

    expect(Alert.alert).toHaveBeenCalledWith('Enlace caído', expect.stringContaining('978'));
  });
});
```

- [ ] **Step 6: Correr el test para verificar que falla**

Run: `pnpm --filter @cne/mobile test -- AppBar.test.tsx`
Expected: FAIL — `Alert.alert` no se llama.

- [ ] **Step 7: Implementar el disparo de `Alert.alert`**

En `apps/mobile/src/components/AppBar.tsx`, agregar `Alert` al import de `react-native` (línea 2):

```ts
import { Alert, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
```

Agregar el import de `describirNotificacion` (línea 10):

```ts
import { describirNotificacion, getMisNotificaciones, marcarNotificacionLeida } from '../lib/notifications';
```

Agregar un `ref` para recordar qué notificaciones ya se mostraron (después de `const spin = useRef(new Animated.Value(0)).current;`, línea 41):

```ts
  const avisadasRef = useRef<Set<string>>(new Set());
```

Y en el `useEffect` de polling (línea 43-67), dentro del `.then((d) => { ... })` (línea 52-58), agregar antes de `setPageNotifs(1);`:

```ts

          for (const n of d.items) {
            if (n.tipoEvento !== 'ENLACE_CAIDO' || n.leidaEn || avisadasRef.current.has(n.id)) continue;
            avisadasRef.current.add(n.id);
            Alert.alert('Enlace caído', describirNotificacion(n));
          }
```

- [ ] **Step 8: Correr el test para verificar que pasa**

Run: `pnpm --filter @cne/mobile test -- AppBar.test.tsx`
Expected: PASS.

- [ ] **Step 9: Correr toda la suite de móvil**

Run: `pnpm --filter @cne/mobile test`
Expected: todos los tests en verde.

- [ ] **Step 10: Commit**

```bash
git add apps/mobile/src/lib/notifications.ts apps/mobile/src/lib/notifications.test.ts apps/mobile/src/components/AppBar.tsx apps/mobile/src/components/AppBar.test.tsx
git commit -m "feat(mobile): aviso emergente al recibir una notificacion de enlace caido"
```

---

### Task 13: Verificación final e invocación de `revisor-calidad`

**Files:** ninguno nuevo — solo verificación.

- [ ] **Step 1: Suite completa de los 3 paquetes**

Run: `pnpm --filter @cne/api test && pnpm --filter @cne/web test && pnpm --filter @cne/mobile test`
Expected: todo en verde.

- [ ] **Step 2: Build completo**

Run: `pnpm --filter @cne/api build && pnpm --filter @cne/web build && pnpm --filter @cne/mobile build`
Expected: sin errores nuevos (los 2 errores preexistentes de `MonitoreoScreen.test.tsx` en móvil, si siguen ahí, son de una tarea anterior, no de esta).

- [ ] **Step 3: Invocar `revisor-calidad`**

Por instrucción del CLAUDE.md global del usuario: invocar el subagente `revisor-calidad` sobre todos los archivos tocados en este plan (backend `enlaces/*`, `notifier.ts`, `notifications.service.ts`; web `enlaces/*`, `NotificationsBell.tsx`, `notifications.ts`; móvil `AppBar.tsx`, `notifications.ts`) antes de dar la tarea por terminada — revisa especialmente: manejo seguro de la credencial de Google (`GOOGLE_SHEETS_CREDENTIALS_JSON` nunca debe loguearse ni exponerse en respuestas), que el endpoint de configuración de correos solo sea accesible a `ADMINISTRADOR`, y accesibilidad del formulario nuevo de `EnlacesPage.tsx`.

- [ ] **Step 4: Triar los hallazgos y cerrar los reales**

Aplicar las correcciones que el revisor marque como reales antes de considerar la tarea terminada (mismo criterio usado en HU13: cerrar gaps reales, documentar los descartados con su razón).

---

## Pasos manuales que le corresponden al usuario (fuera del código)

Estos NO son tareas del plan — son prerrequisitos que Sebastian debe completar para que el cron funcione en producción. Se documentan aquí para no perderlos:

1. Crear proyecto en [Google Cloud Console](https://console.cloud.google.com), habilitar "Google Sheets API".
2. Crear una cuenta de servicio, generar su clave JSON.
3. Compartir la hoja de enlaces (la del link que pasó) con el correo de esa cuenta de servicio, rol "Lector".
4. Cargar el contenido del JSON como `GOOGLE_SHEETS_CREDENTIALS_JSON` y el ID de la hoja como `GOOGLE_SHEETS_ID` en las variables de entorno de Render (y en `.env`/`apps/api/.env` local para probar).
5. Crear un bot con [@BotFather](https://t.me/BotFather) en Telegram, agregarlo a un grupo.
6. Escribir un mensaje cualquiera en ese grupo y llamar a `https://api.telegram.org/bot<TOKEN>/getUpdates` para obtener el `chat_id` del grupo (aparece como `message.chat.id`, normalmente un número negativo).
7. Cargar `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` en las variables de entorno.
