import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, Logger } from '@nestjs/common';
import type { EstadisticasEnlacesResponse, PeriodoEstadisticasEnlaces } from '@cne/shared-types';
import { escapeHtml, type EnlaceCaido } from '../auth/notifier';
import { asistenteHabilitado } from './asistente/llm.client';
import type { EncargadoRecinto } from './encargados-recintos.client';

/** Botón persistente bajo el chat que dispara el mismo flujo que escribir /caidos a mano. */
export const TEXTO_BOTON_CAIDOS = '🔴 Caídos';

/** Botón persistente que arranca el flujo de "mande el código y le respondo con su estado". */
export const TEXTO_BOTON_INGRESAR_CODIGO = '🔍 Ingresar código';

/** Botón persistente con la tarjeta de estadísticas (hoy, con botones para semana y mes). */
export const TEXTO_BOTON_ESTADISTICAS = '📊 Estadísticas';

/** Botón persistente con los recintos CDA agrupados por técnico responsable. */
export const TEXTO_BOTON_ASIGNACIONES = '👷 Asignaciones CDA';

/** Botón persistente que arranca el flujo de "escriba su pregunta" del asistente. */
export const TEXTO_BOTON_PREGUNTAR = '💬 Preguntar';

/** callback_data de los botones para elegir un recinto entre varios ("asis:rec:1008"). */
export const PREFIJO_CALLBACK_RECINTO = 'asis:rec:';

/** Teclado fijo bajo el chat, el mismo en todos los mensajes. "Preguntar" solo
 * aparece con el asistente activado (ASISTENTE_ENABLED y alguna llave). */
export function tecladoFijo() {
  const filas = [
    [{ text: TEXTO_BOTON_CAIDOS }, { text: TEXTO_BOTON_INGRESAR_CODIGO }],
    [{ text: TEXTO_BOTON_ESTADISTICAS }, { text: TEXTO_BOTON_ASIGNACIONES }],
  ];
  if (asistenteHabilitado()) filas.push([{ text: TEXTO_BOTON_PREGUNTAR }]);
  return { keyboard: filas, resize_keyboard: true };
}

/** Un técnico con sus recintos y el estado actual del enlace de cada uno. */
export interface GrupoAsignacion {
  /** null = recintos monitoreados que no están en el distributivo. */
  numeroTecnico: number | null;
  tecnico: string;
  recintos: { codigoRecinto: string; nombreRecinto: string; canton: string | null; estado: 'ACTIVO' | 'FALLO' | null }[];
}

/** A quién recurrir cuando un recinto se cae: su técnico (distributivo) y la
 * persona del recinto a quien llamar (hoja de contactos); null si no figura. */
export interface ContactoRecinto {
  tecnico: string | null;
  encargado: EncargadoRecinto | null;
}

/** Un recinto caído hace rato (según la configuración de avisos), con lo necesario para llamar a su encargado. */
export interface AlertaRecinto {
  codigoRecinto: string;
  nombreRecinto: string;
  canton: string;
  /** '' si el distributivo no la trae. */
  parroquia: string;
  inicio: Date;
  minutosCaido: number;
  /** 1 = primer aviso, 2 = primer recordatorio… */
  aviso: number;
  caidas24h: number;
  caidas7d: number;
  inestable: boolean;
  encargado: EncargadoRecinto | null;
  /** Técnico(s) del distributivo; null si el recinto no figura o no se pudo leer. */
  tecnico: string | null;
}

/** Un aviso de escalamiento: un posible corte de zona (varios recintos) o un recinto suelto (zona null). */
export interface GrupoAlerta {
  zona: string | null;
  recintos: AlertaRecinto[];
}

/** Tarjeta de estadísticas de un período ("Hoy", "Semana pasada"…). */
export interface TarjetaEstadisticas {
  titulo: string;
  actual: EstadisticasEnlacesResponse;
  /** El período anterior, para comparar; null si el historial no lo cubre completo. */
  anterior: EstadisticasEnlacesResponse | null;
  /** true si el período sigue en curso: el anterior se cortó a la misma altura
   * ("que ayer a esta hora"), para no comparar medio día contra uno entero. */
  comparaHastaAhora: boolean;
}

/** callback_data de los botones Hoy/Semana/Mes bajo la tarjeta ("est:semana"). */
export const PREFIJO_CALLBACK_ESTADISTICAS = 'est:';

const BOTONES_PERIODO: readonly [PeriodoEstadisticasEnlaces, string][] = [
  ['dia', 'Hoy'],
  ['semana', 'Semana'],
  ['mes', 'Mes'],
];

/** Botones bajo la tarjeta; el período que se está viendo va marcado. */
export function tecladoPeriodos(seleccionado: PeriodoEstadisticasEnlaces) {
  return {
    inline_keyboard: [
      BOTONES_PERIODO.map(([periodo, texto]) => ({
        text: periodo === seleccionado ? `• ${texto} •` : texto,
        callback_data: `${PREFIJO_CALLBACK_ESTADISTICAS}${periodo}`,
      })),
    ],
  };
}

/** callback_data de los botones de técnico bajo "Asignaciones CDA" ("asig:3"; "asig:sin" = sin técnico). */
export const PREFIJO_CALLBACK_ASIGNACIONES = 'asig:';

/** Clave del botón de un grupo: su número de técnico, o "sin" para los que no tienen. */
export function claveGrupoAsignacion(g: GrupoAsignacion): string {
  return g.numeroTecnico === null ? 'sin' : String(g.numeroTecnico);
}

/** callback_data del botón que vuelve del detalle de un técnico al resumen. */
export const CLAVE_RESUMEN_ASIGNACIONES = 'menu';

/** Un botón por técnico, uno por fila para que en el celular no se corten el
 * conteo ni los caídos ("1. Ana Pérez (11 · 2🔴)"). Viendo uno, va marcado y
 * al final aparece "↩ Resumen". */
export function tecladoTecnicos(grupos: GrupoAsignacion[], seleccionado?: string) {
  const botones = grupos.map((g) => {
    const caidos = g.recintos.filter((r) => r.estado === 'FALLO').length;
    const nombre = g.numeroTecnico === null ? 'Sin técnico' : `${g.numeroTecnico}. ${recortar(g.tecnico, 28)}`;
    const texto = `${nombre} (${g.recintos.length}${caidos > 0 ? ` · ${caidos}🔴` : ''})`;
    const clave = claveGrupoAsignacion(g);
    return { text: clave === seleccionado ? `• ${texto} •` : texto, callback_data: `${PREFIJO_CALLBACK_ASIGNACIONES}${clave}` };
  });
  const filas = botones.map((b) => [b]);
  if (seleccionado !== undefined) {
    filas.push([{ text: '↩ Resumen', callback_data: `${PREFIJO_CALLBACK_ASIGNACIONES}${CLAVE_RESUMEN_ASIGNACIONES}` }]);
  }
  return { inline_keyboard: filas };
}

/** Mensaje de entrada de "Asignaciones CDA": totales y la indicación de tocar un técnico. */
export function formatearMenuAsignaciones(grupos: GrupoAsignacion[]): string {
  const tecnicos = grupos.filter((g) => g.numeroTecnico !== null).length;
  const recintos = grupos.reduce((n, g) => n + g.recintos.length, 0);
  const caidos = grupos.reduce((n, g) => n + g.recintos.filter((r) => r.estado === 'FALLO').length, 0);
  return (
    '<b>👷 Asignaciones CDA</b>\n' +
    `${plural(tecnicos, 'técnico')} · ${plural(recintos, 'recinto')}` +
    `${caidos > 0 ? ` · ${caidos} caído${caidos === 1 ? '' : 's'} 🔴` : ''}\n\n` +
    'Toque un técnico para ver sus recintos CDA.'
  );
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

/** `description` de una respuesta de error de Telegram; '' si no se puede leer. */
async function leerDescripcion(res: Response): Promise<string> {
  try {
    const json = (await res.json()) as { description?: unknown };
    return typeof json?.description === 'string' ? json.description : '';
  } catch {
    return '';
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

function plural(n: number, singular: string, pluralForma = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForma}`;
}

const ANCHO_BARRA = 10;
const TOP_TARJETA = 5;
const NOMBRE_ANTERIOR: Record<PeriodoEstadisticasEnlaces, string> = {
  dia: 'el día anterior',
  semana: 'la semana anterior',
  mes: 'el mes anterior',
};
const NOMBRE_ANTERIOR_HASTA_AHORA: Record<PeriodoEstadisticasEnlaces, string> = {
  dia: 'ayer a esta hora',
  semana: 'la semana pasada a esta altura',
  mes: 'el mes pasado a esta altura',
};
// Tabla fija y no toLocaleDateString: no depende del ICU que traiga el Node del servidor.
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Barra de 10 bloques proporcional a `valor` (mínimo 1 bloque si es mayor que 0). */
export function barra(valor: number, maximo: number): string {
  const llenos = valor > 0 && maximo > 0 ? Math.max(1, Math.round((valor / maximo) * ANCHO_BARRA)) : 0;
  return '█'.repeat(llenos) + '░'.repeat(ANCHO_BARRA - llenos);
}

function totalCaidas(stats: EstadisticasEnlacesResponse): number {
  return stats.ranking.reduce((n, e) => n + e.caidas, 0);
}

/** "14/10", "12/10–18/10" o, para un mes, su nombre ("octubre"). */
function rotuloPeriodo(stats: EstadisticasEnlacesResponse): string {
  if (stats.periodo === 'mes') {
    // `desde` es medianoche de Ecuador del día 1 (05:00 UTC): el mes UTC es el mismo.
    return MESES[new Date(stats.desde).getUTCMonth()];
  }
  return rotuloRango(stats);
}

/**
 * Tarjeta de un período para Telegram (HTML escapado: código y nombre vienen
 * de la hoja): primero lo que se entiende de un vistazo (cuántos recintos no
 * se cayeron, cuánto tiempo sin enlace, comparación con el período anterior)
 * y después los recintos con más tiempo caído, con una barra proporcional.
 */
export function formatearTarjeta({ titulo, actual, anterior, comparaHastaAhora }: TarjetaEstadisticas): string {
  const lineas = [`<b>📊 Enlaces CDA · ${escapeHtml(titulo)}</b> (${escapeHtml(rotuloPeriodo(actual))})`, ''];

  const sanos = actual.sinCaidas.length;
  const porcentaje = actual.totalRecintos > 0 ? Math.round((sanos * 100) / actual.totalRecintos) : 100;
  lineas.push(`✅ <b>${sanos} de ${actual.totalRecintos}</b> recintos sin caídas (${porcentaje} %)`);

  const conCaidas = actual.ranking;
  if (conCaidas.length === 0) {
    lineas.push('🎉 Ningún enlace se cayó en este período');
  } else {
    const minutos = conCaidas.reduce((n, e) => n + e.minutosCaido, 0);
    lineas.push(
      `🔴 ${plural(conCaidas.length, 'recinto')} con caídas · ${formatearDuracion(minutos)} sin enlace en total`,
    );
    const siguen = conCaidas.filter((e) => e.sigueCaido).length;
    if (siguen > 0) lineas.push(`🚨 ${siguen} ${siguen === 1 ? 'sigue caído' : 'siguen caídos'} ahora`);
  }

  if (anterior) {
    const diferencia = totalCaidas(actual) - totalCaidas(anterior);
    // Cuenta caídas que empezaron en el período; un recinto que "venía caído" no suma.
    const referencia = (comparaHastaAhora ? NOMBRE_ANTERIOR_HASTA_AHORA : NOMBRE_ANTERIOR)[actual.periodo];
    lineas.push(
      diferencia > 0
        ? `📈 ${plural(diferencia, 'caída')} más que ${referencia}`
        : diferencia < 0
          ? `📉 ${plural(-diferencia, 'caída')} menos que ${referencia}`
          : `➖ Mismo número de caídas que ${referencia}`,
    );
  }
  if (actual.datosParciales) {
    lineas.push(`<i>ℹ️ El registro empezó el ${ddmm(actual.historialDesde)}: este período aún no está completo.</i>`);
  }

  if (conCaidas.length > 0) {
    const top = [...conCaidas]
      .sort(
        (a, b) =>
          b.minutosCaido - a.minutosCaido || b.caidas - a.caidas || a.codigoRecinto.localeCompare(b.codigoRecinto),
      )
      .slice(0, TOP_TARJETA);
    const maximo = top[0].minutosCaido;
    lineas.push('', '<b>Más tiempo sin enlace</b>');
    top.forEach((e, i) => {
      const abreviatura = abreviarCanton(e.canton);
      // 0 caídas con tiempo caído = la caída venía del período anterior.
      const caidas = e.caidas === 0 ? 'venía caído' : plural(e.caidas, 'caída');
      lineas.push(
        `${i + 1}. ${escapeHtml(recortarNombre(e.nombreRecinto))} ` +
          `<i>(${escapeHtml(e.codigoRecinto)}${abreviatura ? ` · ${escapeHtml(abreviatura)}` : ''})</i>`,
        `${barra(e.minutosCaido, maximo)} ${formatearDuracion(e.minutosCaido)} · ${caidas}${e.sigueCaido ? ' 🔴' : ''}`,
      );
    });
    if (conCaidas.length > TOP_TARJETA) {
      lineas.push(`… y ${plural(conCaidas.length - TOP_TARJETA, 'recinto')} más con caídas`);
    }
  }
  return lineas.join('\n');
}

export function recortarNombre(nombre: string): string {
  return recortar(nombre, MAX_NOMBRE);
}

/** El técnico viene de una celda sin tope (y puede juntar varios nombres): sin esto
 * un bloque solo podría pasar el límite de Telegram y el mensaje entero se perdería. */
const MAX_TECNICO = 120;

function recortar(texto: string, maximo: number): string {
  // Por caracteres, no por unidades UTF-16: no parte un emoji a la mitad.
  const letras = Array.from(texto);
  return letras.length > maximo ? `${letras.slice(0, maximo - 1).join('')}…` : texto;
}

/** Las líneas de un recinto en el aviso de escalamiento (HTML escapado). */
function lineasAlerta(a: AlertaRecinto, enZona: boolean): string[] {
  const sector = [abreviarCanton(a.canton), a.parroquia].filter(Boolean).map(escapeHtml).join(' · ');
  const lineas = [
    `🔴 <b>${escapeHtml(a.codigoRecinto)} · ${escapeHtml(recortarNombre(a.nombreRecinto))}</b>` +
      (sector && !enZona ? ` (${sector})` : ''),
    `⏱ Caído hace ${formatearDuracion(a.minutosCaido)}${a.aviso > 1 ? ` · ${a.aviso}.º aviso` : ''}`,
  ];
  if (a.inestable) {
    lineas.push(
      a.caidas24h >= 3
        ? `⚠️ Inestable: ${a.caidas24h} caídas en 24 h`
        : `⚠️ Inestable: ${a.caidas7d} caídas en 7 días`,
    );
  }
  lineas.push(`👷 Técnico: ${formatearTecnico(a.tecnico)}`, `📞 Encargado: ${formatearEncargado(a.encargado)}`);
  return lineas;
}

/** Nombre(s) del técnico (HTML escapado y recortado) o "sin asignar". */
function formatearTecnico(tecnico: string | null): string {
  return tecnico ? escapeHtml(recortar(tecnico, MAX_TECNICO)) : 'sin asignar';
}

/** "Nombre · 099…" (HTML escapado) o "sin registrar". La celda del formulario ya
 * trae el cargo si lo escribieron ("Rector …", "conserje …"): va tal cual. */
function formatearEncargado(encargado: EncargadoRecinto | null): string {
  const texto = encargado
    ? [encargado.nombre, encargado.telefono].filter(Boolean).map(escapeHtml).join(' · ')
    : '';
  return texto || 'sin registrar';
}

/**
 * Lista completa de recintos caídos (HTML escapado), con 🚨 y negrita los que
 * acaban de caer. Con `contactos`, debajo de cada nuevo van su técnico y a quién
 * llamar en el recinto; los que ya venían caídos no, para no alargar el mensaje.
 * Si no cabe en un mensaje de Telegram, se parte entre recintos.
 */
export function formatearListaActual(
  enlaces: EnlaceCaido[],
  nuevosCodigos?: Set<string>,
  canton?: string,
  contactos?: Map<string, ContactoRecinto>,
): string[] {
  // `canton`: la lista viene filtrada (asistente), y el título tiene que decirlo.
  const donde = canton ? ` en ${escapeHtml(canton)}` : '';
  if (enlaces.length === 0) return [`✅ No hay enlaces caídos${donde} en este momento.`];

  const encabezado = `🔴 Enlaces caídos${donde} ahora mismo (${enlaces.length}):`;
  const mensajes: string[] = [];
  let actual = encabezado;
  for (const e of enlaces) {
    let bloque = formatearLinea(e);
    if (nuevosCodigos?.has(e.codigoRecinto)) {
      bloque = `🚨 <b>${bloque}</b>`;
      if (contactos) {
        const c = contactos.get(e.codigoRecinto);
        bloque +=
          `\n    👷 Técnico: ${formatearTecnico(c?.tecnico ?? null)}` +
          `\n    📞 Llamar: ${formatearEncargado(c?.encargado ?? null)}`;
      }
    }
    const unido = `${actual}\n${bloque}`;
    if (unido.length > MAX_LARGO_MENSAJE && actual !== encabezado) {
      mensajes.push(actual);
      actual = `🔴 Enlaces caídos${donde} (cont.):\n${bloque}`;
    } else {
      actual = unido;
    }
  }
  mensajes.push(actual);
  return mensajes;
}

/** Respuesta a "Ingresar código" (HTML escapado): el recinto, su estado, su
 * técnico y a quién llamar, con las mismas etiquetas que el aviso de caída. */
export function formatearFichaRecinto(
  recinto: EnlaceCaido & { estado: string },
  contacto: ContactoRecinto,
): string {
  const emojiEstado = recinto.estado === 'FALLO' ? '🔴' : '✅';
  return [
    `📍 ${formatearLinea(recinto)}`,
    `Estado: ${emojiEstado} ${escapeHtml(recinto.estado)}`,
    `👷 Técnico: ${formatearTecnico(contacto.tecnico)}`,
    `📞 Llamar: ${formatearEncargado(contacto.encargado)}`,
  ].join('\n');
}

/**
 * Aviso de escalamiento (HTML escapado): primero los posibles cortes de zona,
 * después los recintos sueltos, cada uno con su encargado para llamarlo. Si no
 * cabe en un mensaje de Telegram, se parte entre grupos.
 */
export function formatearEscalamiento(grupos: GrupoAlerta[]): string[] {
  const recintos = grupos.flatMap((g) => g.recintos);
  const total = recintos.length;
  // El tiempo real del más antiguo, no el umbral del primer aviso: "hace 30 min
  // o más" sobre un recinto caído hace 19 h confundía. Cada recinto lleva el suyo.
  const masAntiguo = Math.max(0, ...recintos.map((a) => a.minutosCaido));
  const encabezado =
    total === 1
      ? '<b>🚨 1 enlace caído</b>'
      : `<b>🚨 ${total} enlaces caídos · el más antiguo hace ${formatearDuracion(masAntiguo)}</b>`;
  // Una unidad por recinto; el título de la zona va pegado a su primer recinto y,
  // si la zona no cabe en un mensaje, se repite con "(cont.)" en el siguiente.
  const unidades = grupos.flatMap((g) => {
    if (!g.zona) return [{ texto: lineasAlerta(g.recintos[0], false).join('\n'), cont: null as string | null }];
    const zona = escapeHtml(g.zona);
    const titulo =
      `<b>📍 Posible corte de luz o internet en ${zona} · ${g.recintos.length} recintos</b>\n` +
      '<i>Revisar energía o fibra del sector.</i>';
    const cont = `<b>📍 Zona ${zona} (cont.)</b>`;
    return g.recintos.map((a, i) => {
      const texto = lineasAlerta(a, true).join('\n');
      return { texto: i === 0 ? `${titulo}\n\n${texto}` : texto, cont: i === 0 ? null : cont };
    });
  });

  const mensajes: string[] = [];
  let actual = encabezado;
  for (const { texto, cont } of unidades) {
    const unido = `${actual}\n\n${texto}`;
    if (unido.length > MAX_LARGO_MENSAJE && actual !== encabezado) {
      mensajes.push(actual);
      actual = cont ? `${cont}\n\n${texto}` : texto;
    } else {
      actual = unido;
    }
  }
  mensajes.push(actual);
  return mensajes;
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
  /** Chat al que va lo que se envíe dentro de `responderEn`. Fuera de eso (avisos
   * del cron, escalamiento, resumen diario) no hay valor y todo va a TELEGRAM_CHAT_ID. */
  private readonly destino = new AsyncLocalStorage<string>();

  /** Ejecuta `fn` enviando sus mensajes a `chatId` en vez del grupo configurado:
   * así un grupo de consulta (p. ej. el de demos) recibe la respuesta a su propio
   * comando sin que los avisos automáticos salgan del grupo principal. */
  responderEn<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
    return this.destino.run(chatId, fn);
  }

  /** Manda siempre el estado COMPLETO de recintos caídos, destacando con 🚨 y negrita
   * los que pasaron de ACTIVO a FALLO en este ciclo (si los hay) — nunca un mensaje
   * aislado de un solo recinto, para que el grupo no crea que los demás ya se
   * recuperaron. Telegram no admite texto de color, por eso la negrita. Uno o más
   * mensajes, en orden (ver formatearListaActual). */
  async enviarListaActual(
    enlaces: EnlaceCaido[],
    nuevosCodigos?: Set<string>,
    canton?: string,
    contactos?: Map<string, ContactoRecinto>,
  ): Promise<void> {
    for (const mensaje of formatearListaActual(enlaces, nuevosCodigos, canton, contactos)) {
      await this.enviarMensaje(mensaje, 'la lista de enlaces caídos', 'HTML');
    }
  }

  /** Avisa qué recintos volvieron a ACTIVO tras haber estado en FALLO — sin esto,
   * el grupo solo se entera de las caídas y tiene que revisar la web para saber
   * cuándo se recupera un recinto. */
  async enviarRecuperados(enlaces: EnlaceCaido[], minutosCaido?: Map<string, number>): Promise<void> {
    if (enlaces.length === 0) return;
    const texto =
      `✅ Enlaces recuperados (${enlaces.length}):\n` +
      enlaces
        .map((e) => {
          const minutos = minutosCaido?.get(e.codigoRecinto);
          return formatearLinea(e) + (minutos === undefined ? '' : ` · volvió tras ${formatearDuracion(minutos)}`);
        })
        .join('\n');
    await this.enviarMensaje(texto, 'la lista de enlaces recuperados', 'HTML');
  }

  /** Aviso de enlaces caídos (ya filtrados por el umbral del primer aviso); uno o más mensajes, en orden. */
  async enviarEscalamiento(grupos: GrupoAlerta[]): Promise<void> {
    if (grupos.length === 0) return;
    for (const mensaje of formatearEscalamiento(grupos)) {
      await this.enviarMensaje(mensaje, 'el aviso de enlaces caídos', 'HTML');
    }
  }

  /** Totales y un botón por técnico; al tocar uno, ver mostrarAsignacionTecnico. */
  async enviarMenuAsignaciones(grupos: GrupoAsignacion[]): Promise<void> {
    await this.enviarMensaje(formatearMenuAsignaciones(grupos), 'las asignaciones CDA', 'HTML', tecladoTecnicos(grupos));
  }

  /** "↩ Resumen": devuelve ese mensaje al menú de técnicos. */
  async editarMenuAsignaciones(messageId: number, grupos: GrupoAsignacion[]): Promise<void> {
    await this.llamar(
      'editMessageText',
      {
        message_id: messageId,
        text: formatearMenuAsignaciones(grupos),
        parse_mode: 'HTML',
        reply_markup: tecladoTecnicos(grupos),
      },
      'las asignaciones CDA',
    );
  }

  /** Cambia ese mensaje a los recintos del técnico tocado, con los botones debajo
   * para pasar a otro. Si su lista no cabe en un mensaje, el resto va aparte. */
  async mostrarAsignacionTecnico(messageId: number, grupos: GrupoAsignacion[], grupo: GrupoAsignacion): Promise<void> {
    const [primero, ...resto] = formatearAsignaciones([grupo]);
    await this.llamar(
      'editMessageText',
      {
        message_id: messageId,
        text: primero,
        parse_mode: 'HTML',
        reply_markup: tecladoTecnicos(grupos, claveGrupoAsignacion(grupo)),
      },
      'las asignaciones del técnico',
    );
    for (const mensaje of resto) await this.enviarMensaje(mensaje, 'las asignaciones del técnico', 'HTML');
  }

  /** Con `conBotones`, la tarjeta lleva Hoy/Semana/Mes para cambiar de período en el mismo mensaje. */
  async enviarTarjetaEstadisticas(tarjeta: TarjetaEstadisticas, conBotones: boolean): Promise<void> {
    await this.enviarMensaje(
      formatearTarjeta(tarjeta),
      'las estadísticas de enlaces',
      'HTML',
      conBotones ? tecladoPeriodos(tarjeta.actual.periodo) : undefined,
    );
  }

  /** Reemplaza la tarjeta de ese mensaje por la de otro período (botones Hoy/Semana/Mes). */
  async editarTarjetaEstadisticas(messageId: number, tarjeta: TarjetaEstadisticas): Promise<void> {
    await this.llamar(
      'editMessageText',
      {
        message_id: messageId,
        text: formatearTarjeta(tarjeta),
        parse_mode: 'HTML',
        reply_markup: tecladoPeriodos(tarjeta.actual.periodo),
      },
      'la tarjeta de estadísticas',
    );
  }

  /** Quita el "cargando" del botón en el cliente de quien lo tocó. */
  async responderBoton(callbackQueryId: string): Promise<void> {
    await this.llamar('answerCallbackQuery', { callback_query_id: callbackQueryId }, 'la respuesta al botón', false);
  }

  /** Mensaje de texto libre (prompt del flujo de "ingresar código" o el resultado
   * de la búsqueda) — a diferencia de enviarListaActual/enviarRecuperados, no tiene
   * un formato fijo, lo arma quien llama. */
  async enviarTexto(texto: string, descripcion: string): Promise<void> {
    await this.enviarMensaje(texto, descripcion);
  }

  /** Mensaje ya escapado por quien llama (respuestas del asistente), con botones
   * propios opcionales; sin ellos lleva el teclado fijo. */
  async enviarHtml(texto: string, descripcion: string, botones?: object): Promise<void> {
    await this.enviarMensaje(texto, descripcion, 'HTML', botones);
  }

  /** "escribiendo…" en el chat mientras el asistente consulta al modelo. */
  async indicarEscribiendo(): Promise<void> {
    await this.llamar('sendChatAction', { action: 'typing' }, 'el indicador de escribiendo');
  }

  /** parseMode solo lo pasan los mensajes que escapan su contenido (formatearLinea);
   * enviarTexto va sin él porque su texto libre no está escapado. */
  private async enviarMensaje(
    text: string,
    descripcion: string,
    parseMode?: 'HTML',
    replyMarkup: object = tecladoFijo(),
  ): Promise<void> {
    await this.llamar(
      'sendMessage',
      {
        text,
        ...(parseMode ? { parse_mode: parseMode } : {}),
        // El teclado fijo se manda en cada mensaje (no solo en /start) para que el
        // botón nunca desaparezca del grupo, aunque el chat se reinicie o alguien lo
        // cierre en su cliente. Un mensaje con botones propios (la tarjeta de
        // estadísticas) no lo lleva, pero el teclado fijo se queda donde estaba.
        reply_markup: replyMarkup,
      },
      descripcion,
    );
  }

  /** Llama a un método de la Bot API; con `conChat`, al chat configurado (o al de
   * `responderEn`, si se está respondiendo a un grupo de consulta). Nunca lanza. */
  private async llamar(
    metodo: string,
    payload: Record<string, unknown>,
    descripcion: string,
    conChat = true,
  ): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = this.destino.getStore() ?? process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) {
      this.log.warn(
        `TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID no configurados — se omite el envío de ${descripcion}`,
      );
      return;
    }
    const body = JSON.stringify(conChat ? { chat_id: chatId, ...payload } : payload);

    // Un solo reintento: Telegram a veces se cuelga o responde 5xx/429 por un
    // momento. Los 4xx (mensaje mal armado, token o permisos) no se arreglan
    // repitiendo. Si Telegram entregó pero tardó más del timeout, el reintento
    // puede duplicar el mensaje: preferible a que el grupo no reciba nada.
    for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
      const resultado = await this.intentarEnvio(token, metodo, body);
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

  /** Un intento de llamada a la Bot API con límite de tiempo. `esperaMs` es cuánto esperar
   * antes de reintentar, o null si el error no se arregla reintentando. */
  private async intentarEnvio(
    token: string,
    metodo: string,
    body: string,
  ): Promise<{ ok: true } | { ok: false; causa: string; esperaMs: number | null }> {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return { ok: true };
      // Tocar el período que ya se ve: Telegram no edita un texto idéntico. No es un error.
      if (res.status === 400 && (await leerDescripcion(res)).includes('message is not modified')) {
        return { ok: true };
      }
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
