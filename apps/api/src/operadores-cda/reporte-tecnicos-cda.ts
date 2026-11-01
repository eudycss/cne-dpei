import type { ParejaCdaFila, PersonaParejaCda, TecnicoParejasCda } from '@cne/shared-types';

import type { AsignacionTecnico } from '../enlaces/distributivo-tecnicos.client';
import { type Celda, type ReporteCda, type TablaReporte, diaLargo } from './reporte-cda';

/**
 * "Reporte por técnico" de Parejas: las parejas del día agrupadas por el técnico
 * del distributivo (Drive) que responde por cada recinto, con quién ingresa a
 * la app (quien tiene el kit de verdad) y cuántas parejas van al recinto.
 * También los contactos .vcf de cada técnico. Funciones puras: el servicio
 * pone las parejas y el distributivo.
 */

/** Quién tiene el kit de la pareja en el sistema: uno de los dos, otra persona o nadie. */
export type QuienIngresa = 'OPERADOR' | 'ASISTENTE' | 'OTRA' | null;

export interface FilaTecnico {
  pareja: ParejaCdaFila;
  ingresa: QuienIngresa;
}

export interface GrupoTecnico {
  /** Como está en el distributivo; null = "Sin técnico". */
  nombre: string | null;
  filas: FilaTecnico[];
  /** Parroquia de cada recinto (código) según el distributivo. */
  parroquias: Map<string, string>;
}

const COLUMNAS = [
  { titulo: 'N°', ancho: 5 },
  { titulo: 'Código', ancho: 8 },
  { titulo: 'Recinto', ancho: 30 },
  { titulo: 'Parroquia', ancho: 16 },
  { titulo: 'Parejas en el recinto', ancho: 10 },
  { titulo: 'Kit', ancho: 11 },
  { titulo: 'Ingresa a la app', ancho: 30 },
  { titulo: 'Celular', ancho: 13 },
  { titulo: 'Su pareja / integrantes', ancho: 40 },
  { titulo: 'Observación', ancho: 22 },
];

const MAX_NOMBRE_HOJA = 31;

/** Mismo técnico aunque cambien tildes, mayúsculas o espacios. */
export const claveTecnico = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

const porCodigo = (a: FilaTecnico, b: FilaTecnico) =>
  a.pareja.recinto.codigo.localeCompare(b.pareja.recinto.codigo, 'es', { numeric: true }) ||
  // En cada recinto, primero la pareja que lleva el kit.
  Number(!a.pareja.portador) - Number(!b.pareja.portador) ||
  a.pareja.operador.apellidosNombres.localeCompare(b.pareja.operador.apellidosNombres, 'es');

/**
 * Un grupo por técnico del distributivo (en el orden del archivo, aunque no
 * tenga parejas ese día) y, si hay recintos con parejas que no están en él,
 * uno "Sin técnico" al final. Un recinto con dos técnicos va en ambos.
 */
export function agruparPorTecnico(filas: FilaTecnico[], asignaciones: AsignacionTecnico[]): GrupoTecnico[] {
  const grupos = new Map<string, GrupoTecnico>();
  const tecnicosDe = new Map<string, Set<string>>();
  const parroquias = new Map<string, string>();
  for (const a of [...asignaciones].sort((x, y) => x.numeroTecnico - y.numeroTecnico)) {
    const k = claveTecnico(a.tecnico);
    if (!grupos.has(k)) grupos.set(k, { nombre: a.tecnico.replace(/\s+/g, ' ').trim(), filas: [], parroquias });
    tecnicosDe.set(a.codigoRecinto, (tecnicosDe.get(a.codigoRecinto) ?? new Set<string>()).add(k));
    if (a.parroquia && !parroquias.has(a.codigoRecinto)) parroquias.set(a.codigoRecinto, a.parroquia);
  }
  const sinTecnico: GrupoTecnico = { nombre: null, filas: [], parroquias };
  for (const f of filas) {
    const ks = tecnicosDe.get(f.pareja.recinto.codigo);
    if (!ks) sinTecnico.filas.push(f);
    else for (const k of ks) grupos.get(k)!.filas.push(f);
  }
  const todos = [...grupos.values(), ...(sinTecnico.filas.length > 0 ? [sinTecnico] : [])];
  for (const g of todos) g.filas.sort(porCodigo);
  return todos;
}

const recintosDe = (g: GrupoTecnico) => new Set(g.filas.map((f) => f.pareja.recinto.codigo)).size;
const ingresa = (f: FilaTecnico) => f.ingresa === 'OPERADOR' || f.ingresa === 'ASISTENTE';

export function resumenTecnicos(grupos: GrupoTecnico[]): TecnicoParejasCda[] {
  return grupos.map((g) => ({ nombre: g.nombre, recintos: recintosDe(g), parejas: g.filas.length }));
}

/** "0991234567" → "0991 234 567" (lo demás, tal cual). */
function celular(t: string | null): string {
  if (!t) return 'sin celular';
  const d = t.replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : t.trim();
}

const cargo = (p: PersonaParejaCda) => (p.grupo === 'ASISTENTE' ? 'Asistente' : 'Operador');

/** pdfkit borra la barra invertida de nombres como "Bloque 1 \ Ex Escuela"; "/" se lee igual. */
const nombreRecinto = (nombre: string) => nombre.replace(/\\/g, '/');

function integrantes(p: ParejaCdaFila): string {
  return [p.operador, p.asistente]
    .filter((x): x is PersonaParejaCda => !!x)
    .map((x) => `${cargo(x)}: ${x.apellidosNombres} · ${celular(x.telefono)}`)
    .join('\n');
}

/** Columnas "Ingresa a la app", "Celular", "Su pareja / integrantes" y "Observación"; y si hay que revisarla. */
function quienIngresa(f: FilaTecnico, parejasEnRecinto: number, hayEvento: boolean): { celdas: Celda[]; revisar: boolean } {
  const p = f.pareja;
  if (!p.portador) {
    return { celdas: ['NO INGRESA', '', integrantes(p), '2.ª pareja: va con la pareja que tiene el kit'], revisar: false };
  }
  if (f.ingresa === 'OPERADOR' || f.ingresa === 'ASISTENTE') {
    const [lleva, otro] = f.ingresa === 'OPERADOR' ? [p.operador, p.asistente] : [p.asistente!, p.operador];
    return {
      celdas: [
        `${lleva.apellidosNombres} (${cargo(lleva)})`,
        celular(lleva.telefono),
        otro ? `${otro.apellidosNombres} (${cargo(otro)}) · ${celular(otro.telefono)}` : 'Sin pareja',
        parejasEnRecinto > 1 ? '1.ª pareja: lleva el kit' : '',
      ],
      revisar: false,
    };
  }
  if (f.ingresa === 'OTRA') {
    return { celdas: ['OTRA PERSONA tiene el kit (revisar en Kits)', '', integrantes(p), 'Revisar antes de la jornada'], revisar: true };
  }
  if (!hayEvento) return { celdas: ['Pendiente: sin evento activo de este día', '', integrantes(p), ''], revisar: false };
  return { celdas: ['NADIE: pulse "Asignar kit"', '', integrantes(p), 'Revisar antes de la jornada'], revisar: true };
}

function tabla(g: GrupoTecnico, hayEvento: boolean, hoja: string): TablaReporte {
  const nombre = g.nombre ?? 'Sin técnico';
  const titulo = `${nombre} · ${recintosDe(g)} recintos · ${g.filas.length} parejas · ${g.filas.filter(ingresa).length} ingresan a la app`;
  if (g.filas.length === 0) {
    return { hoja, titulo, columnas: COLUMNAS, filas: [['', '', 'Este técnico no tiene parejas este día', '', '', '', '', '', '', '']] };
  }
  const enRecinto = new Map<string, number>();
  for (const f of g.filas) enRecinto.set(f.pareja.recinto.codigo, (enRecinto.get(f.pareja.recinto.codigo) ?? 0) + 1);
  const resaltadas: number[] = [];
  const filas = g.filas.map((f, i) => {
    const p = f.pareja;
    const n = enRecinto.get(p.recinto.codigo)!;
    const { celdas, revisar } = quienIngresa(f, n, hayEvento);
    if (revisar) resaltadas.push(i);
    return [
      i + 1,
      p.recinto.codigo,
      nombreRecinto(p.recinto.nombre),
      g.parroquias.get(p.recinto.codigo) ?? '',
      n === 1 ? '1 pareja' : `${n} parejas`,
      p.kitCodigo ?? 'Sin kit',
      ...celdas,
    ];
  });
  return { hoja, titulo, columnas: COLUMNAS, filas, resaltadas };
}

/** Nombre de hoja válido en Excel (sin : \ / ? * [ ]), de 31 caracteres y sin repetir. */
function nombresDeHoja(grupos: GrupoTecnico[]): string[] {
  const usados = new Set<string>();
  return grupos.map((g) => {
    const base = (g.nombre ?? 'Sin técnico').replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, MAX_NOMBRE_HOJA) || 'Técnico';
    let hoja = base;
    for (let i = 2; usados.has(claveTecnico(hoja)); i++) hoja = `${base.slice(0, MAX_NOMBRE_HOJA - String(i).length - 1)} ${i}`;
    usados.add(claveTecnico(hoja));
    return hoja;
  });
}

export function reporteTecnicos(dia: { fecha: string; evento: { id: string; nombre: string } | null }, grupos: GrupoTecnico[]): ReporteCda {
  const evento = dia.evento ? `Evento: ${dia.evento.nombre}` : 'Evento: sin evento activo de esa fecha';
  const hojas = nombresDeHoja(grupos);
  return {
    titulo: 'Parejas CDA por técnico: quién ingresa a la app',
    detalle: `${diaLargo(dia.fecha)} · ${evento} · Ingresa a la app quien lleva el kit (clave inicial: su cédula); en recintos con 2 parejas solo la 1.ª`,
    archivo: 'parejas_por_tecnico',
    desde: dia.fecha,
    hasta: dia.fecha,
    modo: 'GENERAL',
    tablas: grupos.map((g, i) => tabla(g, !!dia.evento, hojas[i])),
  };
}

// ---- Contactos .vcf ----

/** Partículas de apellidos compuestos ("DE LA CRUZ", "DEL HIERRO"). */
const PARTICULAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'SAN', 'SANTA', 'DA', 'DI', 'VAN', 'VON', 'MC', 'Y']);
const TITULOS = /^(ING|LIC|TLGO|TNLGO|DR|DRA|MSC|MGS|MG|ABG|SR|SRA|ARQ|ECON)\.?$/i;

const tipoTitulo = (s: string) =>
  s.toLocaleLowerCase('es').replace(/(^|\s)(\S)/g, (_m, esp: string, c: string) => esp + c.toLocaleUpperCase('es'));

/** Toma un apellido de `palabras` (con sus partículas) y devuelve cuántas consumió. */
function apellido(palabras: string[], desde: number): number {
  let i = desde;
  while (i < palabras.length - 1 && PARTICULAS.has(claveTecnico(palabras[i]))) i++;
  return i - desde + 1;
}

/**
 * Primer nombre y primer apellido de "APELLIDOS NOMBRES" (convención de
 * Operadores CDA), respetando apellidos compuestos y sin correos pegados.
 */
export function nombreContacto(apellidosNombres: string): { nombre: string; apellido: string } {
  const limpio = apellidosNombres.replace(/\s*-?\s*\S+@\S+/g, ' ').replace(/\s+-\s*$/, '');
  const palabras = limpio.split(/\s+/).filter((w) => w && w !== '-');
  const n1 = apellido(palabras, 0);
  const primerApellido = palabras.slice(0, n1).join(' ');
  if (n1 >= palabras.length) return { nombre: tipoTitulo(primerApellido), apellido: '' };
  const n2 = palabras.length - n1 >= 2 ? apellido(palabras, n1) : 0;
  const nombre = palabras[n1 + n2] ?? palabras[n1];
  return { nombre: tipoTitulo(nombre), apellido: tipoTitulo(primerApellido) };
}

/** "Ing. Sebastian Cabascango" → "Sebastian"; sin técnico → "SinTecnico". */
export function etiquetaTecnico(nombre: string | null): string {
  if (!nombre) return 'SinTecnico';
  const palabra = nombre.split(/\s+/).find((w) => w && !TITULOS.test(w));
  return palabra ? tipoTitulo(palabra) : 'Tecnico';
}

/** Celular ecuatoriano con +593; null si no parece un celular. */
export function telefonoInternacional(t: string | null): string | null {
  if (!t) return null;
  const d = t.replace(/\D/g, '');
  if (d.length === 10 && d.startsWith('0')) return `+593${d.slice(1)}`;
  if (d.length === 12 && d.startsWith('593')) return `+${d}`;
  return null;
}

/** RFC 6350: en un valor de texto se escapan \ , ; y los saltos de línea. */
const escapar = (s: string) => s.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\r\n|\r|\n/g, '\\n');

/** Un contacto por persona con celular: "codigo.Nombre.Apellido.Técnico". */
export function contactosVcf(grupos: GrupoTecnico[]): string {
  const tarjetas: string[] = [];
  for (const g of grupos) {
    const tecnico = etiquetaTecnico(g.nombre);
    const vistos = new Set<string>();
    for (const { pareja } of g.filas) {
      for (const x of [pareja.operador, pareja.asistente]) {
        const tel = x && telefonoInternacional(x.telefono);
        if (!x || !tel || vistos.has(`${pareja.recinto.codigo}|${x.id}`)) continue;
        vistos.add(`${pareja.recinto.codigo}|${x.id}`);
        const { nombre, apellido: ape } = nombreContacto(x.apellidosNombres);
        const fn = escapar([pareja.recinto.codigo, nombre, ape, tecnico].filter(Boolean).join('.'));
        tarjetas.push(`BEGIN:VCARD\r\nVERSION:3.0\r\nN:${fn};;;;\r\nFN:${fn}\r\nTEL;TYPE=CELL:${tel}\r\nEND:VCARD\r\n`);
      }
    }
  }
  return tarjetas.join('');
}
