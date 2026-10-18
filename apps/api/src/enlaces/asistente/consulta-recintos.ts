import { escapeHtml } from '../../auth/notifier';
import type { EncargadoRecinto } from '../encargados-recintos.client';
import { abreviarCanton, recortarNombre } from '../telegram-notifier';
import { contienePalabras, normalizarTexto, palabrasClave } from './buscar-recintos';
import type { Agrupacion, FiltrosRecintos } from './herramientas';

/** Un recinto monitoreado con todo lo que se sabe de él (base + distributivo + encargados). */
export interface FilaRecinto {
  codigoRecinto: string;
  nombreRecinto: string;
  canton: string | null;
  /** '' si el distributivo no la trae. */
  parroquia: string;
  estado: 'ACTIVO' | 'FALLO';
  tecnico: string | null;
  numeroTecnico: number | null;
  encargado: EncargadoRecinto | null;
}

/** Qué fuentes se pudieron leer: sin ellas, "sin técnico" o "sin contacto" serían falsos. */
export interface FuentesDisponibles {
  distributivo: boolean;
  encargados: boolean;
}

/** Telegram corta en 4096 caracteres; se deja margen. */
const MAX_LARGO_MENSAJE = 3800;
/** Más recintos que esto ya no se leen en un chat: se pide otro filtro. */
const MAX_FILAS = 200;
/** Con teléfonos se muestran menos, para no volcar los contactos de toda la provincia. */
const MAX_FILAS_CON_CONTACTO = 40;
/** Mensajes por consulta: más sería spam en el grupo (y Telegram limita ~20 por minuto). */
export const MAX_MENSAJES_CONSULTA = 4;
const AVISO_CORTADO = '… y hay más. Agregue un filtro (cantón, técnico o estado) para ver el resto.';

/** Nombre y teléfono del encargado, escapados; `encargados` null = el Excel no se pudo leer. */
export function textoEncargado(codigo: string, encargados: Map<string, EncargadoRecinto> | null): string {
  if (!encargados) return 'no se pudo consultar ahora';
  return textoDeEncargado(encargados.get(codigo) ?? null);
}

function textoDeEncargado(encargado: EncargadoRecinto | null): string {
  if (!encargado) return 'sin registrar';
  return [encargado.nombre, encargado.telefono].filter(Boolean).map(escapeHtml).join(' · ') || 'sin registrar';
}

/** Sin teléfono no hay a quién llamar, aunque haya nombre. */
function sinContacto(f: FilaRecinto): boolean {
  return !f.encargado?.telefono?.trim();
}

const plural = (n: number, singular: string, varios = `${singular}s`) => `${n} ${n === 1 ? singular : varios}`;

/**
 * Cada texto pedido, emparejado con los valores que existen: primero tal cual y,
 * si no hay nada, tolerando un error de tipeo. Lo que no se encuentra va en `faltan`.
 */
function emparejar(pedidos: string[], existentes: string[]) {
  const elegidos = new Set<string>();
  const faltan: string[] = [];
  /** Un texto que calza con varios valores ("Juan" → Juan Pérez y Juan Andrade). */
  const ambiguos: string[] = [];
  let aproximado = false;
  for (const pedido of pedidos) {
    const palabras = palabrasClave(pedido);
    let encontrados = existentes.filter((e) => contienePalabras(palabras, e));
    if (encontrados.length === 0) {
      encontrados = existentes.filter((e) => contienePalabras(palabras, e, true));
      if (encontrados.length > 0) aproximado = true;
    }
    if (encontrados.length === 0) faltan.push(pedido);
    if (encontrados.length > 1) ambiguos.push(pedido);
    encontrados.forEach((e) => elegidos.add(e));
  }
  return { elegidos, faltan, ambiguos, aproximado };
}

/** Cantón exacto, o el único que contiene lo escrito ("cota" → Cotacachi; "a" no elige ninguno). */
function emparejarCantones(pedidos: string[], existentes: string[]) {
  const elegidos = new Set<string>();
  const faltan: string[] = [];
  for (const pedido of pedidos) {
    const clave = normalizarTexto(pedido);
    const exacto = existentes.find((c) => normalizarTexto(c) === clave);
    // Por parte del nombre solo desde 3 letras ("ra" no debe elegir Ibarra).
    const parecidos = clave.length >= 3 ? existentes.filter((c) => normalizarTexto(c).includes(clave)) : [];
    const elegido = clave ? (exacto ?? (parecidos.length === 1 ? parecidos[0] : undefined)) : undefined;
    if (elegido) elegidos.add(elegido);
    else faltan.push(pedido);
  }
  return { elegidos, faltan };
}

const unicos = (valores: (string | null)[]) =>
  [...new Set(valores.filter((v): v is string => !!v?.trim()))].sort((a, b) => a.localeCompare(b));

/**
 * Aplica los filtros que eligió el modelo y arma la respuesta (HTML escapado,
 * partida en mensajes que caben en Telegram). Función pura: no consulta nada.
 */
export function responderConsulta(filtros: FiltrosRecintos, filas: FilaRecinto[], fuentes: FuentesDisponibles): string[] {
  const avisos: string[] = [];
  let seleccion = filas;
  const descripcion: string[] = [];

  // --- Requisitos de las fuentes: sin el dato, no se responde algo falso.
  if ((filtros.tecnicos.length > 0 || filtros.sinTecnico) && !fuentes.distributivo) {
    return ['⚠️ El distributivo de técnicos no está disponible ahora; no puedo filtrar por técnico.'];
  }
  if ((filtros.parroquias.length > 0 || filtros.agruparPor === 'parroquia') && !fuentes.distributivo) {
    return ['⚠️ El distributivo de técnicos (de donde salen las parroquias) no está disponible ahora.'];
  }
  if (filtros.sinContacto && !fuentes.encargados) {
    return ['⚠️ El archivo de encargados no está disponible ahora; no puedo saber qué recintos no tienen contacto.'];
  }
  // Teléfonos de toda la provincia en una sola respuesta no: se pide acotar.
  const acotada = filtros.cantones.length + filtros.parroquias.length + filtros.tecnicos.length > 0 || filtros.estado !== null;
  if (filtros.conContacto && !filtros.soloContar && !acotada) {
    return ['📞 Para mostrar contactos indique un cantón, parroquia, técnico o "los caídos". Por ejemplo: "contactos de Otavalo".'];
  }

  if (filtros.cantones.length > 0) {
    const existentes = unicos(filas.map((f) => f.canton));
    const { elegidos, faltan } = emparejarCantones(filtros.cantones, existentes);
    if (faltan.length > 0) {
      avisos.push(
        `No reconozco ${faltan.length === 1 ? 'el cantón' : 'los cantones'} ${faltan.map((c) => `"${escapeHtml(c)}"`).join(', ')}. ` +
          `Cantones con recintos: ${existentes.map(escapeHtml).join(', ')}.`,
      );
    }
    if (elegidos.size === 0) return [avisos.join('\n')];
    seleccion = seleccion.filter((f) => f.canton !== null && elegidos.has(f.canton));
    descripcion.push([...elegidos].join(', '));
  }

  if (filtros.parroquias.length > 0) {
    const { elegidos, faltan, aproximado } = emparejar(filtros.parroquias, unicos(filas.map((f) => f.parroquia)));
    if (faltan.length > 0) avisos.push(`No encontré la parroquia ${faltan.map((p) => `"${escapeHtml(p)}"`).join(', ')}.`);
    if (elegidos.size === 0) return [avisos.join('\n')];
    if (aproximado) avisos.push('🔎 Alguna parroquia no estaba escrita tal cual; muestro la más parecida.');
    seleccion = seleccion.filter((f) => elegidos.has(f.parroquia));
    descripcion.push(`parroquia ${[...elegidos].join(', ')}`);
  }

  if (filtros.tecnicos.length > 0) {
    const { elegidos, faltan, ambiguos, aproximado } = emparejar(filtros.tecnicos, unicos(filas.map((f) => f.tecnico)));
    if (faltan.length > 0) avisos.push(`No encontré al técnico ${faltan.map((t) => `"${escapeHtml(t)}"`).join(', ')} en el distributivo.`);
    if (elegidos.size === 0) return [avisos.join('\n')];
    if (aproximado) avisos.push('🔎 Algún técnico no estaba escrito tal cual; muestro el más parecido.');
    if (ambiguos.length > 0) {
      avisos.push(`ℹ️ Varios técnicos coinciden con ${ambiguos.map((t) => `"${escapeHtml(t)}"`).join(', ')}; muestro todos. Use el nombre completo para uno solo.`);
    }
    seleccion = seleccion.filter((f) => f.tecnico !== null && elegidos.has(f.tecnico));
    descripcion.push([...elegidos].join(', '));
  }

  if (filtros.estado) {
    seleccion = seleccion.filter((f) => f.estado === (filtros.estado === 'caido' ? 'FALLO' : 'ACTIVO'));
    descripcion.push(filtros.estado === 'caido' ? 'caídos' : 'activos');
  }
  if (filtros.sinTecnico) {
    seleccion = seleccion.filter((f) => f.tecnico === null);
    descripcion.push('sin técnico');
  }
  if (filtros.sinContacto) {
    seleccion = seleccion.filter(sinContacto);
    descripcion.push('sin contacto');
  }

  let agrupacion = elegirAgrupacion(filtros);
  if (agrupacion === 'tecnico' && !fuentes.distributivo) {
    agrupacion = 'canton';
    avisos.push('⚠️ El distributivo de técnicos no está disponible ahora; agrupo por cantón.');
  }
  if (filtros.conContacto && !fuentes.encargados) {
    avisos.push('⚠️ El archivo de encargados no está disponible ahora; los contactos no se pudieron consultar.');
  }

  const caidos = seleccion.filter((f) => f.estado === 'FALLO').length;
  const titulo =
    `🏫 <b>Recintos${descripcion.length > 0 ? ` · ${escapeHtml(descripcion.join(' · '))}` : ''}</b>: ${seleccion.length}` +
    (!filtros.estado && caidos > 0 ? ` (${plural(caidos, 'caído')})` : '');
  const cabecera = [...avisos, titulo];

  if (seleccion.length === 0) return partir([...cabecera, '✅ Ninguno cumple esa condición.']);

  const grupos = agrupar(seleccion, agrupacion);
  if (filtros.soloContar) {
    const conteos = [...grupos]
      .sort((a, b) => b.filas.length - a.filas.length || a.etiqueta.localeCompare(b.etiqueta))
      .map((g) => {
        const c = g.filas.filter((f) => f.estado === 'FALLO').length;
        return `• ${escapeHtml(g.etiqueta)}: ${plural(g.filas.length, 'recinto')}${!filtros.estado && c > 0 ? ` (${plural(c, 'caído')})` : ''}`;
      });
    return partir(agrupacion === 'ninguno' ? cabecera : [...cabecera, ...conteos]);
  }

  const conContacto = filtros.conContacto && fuentes.encargados;
  const maxFilas = conContacto ? MAX_FILAS_CON_CONTACTO : MAX_FILAS;
  const lineas: string[] = [];
  let mostradas = 0;
  for (const g of grupos) {
    if (mostradas >= maxFilas) break;
    if (agrupacion !== 'ninguno') {
      const c = g.filas.filter((f) => f.estado === 'FALLO').length;
      lineas.push('', `<b>${escapeHtml(g.etiqueta)}</b> (${g.filas.length}${c > 0 ? ` · ${plural(c, 'caído')}` : ''})`);
    }
    for (const f of g.filas) {
      if (mostradas >= maxFilas) break;
      lineas.push(lineaRecinto(f, conContacto));
      mostradas += 1;
    }
  }
  if (seleccion.length > mostradas) {
    lineas.push('', `… y ${seleccion.length - mostradas} más. Agregue un filtro (cantón, técnico o estado).`);
  }
  return partir([...cabecera, ...lineas]);
}

function elegirAgrupacion(filtros: FiltrosRecintos): Agrupacion {
  if (filtros.agruparPor) return filtros.agruparPor;
  if (filtros.soloContar) return 'ninguno';
  if (filtros.sinContacto || filtros.conContacto || filtros.sinTecnico || filtros.cantones.length > 1) return 'canton';
  return 'tecnico';
}

interface Grupo {
  etiqueta: string;
  orden: number;
  filas: FilaRecinto[];
}

function agrupar(filas: FilaRecinto[], agrupacion: Agrupacion): Grupo[] {
  const grupos = new Map<string, Grupo>();
  for (const f of filas) {
    const [clave, etiqueta, orden] =
      agrupacion === 'tecnico'
        ? f.numeroTecnico === null
          ? ['-', 'Sin técnico asignado', Infinity]
          : [String(f.numeroTecnico), `👷 ${f.numeroTecnico}. ${f.tecnico}`, f.numeroTecnico]
        : agrupacion === 'canton'
          ? [f.canton ?? '', `📍 ${f.canton ?? 'Sin cantón'}`, 0]
          : agrupacion === 'parroquia'
            ? [f.parroquia, `📍 ${f.parroquia || 'Sin parroquia'}`, 0]
            : ['', 'Todos', 0];
    const grupo = grupos.get(clave) ?? { etiqueta, orden, filas: [] };
    grupo.filas.push(f);
    grupos.set(clave, grupo);
  }
  return [...grupos.values()].sort((a, b) => a.orden - b.orden || a.etiqueta.localeCompare(b.etiqueta));
}

function lineaRecinto(f: FilaRecinto, conContacto: boolean): string {
  const abreviatura = abreviarCanton(f.canton);
  const linea =
    `${f.estado === 'FALLO' ? '🔴' : '✅'} ${escapeHtml(f.codigoRecinto)}` +
    `${abreviatura ? ` (${escapeHtml(abreviatura)})` : ''} — ${escapeHtml(recortarNombre(f.nombreRecinto))}`;
  return conContacto ? `${linea}\n     📞 ${textoDeEncargado(f.encargado)}` : linea;
}

/**
 * Junta las líneas en mensajes que caben en Telegram, sin partir una línea, y
 * corta en MAX_MENSAJES_CONSULTA con un aviso para que no se vuelva spam.
 */
export function partir(lineas: string[]): string[] {
  const mensajes: string[] = [];
  let actual = '';
  for (const original of lineas) {
    // Una sola línea enorme (datos raros en el Excel) también tiene que caber.
    const linea = original.length > MAX_LARGO_MENSAJE ? `${original.slice(0, MAX_LARGO_MENSAJE - 1)}…` : original;
    const unido = actual ? `${actual}\n${linea}` : linea;
    if (unido.length > MAX_LARGO_MENSAJE && actual) {
      mensajes.push(actual.trim());
      actual = linea;
    } else {
      actual = unido;
    }
  }
  if (actual.trim()) mensajes.push(actual.trim());
  if (mensajes.length <= MAX_MENSAJES_CONSULTA) return mensajes;
  const recortados = mensajes.slice(0, MAX_MENSAJES_CONSULTA);
  const ultimo = recortados[MAX_MENSAJES_CONSULTA - 1];
  recortados[MAX_MENSAJES_CONSULTA - 1] =
    ultimo.length + AVISO_CORTADO.length + 2 <= MAX_LARGO_MENSAJE ? `${ultimo}\n\n${AVISO_CORTADO}` : AVISO_CORTADO;
  return recortados;
}
