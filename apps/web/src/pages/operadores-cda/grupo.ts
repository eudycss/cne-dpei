import { createContext, useContext } from 'react';
import type { CargoCda, GrupoCda } from '@cne/shared-types';

export type TextosGrupo = {
  /** Solo operadores y asistentes son CDA; el resto es CPE. */
  centro: 'CDA' | 'CPE';
  titulo: string;
  plural: string;
  singular: string;
  Singular: string;
  cargoPorDefecto: string;
  /** Valor de ?grupo= en la URL (operadores = el de por defecto, no se escribe). */
  ruta: string;
};

/**
 * Textos de los 9 cargos originales (los demás los agrega el administrador
 * y arman los suyos con el nombre: textosDeCargo). En el listado el cargo se
 * ve abreviado (Asist. Adm. Electoral Provincial) para todos.
 */
export const TEXTOS_GRUPO: Record<string, TextosGrupo> = {
  OPERADOR: {
    centro: 'CDA',
    titulo: 'Operadores CDA',
    plural: 'operadores',
    singular: 'operador',
    Singular: 'Operador',
    cargoPorDefecto: 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - OPERADORES CDA',
    ruta: 'operadores',
  },
  ASISTENTE: {
    centro: 'CDA',
    titulo: 'Asistentes CDA',
    plural: 'asistentes',
    singular: 'asistente',
    Singular: 'Asistente',
    cargoPorDefecto: 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - ASISTENTES CDA',
    ruta: 'asistentes',
  },
  DIGITADOR: {
    centro: 'CPE',
    titulo: 'Digitadores',
    plural: 'digitadores',
    singular: 'digitador',
    Singular: 'Digitador',
    cargoPorDefecto: 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - DIGITADORES',
    ruta: 'digitadores',
  },
  ASISTENTE_ARCHIVOS: {
    centro: 'CPE',
    titulo: 'Asistentes de Archivos',
    plural: 'asistentes de archivos',
    singular: 'asistente de archivos',
    Singular: 'Asistente de archivos',
    cargoPorDefecto: 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - ASISTENTES DE ARCHIVOS',
    ruta: 'asistentes-archivos',
  },
  ASISTENTE_FIRMAS: {
    centro: 'CPE',
    titulo: 'Asistentes de firmas',
    plural: 'asistentes de firmas',
    singular: 'asistente de firmas',
    Singular: 'Asistente de firmas',
    cargoPorDefecto: 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - ASISTENTES DE FIRMAS',
    ruta: 'asistentes-firmas',
  },
  RECEPTOR_ACTAS: {
    centro: 'CPE',
    titulo: 'Receptores de actas',
    plural: 'receptores de actas',
    singular: 'receptor de actas',
    Singular: 'Receptor de actas',
    cargoPorDefecto: 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - RECEPTORES DE ACTAS',
    ruta: 'receptores-actas',
  },
  ARCHIVADOR_ACTAS: {
    centro: 'CPE',
    titulo: 'Archivadores de actas',
    plural: 'archivadores de actas',
    singular: 'archivador de actas',
    Singular: 'Archivador de actas',
    cargoPorDefecto: 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - ARCHIVADORES DE ACTAS',
    ruta: 'archivadores-actas',
  },
  SUPERVISOR: {
    centro: 'CPE',
    titulo: 'Supervisores',
    plural: 'supervisores',
    singular: 'supervisor',
    Singular: 'Supervisor',
    cargoPorDefecto: 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - SUPERVISORES',
    ruta: 'supervisores',
  },
  OPERADOR_ESCANER_CPE: {
    centro: 'CPE',
    titulo: 'Operadores de escáner CPE',
    plural: 'operadores de escáner CPE',
    singular: 'operador de escáner CPE',
    Singular: 'Operador de escáner CPE',
    cargoPorDefecto: 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - OPERADORES DE ESCÁNER CPE',
    ruta: 'operadores-escaner-cpe',
  },
};

/** Secciones del selector de cargo. */
export const CENTROS = ['CDA', 'CPE'] as const;

/** Los 9 originales: lo que hay mientras llega la lista de la API (y en pruebas). */
export const CARGOS_BASE: CargoCda[] = Object.entries(TEXTOS_GRUPO).map(([clave, t], i) => ({
  clave,
  nombre: t.titulo,
  centro: t.centro,
  activo: true,
  protegido: clave === 'OPERADOR' || clave === 'ASISTENTE',
  orden: i + 1,
  personas: 0,
}));

const PREFIJO_CARGO = 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - ';

/**
 * Textos de un cargo. Los originales conservan los suyos (si se renombran
 * cambia solo el título); uno nuevo los arma con su nombre y dice "persona".
 */
export function textosDeCargo(clave: GrupoCda, cargos: readonly CargoCda[]): TextosGrupo {
  const c = cargos.find((x) => x.clave === clave);
  const base = TEXTOS_GRUPO[clave];
  if (base) return c ? { ...base, titulo: c.nombre } : base;
  const nombre = c?.nombre ?? clave;
  return {
    centro: c?.centro ?? 'CPE',
    titulo: nombre,
    plural: nombre.toLowerCase(),
    singular: 'persona',
    Singular: 'Persona',
    cargoPorDefecto: `${PREFIJO_CARGO}${nombre.toUpperCase()}`,
    // Las rutas de los originales usan "-": con "_" no chocan nunca.
    ruta: clave.toLowerCase(),
  };
}

/** ?grupo= de la URL -> cargo (también uno desactivado); ausente o desconocido = OPERADOR. */
export function grupoDeRuta(ruta: string | null, cargos: readonly CargoCda[] = CARGOS_BASE): GrupoCda {
  return cargos.find((c) => textosDeCargo(c.clave, cargos).ruta === ruta)?.clave ?? 'OPERADOR';
}

/** Lista de cargos de la API (la pone la página CDAs). Sin proveedor, los 9 originales. */
export const CargosCdaContext = createContext<readonly CargoCda[]>(CARGOS_BASE);

export function useCargosCda() {
  const cargos = useContext(CargosCdaContext);
  return { cargos, textos: (clave: GrupoCda) => textosDeCargo(clave, cargos) };
}

/**
 * Grupo que se está viendo en la página CDAs. Todas las pestañas (listado,
 * asistencia, atrasos, actas) y sus modales lo leen de aquí: son los mismos
 * componentes para todos los cargos. Fuera de la página vale OPERADOR.
 */
export const GrupoCdaContext = createContext<GrupoCda>('OPERADOR');

export function useGrupoCda(): { grupo: GrupoCda } & TextosGrupo {
  const grupo = useContext(GrupoCdaContext);
  const { textos } = useCargosCda();
  return { grupo, ...textos(grupo) };
}
