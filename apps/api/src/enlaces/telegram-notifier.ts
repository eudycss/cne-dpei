import { Injectable, Logger } from '@nestjs/common';
import { escapeHtml, type EnlaceCaido } from '../auth/notifier';

/** Botón persistente bajo el chat que dispara el mismo flujo que escribir /caidos a mano. */
export const TEXTO_BOTON_CAIDOS = '🔴 Caídos';

/** Botón persistente que arranca el flujo de "mande el código y le respondo con su estado". */
export const TEXTO_BOTON_INGRESAR_CODIGO = '🔍 Ingresar código';

/** Claves sin tildes y en minúsculas (ver normalizarClave), para que "Urcuquí" y
 * "URCUQUI" de la hoja caigan en la misma abreviatura. */
const ABREVIATURAS_CANTON: Record<string, string> = {
  ibarra: 'Iba',
  otavalo: 'Ota',
  cotacachi: 'Cot',
  'antonio ante': 'Ant',
  urcuqui: 'Urc',
  'san miguel de urcuqui': 'Urc',
  pimampiro: 'Pim',
};

/** "Internet" es como la hoja marca al CPE: no es un cantón, así que no lleva abreviatura. */
const CANTONES_SIN_ABREVIATURA = new Set(['internet']);

function normalizarClave(valor: string): string {
  return valor.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase();
}

/** "Cotacachi" → "Cot". Un cantón que no está en el mapa usa sus 3 primeras letras,
 * para que un valor nuevo en la hoja se vea igual en vez de desaparecer. */
export function abreviarCanton(canton: string | null | undefined): string {
  const clave = normalizarClave(canton ?? '');
  if (!clave || CANTONES_SIN_ABREVIATURA.has(clave)) return '';
  const conocida = ABREVIATURAS_CANTON[clave];
  if (conocida) return conocida;
  // Solo letras (y por code point, no por unidad UTF-16): un valor raro de la hoja
  // como "<b>x" o "&xx" no debe colar símbolos en un mensaje que va con parse_mode HTML.
  const letras = Array.from(canton ?? '').filter((c) => /\p{L}/u.test(c)).slice(0, 3).join('');
  return letras.charAt(0).toUpperCase() + letras.slice(1).toLowerCase();
}

/** "1207 (Cot) — Escuela …". Siempre escapa: la lista de caídos va con parse_mode
 * HTML y código/nombre vienen de una hoja editada a mano. */
function formatearLinea(e: EnlaceCaido): string {
  const abreviatura = abreviarCanton(e.canton);
  const sufijoCanton = abreviatura ? ` (${escapeHtml(abreviatura)})` : '';
  return `${escapeHtml(e.codigoRecinto)}${sufijoCanton} — ${escapeHtml(e.nombreRecinto)}`;
}

const TIMEOUT_MS = 10_000;
const MAX_INTENTOS = 2;
const ESPERA_REINTENTO_MS = 2_000;
const MAX_ESPERA_429_MS = 5_000;

/** Segundos que pide Telegram en un 429 (`parameters.retry_after`); 1 si no lo trae o no se puede leer. */
async function leerRetryAfter(res: Response): Promise<number> {
  try {
    const json = (await res.json()) as { parameters?: { retry_after?: number } };
    const s = Number(json?.parameters?.retry_after);
    return Number.isFinite(s) && s > 0 ? s : 1;
  } catch {
    return 1;
  }
}

@Injectable()
export class TelegramNotifier {
  private readonly log = new Logger('TelegramNotifier');

  /** Manda siempre el estado COMPLETO de recintos caídos, destacando con 🚨 y negrita
   * los que pasaron de ACTIVO a FALLO en este ciclo (si los hay) — nunca un mensaje
   * aislado de un solo recinto, para que el grupo no crea que los demás ya se
   * recuperaron. Telegram no admite texto de color, por eso la negrita. */
  async enviarListaActual(enlaces: EnlaceCaido[], nuevosCodigos?: Set<string>): Promise<void> {
    const texto =
      enlaces.length === 0
        ? '✅ No hay enlaces caídos en este momento.'
        : `🔴 Enlaces caídos ahora mismo (${enlaces.length}):\n` +
          enlaces
            .map((e) => {
              const linea = formatearLinea(e);
              return nuevosCodigos?.has(e.codigoRecinto) ? `🚨 <b>${linea}</b>` : linea;
            })
            .join('\n');
    await this.enviarMensaje(texto, 'la lista de enlaces caídos', 'HTML');
  }

  /** Avisa qué recintos volvieron a ACTIVO tras haber estado en FALLO — sin esto,
   * el grupo solo se entera de las caídas y tiene que revisar la web para saber
   * cuándo se recupera un recinto. */
  async enviarRecuperados(enlaces: EnlaceCaido[]): Promise<void> {
    if (enlaces.length === 0) return;
    const texto =
      `✅ Enlaces recuperados (${enlaces.length}):\n` +
      enlaces.map(formatearLinea).join('\n');
    await this.enviarMensaje(texto, 'la lista de enlaces recuperados', 'HTML');
  }

  /** Mensaje de texto libre (prompt del flujo de "ingresar código" o el resultado
   * de la búsqueda) — a diferencia de enviarListaActual/enviarRecuperados, no tiene
   * un formato fijo, lo arma quien llama. */
  async enviarTexto(texto: string, descripcion: string): Promise<void> {
    await this.enviarMensaje(texto, descripcion);
  }

  /** parseMode solo lo pasan los mensajes que escapan su contenido (formatearLinea);
   * enviarTexto va sin él porque su texto libre no está escapado. */
  private async enviarMensaje(text: string, descripcion: string, parseMode?: 'HTML'): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      this.log.warn(
        `TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID no configurados — se omite el envío de ${descripcion}`,
      );
      return;
    }
    const body = JSON.stringify({
      chat_id: chatId,
      text,
      ...(parseMode ? { parse_mode: parseMode } : {}),
      // Se manda en cada mensaje (no solo en /start) para que el botón nunca
      // desaparezca del teclado del grupo, aunque el chat se reinicie o alguien
      // lo cierre manualmente en su propio cliente.
      reply_markup: {
        keyboard: [[{ text: TEXTO_BOTON_CAIDOS }, { text: TEXTO_BOTON_INGRESAR_CODIGO }]],
        resize_keyboard: true,
      },
    });

    // Un solo reintento: Telegram a veces se cuelga o responde 5xx/429 por un
    // momento. Los 4xx (mensaje mal armado, token o permisos) no se arreglan
    // repitiendo. Si Telegram entregó pero tardó más del timeout, el reintento
    // puede duplicar el mensaje: preferible a que el grupo no reciba nada.
    for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
      const resultado = await this.intentarEnvio(token, body);
      if (resultado.ok) return;
      const ultimo = intento === MAX_INTENTOS || resultado.esperaMs === null;
      const siguiente = ultimo
        ? resultado.esperaMs === null
          ? ' — no se reintenta'
          : ''
        : ' — se reintenta';
      this.log.error(
        `No se pudo enviar ${descripcion} a Telegram (intento ${intento}/${MAX_INTENTOS}): ${resultado.causa}${siguiente}`,
      );
      if (ultimo) return;
      await this.esperar(resultado.esperaMs!);
    }
  }

  /** Un intento de sendMessage con límite de tiempo. `esperaMs` es cuánto esperar
   * antes de reintentar, o null si el error no se arregla reintentando. */
  private async intentarEnvio(
    token: string,
    body: string,
  ): Promise<{ ok: true } | { ok: false; causa: string; esperaMs: number | null }> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return { ok: true };
      if (res.status === 429) {
        // Si pide esperar más que el tope, reintentar antes solo traería otro 429.
        const esperaMs = (await leerRetryAfter(res)) * 1000;
        return { ok: false, causa: 'HTTP 429', esperaMs: esperaMs <= MAX_ESPERA_429_MS ? esperaMs : null };
      }
      return { ok: false, causa: `HTTP ${res.status}`, esperaMs: res.status >= 500 ? ESPERA_REINTENTO_MS : null };
    } catch (e) {
      // Solo nombre y código: el texto completo del error podría traer la URL, que lleva el token.
      const err = e as Error & { cause?: { code?: string } };
      const causa =
        err?.name === 'TimeoutError' || err?.name === 'AbortError'
          ? `sin respuesta en ${TIMEOUT_MS / 1000} s`
          : `error de red (${[err?.name, err?.cause?.code].filter(Boolean).join(' ') || 'desconocido'})`;
      return { ok: false, causa, esperaMs: ESPERA_REINTENTO_MS };
    }
  }

  /** Aparte para que las pruebas no esperen de verdad. */
  protected esperar(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
