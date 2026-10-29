import { createContext, useContext } from 'react';
import type { GrupoCda } from '@cne/shared-types';

type TextosGrupo = {
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
 * Textos que cambian entre los cargos del personal CDA. El orden es el del
 * selector de cargo. En el listado el cargo se ve abreviado (Asist. Adm.
 * Electoral Provincial) para todos.
 */
export const TEXTOS_GRUPO: Record<GrupoCda, TextosGrupo> = {
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

/** Cargos en el orden del selector. */
export const GRUPOS = Object.keys(TEXTOS_GRUPO) as GrupoCda[];

/** Secciones del selector de cargo. */
export const CENTROS = ['CDA', 'CPE'] as const;

/** ?grupo= de la URL -> cargo; ausente o desconocido = OPERADOR. */
export function grupoDeRuta(ruta: string | null): GrupoCda {
  return GRUPOS.find((g) => TEXTOS_GRUPO[g].ruta === ruta) ?? 'OPERADOR';
}

/**
 * Grupo que se está viendo en la página CDAs. Todas las pestañas (listado,
 * asistencia, atrasos, actas) y sus modales lo leen de aquí: son los mismos
 * componentes para todos los cargos. Fuera de la página vale OPERADOR.
 */
export const GrupoCdaContext = createContext<GrupoCda>('OPERADOR');

export function useGrupoCda(): { grupo: GrupoCda } & TextosGrupo {
  const grupo = useContext(GrupoCdaContext);
  return { grupo, ...TEXTOS_GRUPO[grupo] };
}
