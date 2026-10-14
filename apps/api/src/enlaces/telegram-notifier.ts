import { Injectable, Logger } from '@nestjs/common';
import type { EstadisticasEnlacesResponse } from '@cne/shared-types';
import { escapeHtml, type EnlaceCaido } from '../auth/notifier';

/** Botón persistente bajo el chat que dispara el mismo flujo que escribir /caidos a mano. */
export const TEXTO_BOTON_CAIDOS = '🔴 Caídos';

/** Botón persistente que arranca el flujo de "mande el código y le respondo con su estado". */
export const TEXTO_BOTON_INGRESAR_CODIGO = '🔍 Ingresar código';

/** Botón persistente con el top de caídas de hoy, la semana y el mes. */
export const TEXTO_BOTON_ESTADISTICAS = '📊 Estadísticas';

/** Botón persistente con los recintos CDA agrupados por técnico responsable. */
export const TEXTO_BOTON_ASIGNACIONES = '👷 Asignaciones CDA';

/** Teclado fijo bajo el chat, el mismo en todos los mensajes. */
export const TECLADO = {
  keyboard: [
    [{ text: TEXTO_BOTON_CAIDOS }, { text: TEXTO_BOTON_INGRESAR_CODIGO }],
    [{ text: TEXTO_BOTON_ESTADISTICAS }, { text: TEXTO_BOTON_ASIGNACIONES }],
  ],
  resize_keyboard: true,
};

/** Un técnico con sus recintos y el estado actual del enlace de cada uno. */
export interface GrupoAsignacion {
  /** null = recintos monitoreados que no están en el distributivo. */
  numeroTecnico: number | null;
  tecnico: string;
  recintos: { codigoRecinto: string; nombreRecinto: string; canton: string | null; estado: 'ACTIVO' | 'FALLO' | null }[];
}

/** Un período del mensaje de estadísticas ("Hoy", "Semana pasada"…). */
export interface SeccionEstadisticas {
  titulo: string;
  stats: EstadisticasEnlacesResponse;
}

/** Límite de Telegram por mensaje (4096) con margen. */
const MAX_LARGO_MENSAJE = 4000;
const MAX_NOMBRE = 45;

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

/** 75 → "1 h 15 min"; 3000 → "2 d 2 h". */
export function formatearDuracion(minutos: number): string {
  const m = Math.round(minutos);
  if (m < 60) return `${m} min`;
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const resto = m % 60;
  if (d > 0) return h > 0 ? `${d} d ${h} h` : `${d} d`;
  return resto > 0 ? `${h} h ${resto} min` : `${h} h`;
}

/** "dd/mm" en hora de Ecuador. */
function ddmm(iso: string): string {
  return new Date(iso).toLocaleDateString('es-EC', { timeZone: 'America/Guayaquil', day: '2-digit', month: '2-digit' });
}

function rotuloRango(stats: EstadisticasEnlacesResponse): string {
  const ultimoDia = new Date(new Date(stats.hasta).getTime() - 1).toISOString();
  return stats.periodo === 'dia' ? ddmm(stats.desde) : `${ddmm(stats.desde)}–${ddmm(ultimoDia)}`;
}

/**
 * Mensaje de estadísticas (HTML escapado: código y nombre vienen de la hoja).
 * Por período: total de caídas, el top `top` y cuántos no se cayeron. Si no
 * cabe en un mensaje de Telegram, se achica el top.
 */
export function formatearEstadisticas(encabezado: string, secciones: SeccionEstadisticas[], top = 10): string {
  const texto = [`<b>${escapeHtml(encabezado)}</b>`];
  for (const { titulo, stats } of secciones) {
    const totalCaidas = stats.ranking.reduce((n, e) => n + e.caidas, 0);
    texto.push(
      '',
      `<b>${escapeHtml(titulo)}</b> (${rotuloRango(stats)}): ${totalCaidas} caída${totalCaidas === 1 ? '' : 's'}` +
        ` · ${stats.sinCaidas.length} de ${stats.totalRecintos} sin caídas`,
    );
    if (stats.datosParciales) texto.push(`<i>Datos desde ${ddmm(stats.historialDesde)}</i>`);
    stats.ranking.slice(0, top).forEach((e, i) => {
      const abreviatura = abreviarCanton(e.canton);
      const nombre = recortarNombre(e.nombreRecinto);
      // 0 caídas con tiempo caído = la caída venía del período anterior.
      const caidas = e.caidas === 0 ? 'venía caído' : `${e.caidas} caída${e.caidas === 1 ? '' : 's'}`;
      texto.push(
        `${i + 1}. ${escapeHtml(e.codigoRecinto)}${abreviatura ? ` (${escapeHtml(abreviatura)})` : ''} — ` +
          `${escapeHtml(nombre)} · ${caidas} · ${formatearDuracion(e.minutosCaido)}` +
          (e.sigueCaido ? ' 🔴' : ''),
      );
    });
    if (stats.ranking.length > top) texto.push(`… y ${stats.ranking.length - top} más`);
  }
  const mensaje = texto.join('\n');
  if (mensaje.length <= MAX_LARGO_MENSAJE || top === 0) return mensaje;
  // No cabe: se achica el top hasta quedar, en el peor caso, solo con los totales.
  return formatearEstadisticas(encabezado, secciones, Math.floor(top / 2));
}

function recortarNombre(nombre: string): string {
  // Por caracteres, no por unidades UTF-16: no parte un emoji a la mitad.
  const letras = Array.from(nombre);
  return letras.length > MAX_NOMBRE ? `${letras.slice(0, MAX_NOMBRE - 1).join('')}…` : nombre;
}

const EMOJI_ESTADO = { ACTIVO: '✅', FALLO: '🔴' } as const;

/**
 * Recintos CDA por técnico ("1. Ana Pérez (11)" y sus recintos con ✅/🔴),
 * en HTML escapado. Devuelve uno o más mensajes: si todo no cabe en uno de
 * Telegram, se corta entre técnicos; solo un grupo que por sí solo no cabe se
 * parte por líneas, repitiendo su título con "(cont.)".
 */
export function formatearAsignaciones(grupos: GrupoAsignacion[]): string[] {
  const ENCABEZADO = '<b>👷 Asignaciones CDA</b>';
  // Cada bloque cabe solo en un mensaje (junto al encabezado, en el peor caso).
  const limiteBloque = MAX_LARGO_MENSAJE - ENCABEZADO.length - 2;
  const bloques = grupos.flatMap((g) => {
    const caidos = g.recintos.filter((r) => r.estado === 'FALLO').length;
    const titulo =
      g.numeroTecnico === null
        ? `<b>Sin técnico asignado</b> (${g.recintos.length})`
        : `<b>${g.numeroTecnico}. ${escapeHtml(g.tecnico)}</b> (${g.recintos.length}` +
          `${caidos > 0 ? ` · ${caidos} caído${caidos === 1 ? '' : 's'}` : ''})`;
    const lineas = g.recintos.map((r) => {
      const abreviatura = abreviarCanton(r.canton);
      const estado = r.estado ? EMOJI_ESTADO[r.estado] : '⚪';
      return (
        `${estado} ${escapeHtml(r.codigoRecinto)}${abreviatura ? ` (${escapeHtml(abreviatura)})` : ''} — ` +
        escapeHtml(recortarNombre(r.nombreRecinto))
      );
    });
    const partes: string[] = [];
    let parte = titulo;
    for (const linea of lineas) {
      if (`${parte}\n${linea}`.length > limiteBloque) {
        partes.push(parte);
        parte = `${titulo} (cont.)\n${linea}`;
      } else {
        parte = `${parte}\n${linea}`;
      }
    }
    partes.push(parte);
    return partes;
  });

  // El encabezado va pegado al primer bloque: nunca sale un mensaje solo con él.
  const mensajes: string[] = [];
  let actual = ENCABEZADO;
  for (const bloque of bloques) {
    const unido = `${actual}\n\n${bloque}`;
    if (unido.length > MAX_LARGO_MENSAJE && actual !== ENCABEZADO) {
      mensajes.push(actual);
      actual = bloque;
    } else {
      actual = unido;
    }
  }
  mensajes.push(actual);
  return mensajes;
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

  /** Uno o más mensajes, en orden (se espera cada envío antes del siguiente). */
  async enviarAsignaciones(grupos: GrupoAsignacion[]): Promise<void> {
    for (const mensaje of formatearAsignaciones(grupos)) {
      await this.enviarMensaje(mensaje, 'las asignaciones CDA', 'HTML');
    }
  }

  async enviarEstadisticas(encabezado: string, secciones: SeccionEstadisticas[]): Promise<void> {
    await this.enviarMensaje(formatearEstadisticas(encabezado, secciones), 'las estadísticas de enlaces', 'HTML');
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
      reply_markup: TECLADO,
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
