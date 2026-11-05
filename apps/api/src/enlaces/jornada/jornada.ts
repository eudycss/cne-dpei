import { escapeHtml } from '../../auth/notifier';
import { MINUTOS_RESUMEN_JORNADA } from '@cne/shared-validation';

/**
 * Grupo "Jornada" de Telegram: quién falta y quién ya cumplió cada momento del
 * día (salida del DPEI, llegada y salida del recinto, llegada al DPEI), las
 * visitas a los NO CDA y los kits pendientes de entregar, agrupado por técnico
 * o por cantón, y la ficha de un CDA ("Consultar CDA"). Aquí solo hay funciones
 * puras (estado y formato); los datos los arma JornadaService.
 */

export type MomentoJornada = 'SALIDA_DPI' | 'LLEGADA_RECINTO' | 'SALIDA_RECINTO' | 'LLEGADA_DPI';
export type VistaJornada = MomentoJornada | 'NO_CDA' | 'KIT';
/** Cómo se agrupan los resúmenes: por técnico del distributivo, por cantón o (solo NO CDA) por CDA. */
export type AgrupacionJornada = 'tec' | 'can' | 'cda';

export const MOMENTOS_JORNADA: MomentoJornada[] = ['SALIDA_DPI', 'LLEGADA_RECINTO', 'SALIDA_RECINTO', 'LLEGADA_DPI'];

export interface TecnicoJornada {
  /** Orden en el distributivo (desde 1); null = el recinto no figura en el distributivo. */
  numero: number | null;
  nombre: string;
}

export interface CantonJornada {
  /** Código del cantón (30 = Ibarra…); null = sin cantón. */
  codigo: number | null;
  nombre: string;
}

export interface PersonaJornada {
  nombre: string;
  telefono: string | null;
  rol: 'Op.' | 'Asis.';
}

export interface RegistroJornada {
  en: Date;
  /** Se registró sin señal: la hora puede haber llegado tarde al servidor. */
  sinSenal: boolean;
}

/** Un kit del evento con su recinto CDA y las personas que lo llevan. */
export interface UnidadJornada {
  codigoRecinto: string;
  nombreRecinto: string;
  tecnico: TecnicoJornada;
  canton: CantonJornada;
  personas: PersonaJornada[];
  registros: Partial<Record<MomentoJornada, RegistroJornada>>;
  /** El Asistente Transversal registró la recepción del kit en la Delegación. */
  kitRecibido: Date | null;
}

export interface NoCdaJornada {
  codigoRecinto: string;
  nombreRecinto: string;
  codigoCda: string;
  nombreCda: string;
  tecnico: TecnicoJornada;
  canton: CantonJornada;
  /** Quienes llevan el kit de su CDA (vacío si el CDA no tiene kit). */
  personas: PersonaJornada[];
  visita: RegistroJornada | null;
  /** Su CDA tiene kit en el evento; si no, nadie irá hoy y el NO CDA no cuenta. */
  cdaConKit: boolean;
}

export interface SinKitJornada {
  codigoRecinto: string;
  nombreRecinto: string;
  tecnico: TecnicoJornada;
  canton: CantonJornada;
}

export interface Jornada {
  evento: string;
  unidades: UnidadJornada[];
  noCdas: NoCdaJornada[];
  /** Recintos CDA sin kit asignado: van aparte y no cuentan como "faltan". */
  sinKit: SinKitJornada[];
  /** No se pudo leer el distributivo: todo queda en "Sin técnico". */
  sinDistributivo: boolean;
}

/** Botones fijos del grupo Jornada (el texto que mandan es el que se compara). */
export const BOTONES_JORNADA: Record<VistaJornada, string> = {
  SALIDA_DPI: '🚐 Salida DPEI',
  LLEGADA_RECINTO: '📍 Llegada recinto',
  SALIDA_RECINTO: '🏁 Salida recinto',
  LLEGADA_DPI: '🏢 Llegada DPEI',
  NO_CDA: '🏫 Llegada NO CDA',
  KIT: '📦 Kit pendiente',
};
export const BOTON_CONSULTAR_CDA = '🔎 Consultar CDA';
/** Textos de botones que ya cambiaron: un teclado viejo en el celular sigue funcionando. */
const BOTONES_ANTERIORES: [VistaJornada, string][] = [['NO_CDA', '🏫 Visitas NO CDA']];

const TITULOS: Record<VistaJornada, string> = {
  SALIDA_DPI: '🚐 Salida del DPEI',
  LLEGADA_RECINTO: '📍 Llegada al recinto',
  SALIDA_RECINTO: '🏁 Salida del recinto',
  LLEGADA_DPI: '🏢 Llegada al DPEI',
  NO_CDA: '🏫 Llegada de los NO CDA a su CDA',
  KIT: '📦 Kit pendiente',
};

const YA_CUMPLIERON: Record<Exclude<VistaJornada, 'KIT' | 'NO_CDA'>, string> = {
  SALIDA_DPI: 'YA SALIERON',
  LLEGADA_RECINTO: 'YA LLEGARON',
  SALIDA_RECINTO: 'YA SALIERON DEL RECINTO',
  LLEGADA_DPI: 'YA LLEGARON AL DPEI',
};

/** Código corto de cada vista en el callback_data ("jor:sd:t:3:0"). */
const CLAVE_VISTA: Record<VistaJornada, string> = {
  SALIDA_DPI: 'sd',
  LLEGADA_RECINTO: 'lr',
  SALIDA_RECINTO: 'sr',
  LLEGADA_DPI: 'ld',
  NO_CDA: 'nc',
  KIT: 'kp',
};
const VISTA_POR_CLAVE = new Map<string, VistaJornada>(
  (Object.entries(CLAVE_VISTA) as [VistaJornada, string][]).map(([v, c]) => [c, v]),
);
const CLAVE_AGRUPACION: Record<AgrupacionJornada, string> = { tec: 't', can: 'c', cda: 'd' };

export const PREFIJO_CALLBACK_JORNADA = 'jor:';
/**
 * "jor:<vista>:<t|c|d>:<grupo>:<página>". Grupo: número de técnico o código de cantón,
 * "sin", "res" (resumen) o "tod" (todos los que faltan). Sin "t|c|d" (botones de antes)
 * se toma por técnico. "d" (por CDA) solo tiene resumen y "tod": cada CDA abre su ficha.
 */
const CALLBACK_JORNADA = /^jor:(sd|lr|sr|ld|nc|kp):(?:(t|c|d):)?([1-9]\d{0,2}|sin|res|tod):(\d{1,2})$/;
/** Ficha de un CDA: "jor:cda:1133" (codigo_recinto es VarChar(20)). */
const CALLBACK_FICHA_CDA = /^jor:cda:([\w-]{1,20})$/;
/** Frecuencia del resumen automático: "jor:frec" abre las opciones, "jor:frec:30" la cambia. */
const CALLBACK_FRECUENCIA = /^jor:frec(?::(\d{1,3}))?$/;
export const CALLBACK_VER_FRECUENCIA = 'jor:frec';

export type SeleccionJornada = number | 'sin' | 'res' | 'tod';

export interface BotonJornada {
  vista: VistaJornada;
  agrupacion: AgrupacionJornada;
  seleccion: SeleccionJornada;
  pagina: number;
}

export function callbackJornada({ vista, agrupacion, seleccion, pagina }: BotonJornada): string {
  return `${PREFIJO_CALLBACK_JORNADA}${CLAVE_VISTA[vista]}:${CLAVE_AGRUPACION[agrupacion]}:${seleccion}:${pagina}`;
}

export function callbackFichaCda(codigo: string): string {
  return `${PREFIJO_CALLBACK_JORNADA}cda:${codigo}`;
}

/** null si el callback_data no es de un resumen de la Jornada o viene mal formado. */
export function leerCallbackJornada(data: string | undefined): BotonJornada | null {
  const m = CALLBACK_JORNADA.exec(data ?? '');
  if (!m) return null;
  const vista = VISTA_POR_CLAVE.get(m[1])!;
  let agrupacion: AgrupacionJornada = m[2] === 'c' ? 'can' : m[2] === 'd' ? 'cda' : 'tec';
  let seleccion: SeleccionJornada = m[3] === 'sin' || m[3] === 'res' || m[3] === 'tod' ? m[3] : Number(m[3]);
  // "Por CDA" solo existe en Llegada NO CDA y no tiene grupos: lo demás vuelve al resumen.
  if (agrupacion === 'cda' && vista !== 'NO_CDA') agrupacion = 'tec';
  else if (agrupacion === 'cda' && seleccion !== 'tod') seleccion = 'res';
  return { vista, agrupacion, seleccion, pagina: Number(m[4]) };
}

/** El código del CDA de un botón de ficha, o null. */
export function leerCallbackFichaCda(data: string | undefined): string | null {
  return CALLBACK_FICHA_CDA.exec(data ?? '')?.[1] ?? null;
}

/** La vista que pide un botón fijo, o null si el texto no es de la Jornada. */
export function vistaDeTexto(texto: string): VistaJornada | null {
  const limpio = texto.trim().toLowerCase();
  for (const [vista, boton] of [...Object.entries(BOTONES_JORNADA), ...BOTONES_ANTERIORES] as [VistaJornada, string][]) {
    if (limpio === boton.toLowerCase()) return vista;
  }
  return null;
}

export function tecladoFijoJornada() {
  return {
    keyboard: [
      [{ text: BOTONES_JORNADA.SALIDA_DPI }, { text: BOTONES_JORNADA.LLEGADA_RECINTO }],
      [{ text: BOTONES_JORNADA.SALIDA_RECINTO }, { text: BOTONES_JORNADA.LLEGADA_DPI }],
      [{ text: BOTONES_JORNADA.NO_CDA }, { text: BOTONES_JORNADA.KIT }],
      [{ text: BOTON_CONSULTAR_CDA }],
    ],
    resize_keyboard: true,
  };
}

// ─── Grupos (técnico o cantón) ──────────────────────────────────────────────

/** Un grupo de un resumen: un técnico o un cantón. */
export interface GrupoJornada {
  clave: number | 'sin';
  nombre: string;
}

type ConGrupo = { tecnico: TecnicoJornada; canton: CantonJornada };

export function grupoDe(x: ConGrupo, agrupacion: AgrupacionJornada): GrupoJornada {
  if (agrupacion === 'can') {
    return x.canton.codigo === null ? { clave: 'sin', nombre: 'Sin cantón' } : { clave: x.canton.codigo, nombre: x.canton.nombre };
  }
  return x.tecnico.numero === null ? { clave: 'sin', nombre: 'Sin técnico' } : { clave: x.tecnico.numero, nombre: x.tecnico.nombre };
}

/** Técnicos en el orden del distributivo, o cantones por nombre; "Sin …" al final. */
export function gruposDe(j: Jornada, agrupacion: AgrupacionJornada): GrupoJornada[] {
  const vistos = new Map<number | 'sin', GrupoJornada>();
  for (const x of [...j.unidades, ...noCdasQueCuentan(j), ...j.sinKit]) {
    const g = grupoDe(x, agrupacion);
    if (!vistos.has(g.clave)) vistos.set(g.clave, g);
  }
  return [...vistos.values()].sort((a, b) => {
    if (a.clave === 'sin' || b.clave === 'sin') return a.clave === 'sin' ? 1 : -1;
    return agrupacion === 'tec' ? a.clave - b.clave : a.nombre.localeCompare(b.nombre, 'es');
  });
}

function delGrupo<T extends ConGrupo>(items: T[], g: GrupoJornada, agrupacion: AgrupacionJornada): T[] {
  return items.filter((i) => grupoDe(i, agrupacion).clave === g.clave);
}

// ─── Estado de cada vista ───────────────────────────────────────────────────

/** Una fila de la lista: el recinto en negrita, las personas debajo. */
export interface ItemJornada extends ConGrupo {
  codigoRecinto: string;
  nombreRecinto: string;
  personas: PersonaJornada[];
  /** Hora del registro (en "ya cumplieron") o de lo que dejó el kit pendiente. */
  registro: RegistroJornada | null;
  /** Texto corto al lado del recinto (kit: qué falta). */
  nota?: string;
  /** Solo NO CDA: su CDA, para agruparlos debajo de él. */
  cda?: { codigo: string; nombre: string };
}

export interface EstadoVista {
  faltan: ItemJornada[];
  cumplidos: ItemJornada[];
}

const porCodigo = (a: { codigoRecinto: string; nombreRecinto: string }, b: { codigoRecinto: string; nombreRecinto: string }) =>
  a.codigoRecinto.localeCompare(b.codigoRecinto, 'es', { numeric: true }) ||
  a.nombreRecinto.localeCompare(b.nombreRecinto, 'es');

/** Faltan y cumplidos de una vista. En "Kit pendiente" no hay cumplidos: solo
 * quien llegó al DPEI sin que se reciba el kit, o al revés. */
export function estadoVista(j: Jornada, vista: VistaJornada): EstadoVista {
  if (vista === 'NO_CDA') {
    const items = noCdasQueCuentan(j).map(
      (n): ItemJornada => ({
        tecnico: n.tecnico,
        canton: n.canton,
        codigoRecinto: n.codigoRecinto,
        nombreRecinto: n.nombreRecinto,
        personas: n.personas,
        registro: n.visita,
        cda: { codigo: n.codigoCda, nombre: n.nombreCda },
      }),
    );
    return {
      faltan: items.filter((i) => !i.registro).sort(porCodigo),
      cumplidos: items.filter((i) => i.registro).sort(porCodigo),
    };
  }
  if (vista === 'KIT') {
    const faltan: ItemJornada[] = [];
    for (const u of j.unidades) {
      const pendiente = kitPendiente(u);
      if (pendiente) faltan.push({ ...base(u), ...pendiente });
    }
    return { faltan: faltan.sort(porCodigo), cumplidos: [] };
  }
  const items = j.unidades.map((u): ItemJornada => ({ ...base(u), registro: u.registros[vista] ?? null }));
  return {
    faltan: items.filter((i) => !i.registro).sort(porCodigo),
    cumplidos: items.filter((i) => i.registro).sort(porCodigo),
  };
}

/** Llegó al DPEI sin que se reciba el kit, o se recibió el kit sin marcar la llegada; null si está en regla. */
function kitPendiente(u: UnidadJornada): { registro: RegistroJornada; nota: string } | null {
  const llegada = u.registros.LLEGADA_DPI ?? null;
  if (llegada && !u.kitRecibido) return { registro: llegada, nota: 'llegó al DPEI · el kit no se ha recibido' };
  if (!llegada && u.kitRecibido) {
    return { registro: { en: u.kitRecibido, sinSenal: false }, nota: 'kit recibido · falta marcar la llegada al DPEI' };
  }
  return null;
}

/** Los NO CDA de un CDA sin kit no cuentan: nadie va a ir a ellos en este evento. */
function noCdasQueCuentan(j: Jornada): NoCdaJornada[] {
  return j.noCdas.filter((n) => n.cdaConKit);
}

function base(u: UnidadJornada): Omit<ItemJornada, 'registro'> {
  return {
    tecnico: u.tecnico,
    canton: u.canton,
    codigoRecinto: u.codigoRecinto,
    nombreRecinto: u.nombreRecinto,
    personas: u.personas,
  };
}

// ─── Formato ────────────────────────────────────────────────────────────────

/** Límite de Telegram por mensaje (4096) con margen. */
const MAX_LARGO_MENSAJE = 3800;
const ANCHO_BARRA = 10;
const ANCHO_BARRA_GRUPO = 5;

function barra(valor: number, total: number, ancho: number): string {
  const llenos = total > 0 ? Math.round((valor / total) * ancho) : 0;
  // Con al menos uno hecho se ve al menos un bloque, y lleno solo si están todos.
  const ajustado = valor > 0 && llenos === 0 ? 1 : valor < total && llenos === ancho ? ancho - 1 : llenos;
  return '▓'.repeat(ajustado) + '░'.repeat(ancho - ajustado);
}

/** "14:35" en hora de Ecuador. */
export function hora(fecha: Date): string {
  return fecha.toLocaleTimeString('es-EC', {
    timeZone: 'America/Guayaquil',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** "0991234567" → "+593991234567", para que Telegram lo deje tocar y llamar. */
export function telefonoTelegram(telefono: string | null): string | null {
  const digitos = (telefono ?? '').replace(/\D/g, '');
  if (!digitos) return null;
  if (digitos.startsWith('593')) return `+${digitos}`;
  if (digitos.startsWith('0') && digitos.length === 10) return `+593${digitos.slice(1)}`;
  return digitos;
}

function lineaPersonas(personas: PersonaJornada[], sangria = '   '): string {
  if (personas.length === 0) return `${sangria}<i>sin personas asignadas</i>`;
  return (
    sangria +
    personas
      .map((p) => {
        const tel = telefonoTelegram(p.telefono);
        return `${escapeHtml(p.nombre)} (${p.rol})${tel ? ` ${escapeHtml(tel)}` : ''}`;
      })
      .join(' · ')
  );
}

function horaDe(r: RegistroJornada): string {
  return `${hora(r.en)}${r.sinSenal ? ' 📴' : ''}`;
}

function bloqueItem(i: ItemJornada, conHora: boolean): string {
  const horaTxt = conHora && i.registro ? ` · ${horaDe(i.registro)}` : '';
  const nota = i.nota ? ` · <i>${escapeHtml(i.nota)}</i>` : '';
  return `<b>${escapeHtml(i.codigoRecinto)} · ${escapeHtml(i.nombreRecinto)}</b>${horaTxt}${nota}\n${lineaPersonas(i.personas)}`;
}

/**
 * NO CDA agrupados debajo de su CDA ("1133 · … — 1 de 2 llegaron"), primero
 * los CDA a los que les falta alguno. Con `soloFaltan`, cada CDA lista solo sus pendientes.
 */
function bloquesNoCdaPorCda(items: ItemJornada[], soloFaltan: boolean): string[] {
  const porCda = new Map<string, ItemJornada[]>();
  for (const i of items) porCda.set(i.cda!.codigo, [...(porCda.get(i.cda!.codigo) ?? []), i]);
  const cdas = [...porCda.values()].sort((a, b) => {
    const pendientes = (xs: ItemJornada[]) => xs.filter((x) => !x.registro).length;
    return (pendientes(b) > 0 ? 1 : 0) - (pendientes(a) > 0 ? 1 : 0) || porCodigo(
      { codigoRecinto: a[0].cda!.codigo, nombreRecinto: a[0].cda!.nombre },
      { codigoRecinto: b[0].cda!.codigo, nombreRecinto: b[0].cda!.nombre },
    );
  });
  return cdas.flatMap((ncs) => {
    const { codigo, nombre } = ncs[0].cda!;
    const reportados = ncs.filter((n) => n.registro).length;
    const visibles = soloFaltan ? ncs.filter((n) => !n.registro) : ncs;
    if (visibles.length === 0) return [];
    const lineas = [...visibles].sort((a, b) => (a.registro ? 1 : 0) - (b.registro ? 1 : 0) || porCodigo(a, b)).map(
      (n) =>
        `   ${n.registro ? '✅' : '⏳'} ${escapeHtml(n.codigoRecinto)} · ${escapeHtml(n.nombreRecinto)}` +
        (n.registro ? ` · ${horaDe(n.registro)}` : ''),
    );
    return [
      [
        `<b>${escapeHtml(codigo)} · ${escapeHtml(nombre)}</b> — ${reportados} de ${ncs.length} ${ncs.length === 1 ? 'llegó' : 'llegaron'}`,
        ncs[0].personas.length > 0 ? lineaPersonas(ncs[0].personas) : '   <i>su CDA no tiene kit</i>',
        ...lineas,
      ].join('\n'),
    ];
  });
}

function encabezado(j: Jornada, vista: VistaJornada, ahora: Date, sufijo = ''): string {
  return `<b>${TITULOS[vista]}${sufijo ? ` · ${escapeHtml(sufijo)}` : ''}</b> · ${hora(ahora)}\n<i>${escapeHtml(j.evento)}</i>`;
}

function avisoDistributivo(j: Jornada, agrupacion: AgrupacionJornada): string {
  return j.sinDistributivo && agrupacion === 'tec'
    ? '\n\n⚠️ No se pudo leer el distributivo de técnicos: todo aparece en "Sin técnico".'
    : '';
}

/** Avance de NO CDA de un CDA. */
export interface AvanceCda {
  codigo: string;
  nombre: string;
  reportados: number;
  total: number;
}

/** Un avance por CDA con NO CDA: primero los incompletos, luego por código. */
export function avancePorCda(items: ItemJornada[]): AvanceCda[] {
  const porCda = new Map<string, AvanceCda>();
  for (const i of items) {
    const a = porCda.get(i.cda!.codigo) ?? { codigo: i.cda!.codigo, nombre: i.cda!.nombre, reportados: 0, total: 0 };
    a.total++;
    if (i.registro) a.reportados++;
    porCda.set(a.codigo, a);
  }
  const completo = (a: AvanceCda) => (a.reportados === a.total ? 1 : 0);
  return [...porCda.values()].sort(
    (a, b) => completo(a) - completo(b) || porCodigo({ codigoRecinto: a.codigo, nombreRecinto: a.nombre }, { codigoRecinto: b.codigo, nombreRecinto: b.nombre }),
  );
}

/** "⚪ N NO CDA de CDA sin kit (no cuentan)", o nada. */
function lineaNoCdaSinKit(j: Jornada): string[] {
  const fuera = j.noCdas.length - noCdasQueCuentan(j).length;
  return fuera > 0 ? ['', `⚪ ${fuera} NO CDA de CDA sin kit (no cuentan)`] : [];
}

const SUFIJO_AGRUPACION: Record<AgrupacionJornada, string> = { tec: '', can: 'por cantón', cda: 'por CDA' };

/** Resumen de una vista: el avance total y una línea por técnico o cantón. */
export function formatearResumenJornada(
  j: Jornada,
  vista: VistaJornada,
  ahora: Date,
  agrupacion: AgrupacionJornada = 'tec',
): string {
  const estado = estadoVista(j, vista);
  const lineas = [encabezado(j, vista, ahora, SUFIJO_AGRUPACION[agrupacion]), ''];

  if (vista === 'KIT') {
    lineas.push(
      estado.faltan.length === 0
        ? '✅ Nadie tiene el kit pendiente.'
        : `<b>${estado.faltan.length}</b> con el kit pendiente`,
    );
    for (const g of gruposDe(j, agrupacion)) {
      const n = delGrupo(estado.faltan, g, agrupacion).length;
      if (n > 0) lineas.push(`${escapeHtml(g.nombre)} · ${n}`);
    }
    return lineas.join('\n') + avisoDistributivo(j, agrupacion);
  }

  const total = estado.faltan.length + estado.cumplidos.length;
  if (total === 0) {
    lineas.push(
      vista === 'NO_CDA' ? 'No hay recintos NO CDA de un CDA con kit en este evento.' : 'Todavía no hay kits asignados en este evento.',
    );
    if (vista === 'NO_CDA') lineas.push(...lineaNoCdaSinKit(j));
    return lineas.join('\n') + avisoDistributivo(j, agrupacion);
  }
  const hechos = estado.cumplidos.length;
  lineas.push(
    `<code>${barra(hechos, total, ANCHO_BARRA)}</code>  <b>${hechos} de ${total}</b>` +
      (estado.faltan.length > 0 ? ` · faltan ${estado.faltan.length}` : ' ✅'),
  );
  if (vista === 'NO_CDA') {
    const avance = avancePorCda([...estado.faltan, ...estado.cumplidos]);
    const completos = avance.filter((a) => a.reportados === a.total).length;
    lineas.push(`🏫 ${completos} de ${avance.length} CDA completos (llegaron todos sus NO CDA)`);
    // Por CDA no hay técnicos: no hace falta el aviso del distributivo.
    if (agrupacion === 'cda') {
      // Va antes de la lista: si el mensaje se recorta, se pierde el final.
      lineas.push(...lineaNoCdaSinKit(j), '');
      for (const a of avance) {
        lineas.push(
          `${a.reportados === a.total ? '✅' : '⏳'} <b>${escapeHtml(a.codigo)}</b> · ${escapeHtml(a.nombre)} — ${a.reportados}/${a.total}`,
        );
      }
      return recortarPorLineas(lineas);
    }
  }
  lineas.push('');
  for (const g of gruposDe(j, agrupacion)) {
    const f = delGrupo(estado.faltan, g, agrupacion).length;
    const c = delGrupo(estado.cumplidos, g, agrupacion).length;
    if (f + c === 0) continue;
    lineas.push(
      `${escapeHtml(g.nombre)}  <code>${barra(c, f + c, ANCHO_BARRA_GRUPO)}</code> ${c}/${f + c}` +
        (f > 0 ? `  faltan ${f}` : '  ✅'),
    );
  }
  if (vista === 'NO_CDA') {
    lineas.push(...lineaNoCdaSinKit(j));
  } else if (j.sinKit.length > 0) {
    lineas.push('', `⚪ ${j.sinKit.length} recinto${j.sinKit.length === 1 ? '' : 's'} CDA sin kit asignado (no cuentan)`);
  }
  return lineas.join('\n') + avisoDistributivo(j, agrupacion);
}

/** Páginas del detalle de un técnico o cantón (o de todos los que faltan, con "tod"). */
export function paginasDetalleJornada(
  j: Jornada,
  vista: VistaJornada,
  seleccion: number | 'sin' | 'tod',
  ahora: Date,
  agrupacion: AgrupacionJornada = 'tec',
): string[] {
  const estado = estadoVista(j, vista);
  const grupos = gruposDe(j, agrupacion);
  const grupo = seleccion === 'tod' ? null : grupos.find((g) => g.clave === seleccion);
  const faltan = grupo ? delGrupo(estado.faltan, grupo, agrupacion) : estado.faltan;
  const cumplidos = grupo ? delGrupo(estado.cumplidos, grupo, agrupacion) : [];
  const total = faltan.length + cumplidos.length;

  const sufijo = grupo ? grupo.nombre : 'todos los que faltan';
  const resumen = vista === 'KIT' || !grupo ? `Faltan <b>${faltan.length}</b>` : `Faltan <b>${faltan.length}</b> de ${total}`;
  const cabeza = `${encabezado(j, vista, ahora, sufijo)}\n${resumen}`;

  if (vista === 'NO_CDA') {
    // En "todos los que faltan" se cuentan todos los NO CDA de cada CDA, pero solo se listan los pendientes.
    const deCadaCda = grupo ? [...faltan, ...cumplidos] : [...estado.faltan, ...estado.cumplidos];
    const bloques = faltan.length === 0 ? ['✅ No falta nadie.'] : [];
    bloques.push(...bloquesNoCdaPorCda(deCadaCda, !grupo));
    return paginar(cabeza, bloques);
  }

  const bloques: string[] = [];
  if (faltan.length > 0) {
    bloques.push(`<b>⏳ ${vista === 'KIT' ? 'PENDIENTES' : 'FALTAN'} (${faltan.length})</b>`);
    if (grupo) {
      bloques.push(...faltan.map((i) => bloqueItem(i, vista === 'KIT')));
    } else {
      // "Todos": agrupados para saber a quién llamar.
      for (const g of grupos) {
        const suyos = delGrupo(faltan, g, agrupacion);
        if (suyos.length === 0) continue;
        bloques.push(`<u>${escapeHtml(g.nombre)} (${suyos.length})</u>`, ...suyos.map((i) => bloqueItem(i, vista === 'KIT')));
      }
    }
  } else {
    bloques.push(vista === 'KIT' ? '✅ Nadie tiene el kit pendiente.' : '✅ No falta nadie.');
  }
  if (cumplidos.length > 0 && vista !== 'KIT') {
    bloques.push(`<b>✅ ${YA_CUMPLIERON[vista]} (${cumplidos.length})</b>`, ...cumplidos.map((i) => bloqueItem(i, true)));
  }
  if (grupo && vista !== 'KIT') {
    const sinKit = delGrupo(j.sinKit, grupo, agrupacion);
    if (sinKit.length > 0) {
      bloques.push(
        `<b>⚪ SIN KIT ASIGNADO (${sinKit.length})</b>`,
        ...sinKit.map((s) => `${escapeHtml(s.codigoRecinto)} · ${escapeHtml(s.nombreRecinto)}`),
      );
    }
  }
  return paginar(cabeza, bloques);
}

/** Reparte los bloques en mensajes que Telegram acepta; cada página repite el encabezado. */
function paginar(cabeza: string, bloques: string[]): string[] {
  const paginas: string[] = [];
  let actual = '';
  for (const bloque of bloques) {
    const candidato = actual ? `${actual}\n\n${bloque}` : bloque;
    if (actual && `${cabeza}\n\n${candidato}`.length > MAX_LARGO_MENSAJE) {
      paginas.push(actual);
      actual = bloque;
    } else {
      actual = candidato;
    }
  }
  paginas.push(actual);
  return paginas.map((p, i) => `${cabeza}${paginas.length > 1 ? ` · pág. ${i + 1}/${paginas.length}` : ''}\n\n${p}`);
}

type BotonInline = { text: string; callback_data: string };

/** Telegram no acepta más de 100 botones por teclado; quedan lugares para la navegación. */
const MAX_BOTONES_CDA = 90;

/** Botones de técnicos o cantones (con cuántos faltan) bajo el resumen o el detalle. */
export function tecladoJornada(
  j: Jornada,
  vista: VistaJornada,
  seleccion: SeleccionJornada = 'res',
  pagina = 0,
  paginas = 1,
  agrupacion: AgrupacionJornada = 'tec',
) {
  const estado = estadoVista(j, vista);
  const boton = (b: Omit<BotonJornada, 'vista' | 'agrupacion'> & Partial<BotonJornada>) =>
    callbackJornada({ vista, agrupacion, ...b });
  const porCda = agrupacion === 'cda';
  // Por CDA: cada CDA abre su ficha (sus NO CDA, quién lleva el kit y sus teléfonos).
  const botones = porCda
    ? avancePorCda([...estado.faltan, ...estado.cumplidos]).slice(0, MAX_BOTONES_CDA).map((a) => ({
        text: `${a.codigo} ${a.nombre}`.slice(0, 22) + ` · ${a.reportados === a.total ? '✅' : a.total - a.reportados}`,
        callback_data: callbackFichaCda(a.codigo),
      }))
    : gruposDe(j, agrupacion)
        .map((g) => {
          const f = delGrupo(estado.faltan, g, agrupacion).length;
          const c = vista === 'KIT' ? 0 : delGrupo(estado.cumplidos, g, agrupacion).length;
          if (f + c === 0) return null;
          const texto = `${g.nombre} · ${f > 0 ? f : '✅'}`;
          return { text: g.clave === seleccion ? `• ${texto} •` : texto, callback_data: boton({ seleccion: g.clave, pagina: 0 }) };
        })
        .filter((b): b is BotonInline => b !== null);

  const porFila = porCda ? 2 : 3;
  const filas: BotonInline[][] = [];
  for (let i = 0; i < botones.length; i += porFila) filas.push(botones.slice(i, i + porFila));

  const navegacion: BotonInline[] = [];
  if (seleccion !== 'res') navegacion.push({ text: '◀ Resumen', callback_data: boton({ seleccion: 'res', pagina: 0 }) });
  if (pagina > 0) navegacion.push({ text: '◀ Pág.', callback_data: boton({ seleccion, pagina: pagina - 1 }) });
  if (pagina < paginas - 1) navegacion.push({ text: 'Pág. ▶', callback_data: boton({ seleccion, pagina: pagina + 1 }) });
  navegacion.push({ text: '↻ Actualizar', callback_data: boton({ seleccion, pagina }) });
  filas.push(navegacion);

  if (seleccion === 'res') {
    if (estado.faltan.length > 0) {
      filas.push([{ text: 'Ver todos los que faltan', callback_data: boton({ seleccion: 'tod', pagina: 0 }) }]);
    }
    const opciones: [AgrupacionJornada, string][] = [
      ['tec', '👷 Por técnico'],
      ['can', '🗺️ Por cantón'],
      ...(vista === 'NO_CDA' ? [['cda', '🏫 Por CDA'] as [AgrupacionJornada, string]] : []),
    ];
    filas.push(
      opciones.map(([a, texto]) => ({
        text: agrupacion === a ? `• ${texto} •` : texto,
        callback_data: boton({ agrupacion: a, seleccion: 'res', pagina: 0 }),
      })),
    );
  }
  return { inline_keyboard: filas };
}

/** El resumen de Llegada NO CDA por CDA (botón para volver desde una ficha). */
export const CALLBACK_NO_CDA_POR_CDA = callbackJornada({ vista: 'NO_CDA', agrupacion: 'cda', seleccion: 'res', pagina: 0 });

// ─── Consultar CDA ──────────────────────────────────────────────────────────

const ETIQUETA_MOMENTO: Record<MomentoJornada, [hecho: string, falta: string]> = {
  SALIDA_DPI: ['🚐 Salió del DPEI', '🚐 Falta salir del DPEI'],
  LLEGADA_RECINTO: ['📍 Llegó al recinto', '📍 Falta llegar al recinto'],
  SALIDA_RECINTO: ['🏁 Salió del recinto', '🏁 Falta salir del recinto'],
  LLEGADA_DPI: ['🏢 Llegó al DPEI', '🏢 Falta llegar al DPEI'],
};

/**
 * Ficha de un CDA: técnico y cantón, cada pareja con sus 4 momentos, el kit y
 * las personas, y sus NO CDA que llegaron o faltan. null si el código no es
 * un CDA de la jornada.
 */
export function formatearFichaCda(j: Jornada, codigo: string, ahora: Date): string | null {
  const unidades = j.unidades.filter((u) => u.codigoRecinto === codigo);
  const sinKit = j.sinKit.find((s) => s.codigoRecinto === codigo);
  const ref = unidades[0] ?? sinKit;
  if (!ref) return null;
  const tecnico = ref.tecnico.numero === null ? 'sin técnico' : `Técnico: ${ref.tecnico.nombre}`;
  const lineas = [
    `<b>🔎 ${escapeHtml(codigo)} · ${escapeHtml(ref.nombreRecinto)}</b> · ${hora(ahora)}`,
    `${escapeHtml(ref.canton.nombre)} · ${escapeHtml(tecnico)}`,
    `<i>${escapeHtml(j.evento)}</i>`,
  ];

  if (unidades.length === 0) lineas.push('', '⚪ Sin kit asignado en este evento.');
  unidades.forEach((u, i) => {
    lineas.push('');
    if (unidades.length > 1) lineas.push(`<u>Pareja ${i + 1}</u>`);
    for (const m of MOMENTOS_JORNADA) {
      const r = u.registros[m];
      lineas.push(r ? `${ETIQUETA_MOMENTO[m][0]} ${horaDe(r)}` : ETIQUETA_MOMENTO[m][1]);
    }
    const pendiente = kitPendiente(u);
    lineas.push(
      u.kitRecibido
        ? `📦 Kit recibido en el DPEI ${hora(u.kitRecibido)}${pendiente ? ' · falta marcar la llegada al DPEI' : ''}`
        : `📦 Kit: aún no se recibe en el DPEI${pendiente ? ' · ⚠️ ya llegó al DPEI' : ''}`,
    );
    lineas.push(lineaPersonas(u.personas, ''));
  });

  const ncs = j.noCdas.filter((n) => n.codigoCda === codigo).sort(porCodigo);
  if (ncs.length > 0) {
    const reportados = ncs.filter((n) => n.visita).length;
    lineas.push('', `🏫 <b>NO CDA: ${reportados} de ${ncs.length} ${ncs.length === 1 ? 'llegó' : 'llegaron'}</b>`);
    for (const n of [...ncs].sort((a, b) => (a.visita ? 1 : 0) - (b.visita ? 1 : 0))) {
      lineas.push(
        `   ${n.visita ? '✅' : '⏳'} ${escapeHtml(n.codigoRecinto)} · ${escapeHtml(n.nombreRecinto)}` +
          (n.visita ? ` · ${horaDe(n.visita)}` : ''),
      );
    }
  }
  return recortarPorLineas(lineas);
}

/** Si no cabe en un mensaje, quita líneas completas del final (nunca corta una etiqueta HTML) y lo dice. */
function recortarPorLineas(lineas: string[]): string {
  if (lineas.join('\n').length <= MAX_LARGO_MENSAJE) return lineas.join('\n');
  const quedan = [...lineas];
  let quitadas = 0;
  const aviso = (n: number) => `<i>… y ${n} línea${n === 1 ? '' : 's'} más</i>`;
  while (quedan.length > 1 && [...quedan, aviso(quitadas)].join('\n').length > MAX_LARGO_MENSAJE) {
    quedan.pop();
    quitadas++;
  }
  return [...quedan, aviso(quitadas)].join('\n');
}

/** Botón ↻ bajo la ficha de un CDA; si el CDA tiene NO CDA que cuentan, también el resumen por CDA. */
export function tecladoFichaCda(j: Jornada, codigo: string) {
  const fila: BotonInline[] = [{ text: '↻ Actualizar', callback_data: callbackFichaCda(codigo) }];
  if (noCdasQueCuentan(j).some((n) => n.codigoCda === codigo)) {
    fila.push({ text: '🏫 NO CDA por CDA', callback_data: CALLBACK_NO_CDA_POR_CDA });
  }
  return { inline_keyboard: [fila] };
}

/** Recinto que se puede consultar: un CDA de la jornada o un NO CDA (que lleva a su CDA). */
export interface ConsultableJornada {
  codigoRecinto: string;
  nombreRecinto: string;
  canton: string | null;
  parroquia: string;
  /** El CDA cuya ficha se muestra (el mismo código si es CDA). */
  codigoCda: string;
  esNoCda: boolean;
}

export function consultablesDe(j: Jornada): ConsultableJornada[] {
  const vistos = new Map<string, ConsultableJornada>();
  for (const c of [...j.unidades, ...j.sinKit]) {
    if (vistos.has(c.codigoRecinto)) continue;
    vistos.set(c.codigoRecinto, {
      codigoRecinto: c.codigoRecinto,
      nombreRecinto: c.nombreRecinto,
      canton: c.canton.nombre,
      parroquia: '',
      codigoCda: c.codigoRecinto,
      esNoCda: false,
    });
  }
  for (const n of j.noCdas) {
    if (vistos.has(n.codigoRecinto)) continue;
    vistos.set(n.codigoRecinto, {
      codigoRecinto: n.codigoRecinto,
      nombreRecinto: n.nombreRecinto,
      canton: n.canton.nombre,
      parroquia: '',
      codigoCda: n.codigoCda,
      esNoCda: true,
    });
  }
  return [...vistos.values()];
}

// ─── Resumen automático ─────────────────────────────────────────────────────

/** Avance de una vista: cuántos cumplieron de cuántos. */
export interface AvanceVista {
  hechos: number;
  total: number;
}

/** Lo que cuenta el resumen automático; si no cambia, no se manda otro. */
export interface ConteosJornada {
  momentos: Record<MomentoJornada | 'NO_CDA', AvanceVista>;
  cdasCompletos: number;
  cdasConNoCda: number;
  kitPendientes: number;
}

export function conteosJornada(j: Jornada): ConteosJornada {
  const avance = (v: VistaJornada): AvanceVista => {
    const e = estadoVista(j, v);
    return { hechos: e.cumplidos.length, total: e.faltan.length + e.cumplidos.length };
  };
  const noCda = estadoVista(j, 'NO_CDA');
  const porCda = avancePorCda([...noCda.faltan, ...noCda.cumplidos]);
  return {
    momentos: {
      SALIDA_DPI: avance('SALIDA_DPI'),
      LLEGADA_RECINTO: avance('LLEGADA_RECINTO'),
      SALIDA_RECINTO: avance('SALIDA_RECINTO'),
      LLEGADA_DPI: avance('LLEGADA_DPI'),
      NO_CDA: avance('NO_CDA'),
    },
    cdasCompletos: porCda.filter((a) => a.reportados === a.total).length,
    cdasConNoCda: porCda.length,
    kitPendientes: estadoVista(j, 'KIT').faltan.length,
  };
}

export function mismosConteos(a: ConteosJornada, b: ConteosJornada): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** La jornada del día empezó: al menos una pareja salió del DPEI. */
export function jornadaEmpezada(j: Jornada): boolean {
  return j.unidades.some((u) => u.registros.SALIDA_DPI);
}

/** Todos llegaron al DPEI y no queda ningún kit pendiente. */
export function jornadaCerrada(j: Jornada): boolean {
  return j.unidades.length > 0 && j.unidades.every((u) => u.registros.LLEGADA_DPI) && !j.unidades.some((u) => kitPendiente(u));
}

const ORDEN_RESUMEN: (MomentoJornada | 'NO_CDA')[] = [...MOMENTOS_JORNADA, 'NO_CDA'];

const CAMBIO: Record<MomentoJornada | 'NO_CDA', string> = {
  SALIDA_DPI: '🚐 +{n} salieron del DPEI',
  LLEGADA_RECINTO: '📍 +{n} llegaron al recinto',
  SALIDA_RECINTO: '🏁 +{n} salieron del recinto',
  LLEGADA_DPI: '🏢 +{n} llegaron al DPEI',
  NO_CDA: '🏫 +{n} NO CDA llegaron',
};

/**
 * Resumen de todas las vistas en un mensaje: una línea por momento, NO CDA con
 * los CDA completos, los kits pendientes y, si hay uno anterior, qué cambió desde entonces.
 */
export function formatearResumenAutomatico(
  j: Jornada,
  ahora: Date,
  anterior?: { conteos: ConteosJornada; en: Date } | null,
): string {
  const c = conteosJornada(j);
  const cerrada = jornadaCerrada(j);
  const lineas = [
    cerrada
      ? `<b>✅ Jornada cerrada</b> · ${hora(ahora)}\nTodos llegaron al DPEI y se recibieron todos los kits.`
      : `<b>📋 Jornada</b> · ${hora(ahora)} · resumen automático`,
    `<i>${escapeHtml(j.evento)}</i>`,
    '',
  ];
  for (const v of ORDEN_RESUMEN) {
    const { hechos, total } = c.momentos[v];
    if (total === 0) continue;
    const faltan = total - hechos;
    const extra = v === 'NO_CDA' ? ` · ${c.cdasCompletos} de ${c.cdasConNoCda} CDA completos` : '';
    lineas.push(
      `${BOTONES_JORNADA[v]}  <code>${barra(hechos, total, ANCHO_BARRA)}</code> ${hechos}/${total}` +
        (faltan > 0 ? ` · faltan ${faltan}` : ' ✅') +
        extra,
    );
  }
  lineas.push(c.kitPendientes > 0 ? `${BOTONES_JORNADA.KIT}: ${c.kitPendientes}` : `${BOTONES_JORNADA.KIT}: ninguno`);

  if (anterior) {
    const cambios = ORDEN_RESUMEN.map((v) => ({ v, n: c.momentos[v].hechos - anterior.conteos.momentos[v].hechos }))
      .filter(({ n }) => n > 0)
      .map(({ v, n }) => CAMBIO[v].replace('{n}', String(n)));
    if (cambios.length > 0) lineas.push('', `Desde las ${hora(anterior.en)}: ${cambios.join(' · ')}`);
  }
  return lineas.join('\n');
}

/**
 * null si no es un botón de frecuencia; `minutos: null` si solo pide ver las opciones.
 * Un número que no es una de las opciones se toma como "ver opciones".
 */
export function leerCallbackFrecuencia(data: string | undefined): { minutos: number | null } | null {
  const m = CALLBACK_FRECUENCIA.exec(data ?? '');
  if (!m) return null;
  const minutos = m[1] === undefined ? null : Number(m[1]);
  return { minutos: minutos !== null && (MINUTOS_RESUMEN_JORNADA as readonly number[]).includes(minutos) ? minutos : null };
}

/** 15 → "15 min", 60 → "1 h". */
export function textoFrecuencia(minutos: number): string {
  return minutos < 60 ? `${minutos} min` : `${minutos / 60} h`;
}

export function mensajeFrecuencia(minutos: number, cambiadaAhora = false): string {
  return (
    `⏱ <b>Resumen automático</b>: ${cambiadaAhora ? 'ahora llega' : 'llega'} cada <b>${textoFrecuencia(minutos)}</b>, sin sonido y solo si algo cambió.\n` +
    'Toque otra opción para cambiarla (solo los administradores del grupo).'
  );
}

/** Las opciones de frecuencia; la actual va marcada. */
export function tecladoFrecuencia(actual: number) {
  const boton = (m: number): BotonInline => ({
    text: `${m === actual ? '✅ ' : ''}${textoFrecuencia(m)}`,
    callback_data: `${CALLBACK_VER_FRECUENCIA}:${m}`,
  });
  return { inline_keyboard: [MINUTOS_RESUMEN_JORNADA.slice(0, 3).map(boton), MINUTOS_RESUMEN_JORNADA.slice(3).map(boton)] };
}

/** Un botón por vista bajo el resumen automático: abre su resumen de siempre (NO CDA, por CDA). */
export function tecladoResumenAutomatico() {
  const boton = (v: VistaJornada): BotonInline => ({
    text: BOTONES_JORNADA[v],
    callback_data: callbackJornada({ vista: v, agrupacion: v === 'NO_CDA' ? 'cda' : 'tec', seleccion: 'res', pagina: 0 }),
  });
  return {
    inline_keyboard: [
      [boton('SALIDA_DPI'), boton('LLEGADA_RECINTO')],
      [boton('SALIDA_RECINTO'), boton('LLEGADA_DPI')],
      [boton('NO_CDA'), boton('KIT')],
      [{ text: '⏱ Frecuencia del resumen', callback_data: CALLBACK_VER_FRECUENCIA }],
    ],
  };
}
