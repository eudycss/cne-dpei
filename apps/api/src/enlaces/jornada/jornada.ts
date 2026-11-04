import { escapeHtml } from '../../auth/notifier';

/**
 * Grupo "Jornada" de Telegram: quién falta y quién ya cumplió cada momento del
 * día (salida del DPEI, llegada y salida del recinto, llegada al DPEI), las
 * visitas a los NO CDA y los kits pendientes de entregar, agrupado por técnico.
 * Aquí solo hay funciones puras (estado y formato); los datos los arma
 * JornadaService.
 */

export type MomentoJornada = 'SALIDA_DPI' | 'LLEGADA_RECINTO' | 'SALIDA_RECINTO' | 'LLEGADA_DPI';
export type VistaJornada = MomentoJornada | 'NO_CDA' | 'KIT';

export const MOMENTOS_JORNADA: MomentoJornada[] = ['SALIDA_DPI', 'LLEGADA_RECINTO', 'SALIDA_RECINTO', 'LLEGADA_DPI'];

export interface TecnicoJornada {
  /** Orden en el distributivo (desde 1); null = el recinto no figura en el distributivo. */
  numero: number | null;
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
  personas: PersonaJornada[];
  registros: Partial<Record<MomentoJornada, RegistroJornada>>;
  /** El Asistente Transversal registró la recepción del kit en la Delegación. */
  kitRecibido: Date | null;
}

export interface NoCdaJornada {
  codigoRecinto: string;
  nombreRecinto: string;
  codigoCda: string;
  tecnico: TecnicoJornada;
  /** Quienes llevan el kit de su CDA (vacío si el CDA no tiene kit). */
  personas: PersonaJornada[];
  visita: RegistroJornada | null;
}

export interface SinKitJornada {
  codigoRecinto: string;
  nombreRecinto: string;
  tecnico: TecnicoJornada;
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
  NO_CDA: '🏫 Visitas NO CDA',
  KIT: '📦 Kit pendiente',
};

const TITULOS: Record<VistaJornada, string> = {
  SALIDA_DPI: '🚐 Salida del DPEI',
  LLEGADA_RECINTO: '📍 Llegada al recinto',
  SALIDA_RECINTO: '🏁 Salida del recinto',
  LLEGADA_DPI: '🏢 Llegada al DPEI',
  NO_CDA: '🏫 Visitas a los NO CDA',
  KIT: '📦 Kit pendiente',
};

const YA_CUMPLIERON: Record<Exclude<VistaJornada, 'KIT'>, string> = {
  SALIDA_DPI: 'YA SALIERON',
  LLEGADA_RECINTO: 'YA LLEGARON',
  SALIDA_RECINTO: 'YA SALIERON DEL RECINTO',
  LLEGADA_DPI: 'YA LLEGARON AL DPEI',
  NO_CDA: 'YA VISITADOS',
};

/** Código corto de cada vista en el callback_data ("jor:sd:3:0"). */
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

export const PREFIJO_CALLBACK_JORNADA = 'jor:';
/** Técnico: su número, "sin" (sin técnico), "res" (resumen) o "tod" (todos los que faltan). */
const CALLBACK_JORNADA = /^jor:(sd|lr|sr|ld|nc|kp):([1-9]\d{0,2}|sin|res|tod):(\d{1,2})$/;

export type SeleccionJornada = number | 'sin' | 'res' | 'tod';

export interface BotonJornada {
  vista: VistaJornada;
  seleccion: SeleccionJornada;
  pagina: number;
}

export function callbackJornada({ vista, seleccion, pagina }: BotonJornada): string {
  return `${PREFIJO_CALLBACK_JORNADA}${CLAVE_VISTA[vista]}:${seleccion}:${pagina}`;
}

/** null si el callback_data no es de la Jornada o viene mal formado. */
export function leerCallbackJornada(data: string | undefined): BotonJornada | null {
  const m = CALLBACK_JORNADA.exec(data ?? '');
  if (!m) return null;
  const vista = VISTA_POR_CLAVE.get(m[1])!;
  const seleccion: SeleccionJornada = m[2] === 'sin' || m[2] === 'res' || m[2] === 'tod' ? m[2] : Number(m[2]);
  return { vista, seleccion, pagina: Number(m[3]) };
}

/** La vista que pide un botón fijo (o /salida…), o null si el texto no es de la Jornada. */
export function vistaDeTexto(texto: string): VistaJornada | null {
  const limpio = texto.trim().toLowerCase();
  for (const [vista, boton] of Object.entries(BOTONES_JORNADA) as [VistaJornada, string][]) {
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
    ],
    resize_keyboard: true,
  };
}

// ─── Estado de cada vista ───────────────────────────────────────────────────

/** Una fila de la lista: el recinto en negrita, las personas debajo. */
export interface ItemJornada {
  tecnico: TecnicoJornada;
  codigoRecinto: string;
  nombreRecinto: string;
  personas: PersonaJornada[];
  /** Hora del registro (en "ya cumplieron") o de lo que dejó el kit pendiente. */
  registro: RegistroJornada | null;
  /** Texto corto al lado del recinto (NO CDA: "CDA 1487"; kit: qué falta). */
  nota?: string;
}

export interface EstadoVista {
  faltan: ItemJornada[];
  cumplidos: ItemJornada[];
}

const porCodigo = (a: ItemJornada, b: ItemJornada) =>
  a.codigoRecinto.localeCompare(b.codigoRecinto, 'es', { numeric: true }) ||
  a.nombreRecinto.localeCompare(b.nombreRecinto, 'es');

/** Faltan y cumplidos de una vista. En "Kit pendiente" no hay cumplidos: solo
 * quien llegó al DPEI sin que se reciba el kit, o al revés. */
export function estadoVista(j: Jornada, vista: VistaJornada): EstadoVista {
  if (vista === 'NO_CDA') {
    const items = j.noCdas.map(
      (n): ItemJornada => ({
        tecnico: n.tecnico,
        codigoRecinto: n.codigoRecinto,
        nombreRecinto: n.nombreRecinto,
        personas: n.personas,
        registro: n.visita,
        nota: `CDA ${n.codigoCda}${n.personas.length === 0 ? ' · su CDA no tiene kit' : ''}`,
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
      const llegada = u.registros.LLEGADA_DPI ?? null;
      if (llegada && !u.kitRecibido) {
        faltan.push({ ...base(u), registro: llegada, nota: 'llegó al DPEI · el kit no se ha recibido' });
      } else if (!llegada && u.kitRecibido) {
        faltan.push({
          ...base(u),
          registro: { en: u.kitRecibido, sinSenal: false },
          nota: 'kit recibido · falta marcar la llegada al DPEI',
        });
      }
    }
    return { faltan: faltan.sort(porCodigo), cumplidos: [] };
  }
  const items = j.unidades.map((u): ItemJornada => ({ ...base(u), registro: u.registros[vista] ?? null }));
  return {
    faltan: items.filter((i) => !i.registro).sort(porCodigo),
    cumplidos: items.filter((i) => i.registro).sort(porCodigo),
  };
}

function base(u: UnidadJornada): Omit<ItemJornada, 'registro'> {
  return { tecnico: u.tecnico, codigoRecinto: u.codigoRecinto, nombreRecinto: u.nombreRecinto, personas: u.personas };
}

function claveTecnico(t: TecnicoJornada): number | 'sin' {
  return t.numero ?? 'sin';
}

/** Técnicos en el orden del distributivo, con "Sin técnico" al final si hace falta. */
export function tecnicosDe(j: Jornada): TecnicoJornada[] {
  const vistos = new Map<number | 'sin', TecnicoJornada>();
  for (const t of [...j.unidades, ...j.noCdas, ...j.sinKit].map((x) => x.tecnico)) {
    if (!vistos.has(claveTecnico(t))) vistos.set(claveTecnico(t), t);
  }
  return [...vistos.values()].sort((a, b) => (a.numero ?? Infinity) - (b.numero ?? Infinity));
}

function delTecnico<T extends { tecnico: TecnicoJornada }>(items: T[], t: TecnicoJornada): T[] {
  return items.filter((i) => claveTecnico(i.tecnico) === claveTecnico(t));
}

// ─── Formato ────────────────────────────────────────────────────────────────

/** Límite de Telegram por mensaje (4096) con margen. */
const MAX_LARGO_MENSAJE = 3800;
const ANCHO_BARRA = 10;
const ANCHO_BARRA_TECNICO = 5;

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

function nombreTecnico(t: TecnicoJornada): string {
  return t.numero === null ? 'Sin técnico' : t.nombre;
}

function lineaPersonas(personas: PersonaJornada[]): string {
  if (personas.length === 0) return '   <i>sin personas asignadas</i>';
  return (
    '   ' +
    personas
      .map((p) => {
        const tel = telefonoTelegram(p.telefono);
        return `${escapeHtml(p.nombre)} (${p.rol})${tel ? ` ${escapeHtml(tel)}` : ''}`;
      })
      .join(' · ')
  );
}

function bloqueItem(i: ItemJornada, conHora: boolean): string {
  const horaTxt = conHora && i.registro ? ` · ${hora(i.registro.en)}${i.registro.sinSenal ? ' 📴' : ''}` : '';
  const nota = i.nota ? ` · <i>${escapeHtml(i.nota)}</i>` : '';
  return `<b>${escapeHtml(i.codigoRecinto)} · ${escapeHtml(i.nombreRecinto)}</b>${horaTxt}${nota}\n${lineaPersonas(i.personas)}`;
}

function encabezado(j: Jornada, vista: VistaJornada, ahora: Date, sufijo = ''): string {
  return `<b>${TITULOS[vista]}${sufijo ? ` · ${escapeHtml(sufijo)}` : ''}</b> · ${hora(ahora)}\n<i>${escapeHtml(j.evento)}</i>`;
}

function avisoDistributivo(j: Jornada): string {
  return j.sinDistributivo ? '\n\n⚠️ No se pudo leer el distributivo de técnicos: todo aparece en "Sin técnico".' : '';
}

function totalVista(e: EstadoVista): number {
  return e.faltan.length + e.cumplidos.length;
}

/** Resumen de una vista: el avance total y una línea por técnico. */
export function formatearResumenJornada(j: Jornada, vista: VistaJornada, ahora: Date): string {
  const estado = estadoVista(j, vista);
  const lineas = [encabezado(j, vista, ahora), ''];

  if (vista === 'KIT') {
    lineas.push(
      estado.faltan.length === 0
        ? '✅ Nadie tiene el kit pendiente.'
        : `<b>${estado.faltan.length}</b> con el kit pendiente`,
    );
    for (const t of tecnicosDe(j)) {
      const n = delTecnico(estado.faltan, t).length;
      if (n > 0) lineas.push(`${escapeHtml(nombreTecnico(t))} · ${n}`);
    }
    return lineas.join('\n') + avisoDistributivo(j);
  }

  const total = totalVista(estado);
  if (total === 0) {
    lineas.push(vista === 'NO_CDA' ? 'No hay recintos NO CDA para este evento.' : 'Todavía no hay kits asignados en este evento.');
    return lineas.join('\n') + avisoDistributivo(j);
  }
  const hechos = estado.cumplidos.length;
  lineas.push(
    `<code>${barra(hechos, total, ANCHO_BARRA)}</code>  <b>${hechos} de ${total}</b>` +
      (estado.faltan.length > 0 ? ` · faltan ${estado.faltan.length}` : ' ✅'),
    '',
  );
  for (const t of tecnicosDe(j)) {
    const f = delTecnico(estado.faltan, t).length;
    const c = delTecnico(estado.cumplidos, t).length;
    if (f + c === 0) continue;
    lineas.push(
      `${escapeHtml(nombreTecnico(t))}  <code>${barra(c, f + c, ANCHO_BARRA_TECNICO)}</code> ${c}/${f + c}` +
        (f > 0 ? `  faltan ${f}` : '  ✅'),
    );
  }
  if (vista !== 'NO_CDA' && j.sinKit.length > 0) {
    lineas.push('', `⚪ ${j.sinKit.length} recinto${j.sinKit.length === 1 ? '' : 's'} CDA sin kit asignado (no cuentan)`);
  }
  return lineas.join('\n') + avisoDistributivo(j);
}

/** Páginas del detalle de un técnico (o de todos los que faltan, con "tod"). */
export function paginasDetalleJornada(
  j: Jornada,
  vista: VistaJornada,
  seleccion: number | 'sin' | 'tod',
  ahora: Date,
): string[] {
  const estado = estadoVista(j, vista);
  const tecnico = seleccion === 'tod' ? null : tecnicosDe(j).find((t) => claveTecnico(t) === seleccion);
  const faltan = tecnico ? delTecnico(estado.faltan, tecnico) : estado.faltan;
  const cumplidos = tecnico ? delTecnico(estado.cumplidos, tecnico) : [];
  const total = faltan.length + cumplidos.length;

  const sufijo = tecnico ? nombreTecnico(tecnico) : 'todos los que faltan';
  const resumen =
    vista === 'KIT' || !tecnico
      ? `Faltan <b>${faltan.length}</b>`
      : `Faltan <b>${faltan.length}</b> de ${total}`;
  const cabeza = `${encabezado(j, vista, ahora, sufijo)}\n${resumen}`;

  const bloques: string[] = [];
  if (faltan.length > 0) {
    bloques.push(`<b>⏳ ${vista === 'KIT' ? 'PENDIENTES' : 'FALTAN'} (${faltan.length})</b>`);
    if (tecnico) {
      bloques.push(...faltan.map((i) => bloqueItem(i, vista === 'KIT')));
    } else {
      // "Todos": agrupados por técnico para saber a quién llamar.
      for (const t of tecnicosDe(j)) {
        const suyos = delTecnico(faltan, t);
        if (suyos.length === 0) continue;
        bloques.push(`<u>${escapeHtml(nombreTecnico(t))} (${suyos.length})</u>`, ...suyos.map((i) => bloqueItem(i, vista === 'KIT')));
      }
    }
  } else {
    bloques.push(vista === 'KIT' ? '✅ Nadie tiene el kit pendiente.' : '✅ No falta nadie.');
  }
  if (cumplidos.length > 0 && vista !== 'KIT') {
    bloques.push(`<b>✅ ${YA_CUMPLIERON[vista]} (${cumplidos.length})</b>`, ...cumplidos.map((i) => bloqueItem(i, true)));
  }
  if (tecnico && vista !== 'NO_CDA' && vista !== 'KIT') {
    const sinKit = delTecnico(j.sinKit, tecnico);
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
  return paginas.map((p, i) =>
    `${cabeza}${paginas.length > 1 ? ` · pág. ${i + 1}/${paginas.length}` : ''}\n\n${p}`,
  );
}

/** Botones de técnicos (con cuántos faltan) bajo el resumen o el detalle. */
export function tecladoJornada(
  j: Jornada,
  vista: VistaJornada,
  seleccion: SeleccionJornada = 'res',
  pagina = 0,
  paginas = 1,
) {
  const estado = estadoVista(j, vista);
  const botones = tecnicosDe(j)
    .map((t) => {
      const f = delTecnico(estado.faltan, t).length;
      const c = vista === 'KIT' ? 0 : delTecnico(estado.cumplidos, t).length;
      if (f + c === 0) return null;
      const clave = claveTecnico(t);
      const texto = `${nombreTecnico(t)} · ${f > 0 ? f : '✅'}`;
      return {
        text: clave === seleccion ? `• ${texto} •` : texto,
        callback_data: callbackJornada({ vista, seleccion: clave, pagina: 0 }),
      };
    })
    .filter((b): b is { text: string; callback_data: string } => b !== null);

  const filas: { text: string; callback_data: string }[][] = [];
  for (let i = 0; i < botones.length; i += 3) filas.push(botones.slice(i, i + 3));

  const navegacion: { text: string; callback_data: string }[] = [];
  if (seleccion !== 'res') navegacion.push({ text: '◀ Resumen', callback_data: callbackJornada({ vista, seleccion: 'res', pagina: 0 }) });
  if (pagina > 0) navegacion.push({ text: '◀ Pág.', callback_data: callbackJornada({ vista, seleccion, pagina: pagina - 1 }) });
  if (pagina < paginas - 1) navegacion.push({ text: 'Pág. ▶', callback_data: callbackJornada({ vista, seleccion, pagina: pagina + 1 }) });
  navegacion.push({ text: '↻ Actualizar', callback_data: callbackJornada({ vista, seleccion, pagina }) });
  filas.push(navegacion);

  if (seleccion === 'res' && estado.faltan.length > 0) {
    filas.push([{ text: 'Ver todos los que faltan', callback_data: callbackJornada({ vista, seleccion: 'tod', pagina: 0 }) }]);
  }
  return { inline_keyboard: filas };
}
