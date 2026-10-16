import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { TipoRecinto } from '@cne/shared-types';
import { descargarExcelDrive, normalizarEncabezado, textoCelda } from '../enlaces/drive-excel';

/** Variable de entorno con el id del Google Sheet de recintos (compartido por enlace). */
export const RECINTOS_SHEET_VARIABLE = 'RECINTOS_SHEET_ID';
/** De esta hoja salen los NO CDA (trae también los CDA, pero esos se toman de la otra). */
export const HOJA_NO_CDAS = 'HOJA1';
/** De esta hoja salen los CDA: es donde la Delegación cambia qué recintos son CDA. */
export const HOJA_CDAS = 'INFORMACION.TOTAL-CDAS';

/** Un recinto tal como viene en el Sheet. */
export interface RecintoSheet {
  codigoRecinto: string;
  nombre: string;
  direccion: string | null;
  cantonCodigo: string;
  parroquia: string | null;
  zona: string | null;
  tipo: TipoRecinto;
  /** Código del CDA al que entrega (solo NO CDA). Puede no ser un recinto ("CPE-DELEGACION…"). */
  cdaDestinoCodigo: string | null;
  latitud: number | null;
  longitud: number | null;
  tieneInternet: boolean;
  coberturaMovil: boolean;
  numeroElectores: number | null;
  juntasFemeninas: number | null;
  juntasMasculinas: number | null;
  esDificilAcceso: boolean;
}

const COLUMNAS = {
  codigo: 'CODIGO RECINTO',
  nombre: 'NOMBRE RECINTO',
  direccion: 'DIRECCION RECINTO',
  canton: 'CODIGO CANTON',
  parroquia: 'NOMBRE PARROQUIA',
  zona: 'NOMBRE ZONA',
  tipo: 'CDAS',
  cdaDestino: 'CODIGO CDA O CPE QUE SE TRASLADA',
  latitud: 'LAT',
  longitud: 'LONG',
  internet: 'INTERNET',
  coberturaCnt: 'COBERTURA CNT',
  coberturaClaro: 'COBERTURA CLARO',
  coberturaMovistar: 'COBERTURA MOVISTAR',
  electores: 'NUMERO ELECTORES',
  juntasFem: 'JUN_ FEM',
  juntasMas: 'JUN_ MAS',
  dificilAcceso: 'RECINTO REZAGADO O DE DIFICIL ACCESO',
} as const;
type Columna = keyof typeof COLUMNAS;
/** Sin estas no se puede armar el recinto; las demás, si faltan, quedan vacías. */
const OBLIGATORIAS: Columna[] = ['codigo', 'nombre', 'canton', 'tipo', 'cdaDestino', 'latitud', 'longitud'];

/**
 * Lee el Sheet de recintos: los NO CDA de "Hoja1" y los CDA de
 * "INFORMACION.TOTAL-CDAS". Un código repetido vale la última fila.
 */
export function leerRecintosSheet(workbook: ExcelJS.Workbook): RecintoSheet[] {
  const noCdas = leerHoja(workbook, HOJA_NO_CDAS).filter((r) => r.tipo === 'NO_CDA');
  const cdas = leerHoja(workbook, HOJA_CDAS).filter((r) => r.tipo === 'CDA');
  const porCodigo = new Map<string, RecintoSheet>();
  for (const r of [...noCdas, ...cdas]) porCodigo.set(r.codigoRecinto, r);
  return [...porCodigo.values()];
}

function leerHoja(workbook: ExcelJS.Workbook, nombre: string): RecintoSheet[] {
  const ws = workbook.worksheets.find((w) => normalizarEncabezado(w.name) === nombre);
  if (!ws) throw new Error(`El Sheet de recintos no tiene la hoja "${nombre}"`);
  const { fila, indices } = buscarEncabezado(ws, nombre);

  const recintos: RecintoSheet[] = [];
  ws.eachRow((row, n) => {
    if (n <= fila) return;
    // Array.from y no .map: row.values tiene huecos (celdas vacías) que .map salta.
    const valores = Array.from(row.values as ExcelJS.CellValue[]);
    const celda = (c: Columna) => (indices[c] === -1 ? '' : textoCelda(valores[indices[c]]));
    const codigoRecinto = celda('codigo');
    if (!/^\d{1,20}$/.test(codigoRecinto)) return;
    const tipo = aTipo(celda('tipo'));
    if (!tipo) return;

    recintos.push({
      codigoRecinto,
      nombre: quitarSufijoCodigo(celda('nombre'), codigoRecinto),
      direccion: textoOpcional(celda('direccion')),
      cantonCodigo: celda('canton'),
      parroquia: textoOpcional(celda('parroquia')),
      zona: textoOpcional(celda('zona')),
      tipo,
      cdaDestinoCodigo: tipo === 'NO_CDA' ? textoOpcional(celda('cdaDestino')) : null,
      latitud: aNumero(celda('latitud')),
      longitud: aNumero(celda('longitud')),
      tieneInternet: esSi(celda('internet')),
      coberturaMovil: esSi(celda('coberturaCnt')) || esSi(celda('coberturaClaro')) || esSi(celda('coberturaMovistar')),
      numeroElectores: aEntero(celda('electores')),
      juntasFemeninas: aEntero(celda('juntasFem')),
      juntasMasculinas: aEntero(celda('juntasMas')),
      esDificilAcceso: esSi(celda('dificilAcceso')),
    });
  });
  return recintos;
}

/** Hoja1 trae títulos arriba: se busca la fila que tenga CODIGO RECINTO, no se asume la primera. */
function buscarEncabezado(ws: ExcelJS.Worksheet, nombre: string): { fila: number; indices: Record<Columna, number> } {
  let encontrado: { fila: number; indices: Record<Columna, number> } | null = null;
  ws.eachRow((row, n) => {
    if (encontrado) return;
    const encabezados = Array.from(row.values as ExcelJS.CellValue[], (v) => normalizarEncabezado(textoCelda(v)));
    if (!encabezados.includes(COLUMNAS.codigo)) return;
    const indices = Object.fromEntries(
      (Object.keys(COLUMNAS) as Columna[]).map((c) => [c, encabezados.indexOf(COLUMNAS[c])]),
    ) as Record<Columna, number>;
    encontrado = { fila: n, indices };
  });
  if (!encontrado) throw new Error(`La hoja "${nombre}" no tiene la columna ${COLUMNAS.codigo}`);
  const { indices } = encontrado as { fila: number; indices: Record<Columna, number> };
  const faltantes = OBLIGATORIAS.filter((c) => indices[c] === -1).map((c) => COLUMNAS[c]);
  if (faltantes.length > 0) {
    throw new Error(`La hoja "${nombre}" no tiene la(s) columna(s): ${faltantes.join(', ')}`);
  }
  return encontrado;
}

function aTipo(valor: string): TipoRecinto | null {
  const v = normalizarEncabezado(valor).replace(/[-_]/g, ' ');
  if (v === 'CDA') return 'CDA';
  if (v === 'NO CDA') return 'NO_CDA';
  return null;
}

/** La hoja de CDAs agrega el código al nombre ("Unidad Educativa Ibarra - 28"). */
function quitarSufijoCodigo(nombre: string, codigo: string): string {
  return nombre.replace(new RegExp(`\\s*-\\s*${codigo}$`), '').trim();
}

function textoOpcional(valor: string): string | null {
  const v = valor.replace(/\s+/g, ' ').trim();
  // Sin recortar: un texto demasiado largo se reporta como error de la fila al sincronizar.
  return v && v.toUpperCase() !== 'N/A' ? v : null;
}

const esSi = (valor: string) => normalizarEncabezado(valor) === 'SI';

function aNumero(valor: string): number | null {
  if (!valor) return null;
  const n = Number(valor.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function aEntero(valor: string): number | null {
  const n = aNumero(valor);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
}

@Injectable()
export class RecintosSheetClient {
  /** Sin caché: lo dispara un administrador y espera ver el Sheet tal como está ahora. */
  async leer(): Promise<RecintoSheet[]> {
    return leerRecintosSheet(await descargarExcelDrive(RECINTOS_SHEET_VARIABLE));
  }
}
