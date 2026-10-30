import { BadRequestException } from '@nestjs/common';
import { grupoCdaQuerySchema } from '@cne/shared-validation';
import type { CentroCda, GrupoCda } from '@cne/shared-types';

export interface TextosCargo {
  titulo: string;
  contador: string;
  cargo: string;
  archivo: string;
  singular: string;
}

/**
 * Textos de los 9 cargos originales (reportes, actas, carnets y mensajes).
 * Solo operadores y asistentes son CDA; el resto dice CPE. Los cargos que
 * agrega el administrador arman los suyos con el nombre (textosGrupo).
 */
export const TEXTOS_GRUPO: Record<string, TextosCargo> = {
  OPERADOR: {
    titulo: 'Operadores CDA',
    contador: 'Operadores',
    cargo: 'OPERADOR CDA',
    archivo: 'operadores_cda',
    singular: 'operador',
  },
  ASISTENTE: {
    titulo: 'Asistentes CDA',
    contador: 'Asistentes',
    cargo: 'ASISTENTE CDA',
    archivo: 'asistentes_cda',
    singular: 'asistente',
  },
  DIGITADOR: {
    titulo: 'Digitadores',
    contador: 'Digitadores',
    cargo: 'DIGITADOR CPE',
    archivo: 'digitadores_cpe',
    singular: 'digitador',
  },
  ASISTENTE_ARCHIVOS: {
    titulo: 'Asistentes de Archivos',
    contador: 'Asistentes de Archivos',
    cargo: 'ASISTENTE DE ARCHIVOS CPE',
    archivo: 'asistentes_archivos_cpe',
    singular: 'asistente de archivos',
  },
  ASISTENTE_FIRMAS: {
    titulo: 'Asistentes de firmas',
    contador: 'Asistentes de firmas',
    cargo: 'ASISTENTE DE FIRMAS CPE',
    archivo: 'asistentes_firmas_cpe',
    singular: 'asistente de firmas',
  },
  RECEPTOR_ACTAS: {
    titulo: 'Receptores de actas',
    contador: 'Receptores',
    cargo: 'RECEPTOR DE ACTAS CPE',
    archivo: 'receptores_actas_cpe',
    singular: 'receptor de actas',
  },
  ARCHIVADOR_ACTAS: {
    titulo: 'Archivadores de actas',
    contador: 'Archivadores',
    cargo: 'ARCHIVADOR DE ACTAS CPE',
    archivo: 'archivadores_actas_cpe',
    singular: 'archivador de actas',
  },
  SUPERVISOR: {
    titulo: 'Supervisores',
    contador: 'Supervisores',
    cargo: 'SUPERVISOR CPE',
    archivo: 'supervisores_cpe',
    singular: 'supervisor',
  },
  OPERADOR_ESCANER_CPE: {
    titulo: 'Operadores de escáner CPE',
    contador: 'Operadores de escáner',
    cargo: 'OPERADOR DE ESCÁNER CPE',
    archivo: 'operadores_escaner_cpe',
    singular: 'operador de escáner CPE',
  },
};

/** Lo que la API necesita saber de cada cargo de la tabla cargos_cda. */
export interface CargoRegistrado {
  clave: GrupoCda;
  nombre: string;
  centro: CentroCda;
  activo: boolean;
}

/**
 * Copia en memoria de la tabla cargos_cda (la refresca CargosCdaService al
 * arrancar, al listar y tras cada cambio). Así los textos se leen sin ir a la
 * base en cada reporte. Arranca con los 9 originales.
 */
const registro = new Map<string, CargoRegistrado>(
  Object.entries(TEXTOS_GRUPO).map(([clave, t]) => [
    clave,
    { clave, nombre: t.titulo, centro: t.cargo.endsWith(' CDA') ? 'CDA' : 'CPE', activo: true },
  ]),
);

/** Reemplaza el registro. Una lectura vacía se ignora: la tabla nunca queda vacía. */
export function registrarCargos(cargos: readonly CargoRegistrado[]): void {
  if (cargos.length === 0) return;
  registro.clear();
  for (const c of cargos) registro.set(c.clave, { ...c });
}

/** Pone al día un solo cargo (el que se acaba de guardar). */
export function registrarCargo(cargo: CargoRegistrado): void {
  registro.set(cargo.clave, { ...cargo });
}

/** Se puede agregar o mover personal a este cargo (existe y no está desactivado). */
export function cargoActivo(clave: GrupoCda): boolean {
  return registro.get(clave)?.activo === true;
}

/** 400 si el cargo está desactivado: no se le agrega ni se le pasa personal. */
export function asegurarCargoActivo(clave: GrupoCda): void {
  if (!cargoActivo(clave)) {
    throw new BadRequestException(`El cargo ${textosGrupo(clave).titulo} está desactivado: reactívelo en Gestionar cargos`);
  }
}

/** "Técnicos de sala" -> "tecnicos_de_sala" / "TECNICOS_DE_SALA". */
function sinTildes(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function slug(texto: string): string {
  return sinTildes(texto)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Textos del cargo. Los originales conservan los de siempre (las actas y los
 * carnets ya impresos los usan); si se renombran cambia solo el título.
 */
export function textosGrupo(clave: GrupoCda): TextosCargo {
  const c = registro.get(clave);
  const base = TEXTOS_GRUPO[clave];
  if (base) return c ? { ...base, titulo: c.nombre } : base;
  const nombre = c?.nombre ?? clave;
  const centro = c?.centro ?? 'CPE';
  return {
    titulo: nombre,
    contador: nombre,
    cargo: `${nombre.toUpperCase()} ${centro}`,
    archivo: `${slug(nombre) || 'cargo'}_${centro.toLowerCase()}`,
    singular: 'persona',
  };
}

/** Clave de un cargo nuevo a partir de su nombre, sin repetir las que existen. */
export function claveParaNombre(nombre: string, existentes: ReadonlySet<string>): string {
  let base = slug(nombre).toUpperCase() || 'CARGO';
  if (!/^[A-Z]/.test(base)) base = `C_${base}`;
  base = base.slice(0, 36).replace(/_+$/, '');
  if (!existentes.has(base)) return base;
  for (let n = 2; ; n++) {
    const clave = `${base}_${n}`;
    if (!existentes.has(clave)) return clave;
  }
}

/** ?grupo= de la URL: ausente = OPERADOR; un cargo que no existe, 400. */
export function parsearGrupo(v: unknown): GrupoCda {
  const r = grupoCdaQuerySchema.safeParse(v);
  if (!r.success) throw new BadRequestException(r.error.issues[0]?.message ?? 'Grupo inválido');
  if (!registro.has(r.data)) throw new BadRequestException('Grupo inválido');
  return r.data;
}
