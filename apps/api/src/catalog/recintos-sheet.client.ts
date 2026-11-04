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
/** Formato 2027 ("RUTAS-DISTRIBUTIVO-RECINTOS-NO-CDA-CDA"): una sola hoja nacional con CDA y NO CDA. */
export const HOJA_DISTRIBUTIVO = 'DISTRIBUTIVO';
/** Del archivo nacional solo se toman los recintos de esta provincia. */
export const PROVINCIA = 'IMBABURA';

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
  /** null = el archivo no lo dice (formato 2027): se conserva lo que tiene la base. */
  tieneInternet: boolean | null;
  /** Alguna coordenada se rearmó desde un valor dañado (formato 2027): la vista previa lo avisa. */
  coordenadasRearmadas?: boolean;
  coberturaMovil: boolean | null;
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

/** Columnas de la hoja DISTRIBUTIVO (formato 2027). */
const COLUMNAS_2027 = {
  provincia: 'NOMBRE PROVINCIA',
  codigo: 'CODIGO RECINTO',
  nombre: 'NOMBRE RECINTO',
  direccion: 'DIRECCION RECINTO',
  canton: 'CODIGO CANTON',
  parroquia: 'NOMBRE PARROQUIA',
  zona: 'NOMBRE ZONA',
  cda: 'CDA',
  cdaDestino: 'CODIGO CDA O CPE AL QUE SE TRASLADA DESDE EL NO-CDA',
  latitud: 'LAT',
  longitud: 'LONG',
  electores: 'NUMERO ELECTORES',
  juntasFem: 'JUN FEM',
  juntasMas: 'JUN MAS',
  dificilAcceso: 'DIFICIL ACCESO',
} as const;
type Columna2027 = keyof typeof COLUMNAS_2027;
const OBLIGATORIAS_2027: Columna2027[] = ['provincia', 'codigo', 'nombre', 'canton', 'cda', 'cdaDestino', 'latitud', 'longitud'];

/**
 * Lee el Sheet de recintos: los NO CDA de "Hoja1" y los CDA de
 * "INFORMACION.TOTAL-CDAS". Un código repetido vale la última fila.
 */
export function leerRecintosSheet(workbook: ExcelJS.Workbook): RecintoSheet[] {
  const distributivo = workbook.worksheets.find((w) => normalizarEncabezado(w.name) === HOJA_DISTRIBUTIVO);
  if (distributivo) return leerDistributivo(distributivo);
  const noCdas = leerHoja(workbook, HOJA_NO_CDAS).filter((r) => r.tipo === 'NO_CDA');
  const cdas = leerHoja(workbook, HOJA_CDAS).filter((r) => r.tipo === 'CDA');
  const porCodigo = new Map<string, RecintoSheet>();
  for (const r of [...noCdas, ...cdas]) porCodigo.set(r.codigoRecinto, r);
  return [...porCodigo.values()];
}

function leerHoja(workbook: ExcelJS.Workbook, nombre: string): RecintoSheet[] {
  const ws = workbook.worksheets.find((w) => normalizarEncabezado(w.name) === nombre);
  if (!ws) {
    throw new Error(
      `El Sheet de recintos no tiene la hoja "${nombre}" (ni la hoja "${HOJA_DISTRIBUTIVO}" del formato 2027)`,
    );
  }
  const { fila, indices } = buscarEncabezado(ws, nombre, COLUMNAS, OBLIGATORIAS);

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

/**
 * La hoja DISTRIBUTIVO (formato 2027): todo el país en una hoja, "CDA" = SI/NO y
 * las coordenadas a veces con los separadores dañados (ver aCoordenada).
 */
function leerDistributivo(ws: ExcelJS.Worksheet): RecintoSheet[] {
  const { fila, indices } = buscarEncabezado(ws, HOJA_DISTRIBUTIVO, COLUMNAS_2027, OBLIGATORIAS_2027);
  const recintos: RecintoSheet[] = [];
  ws.eachRow((row, n) => {
    if (n <= fila) return;
    const valores = Array.from(row.values as ExcelJS.CellValue[]);
    const celda = (c: Columna2027) => (indices[c] === -1 ? '' : textoCelda(valores[indices[c]]));
    if (normalizarEncabezado(celda('provincia')) !== PROVINCIA) return;
    const codigoRecinto = celda('codigo');
    if (!/^\d{1,20}$/.test(codigoRecinto)) return;
    const cda = normalizarEncabezado(celda('cda'));
    if (cda !== 'SI' && cda !== 'NO') return;
    const tipo: TipoRecinto = cda === 'SI' ? 'CDA' : 'NO_CDA';
    const lat = leerCoordenada(celda('latitud'), 'lat');
    const lng = leerCoordenada(celda('longitud'), 'lng');

    recintos.push({
      codigoRecinto,
      nombre: celda('nombre').replace(/\s+/g, ' ').trim(),
      direccion: textoOpcional(celda('direccion')),
      cantonCodigo: celda('canton'),
      parroquia: textoOpcional(celda('parroquia')),
      zona: textoOpcional(celda('zona')),
      tipo,
      cdaDestinoCodigo: tipo === 'NO_CDA' ? textoOpcional(celda('cdaDestino')) : null,
      latitud: lat.valor,
      longitud: lng.valor,
      coordenadasRearmadas: lat.rearmada || lng.rearmada,
      tieneInternet: null,
      coberturaMovil: null,
      numeroElectores: aEntero(celda('electores')),
      juntasFemeninas: aEntero(celda('juntasFem')),
      juntasMasculinas: aEntero(celda('juntasMas')),
      esDificilAcceso: esSi(celda('dificilAcceso')),
    });
  });
  const porCodigo = new Map<string, RecintoSheet>();
  for (const r of recintos) porCodigo.set(r.codigoRecinto, r);
  return [...porCodigo.values()];
}

/** Imbabura (con un margen pequeño) queda entre 0,1° y 0,95° N y entre 77,65° y 79,3° O (el recinto más al sur está en 0,167°). */
const RANGO = { lat: [0.1, 0.95], lng: [-79.3, -77.65] } as const;

/**
 * El archivo 2027 trae coordenadas con los separadores dañados: "347.627" por
 * 0.347627 y "-78,125,853" por -78.125853. Si el valor se lee bien y cae en
 * Imbabura, se usa tal cual; si no, se rearma desde sus dígitos (latitud
 * "0.ddd…", longitud "-dd.ddd…") y solo se acepta si así cae en Imbabura.
 */
export function aCoordenada(valor: string, eje: 'lat' | 'lng'): number | null {
  return leerCoordenada(valor, eje).valor;
}

/** Con menos dígitos que esto el valor es un relleno ("0", "1", "-78"), no una coordenada. */
const MIN_DIGITOS_REARMADO = { lat: 3, lng: 4 } as const;

function leerCoordenada(valor: string, eje: 'lat' | 'lng'): { valor: number | null; rearmada: boolean } {
  const nada = { valor: null, rearmada: false };
  const [min, max] = RANGO[eje];
  const enRango = (n: number) => Number.isFinite(n) && n >= min && n <= max;
  const limpio = valor.trim();
  if (!limpio) return nada;
  // Leído tal cual: con parte decimal (una coordenada nunca es entera), también en notación científica.
  if (/^-?\d+[.,]\d+(e-?\d+)?$/i.test(limpio)) {
    const directo = Number(limpio.replace(',', '.'));
    if (enRango(directo)) return { valor: directo, rearmada: false };
  }
  // Solo se rearma un valor hecho de dígitos y separadores, con el signo de Imbabura:
  // latitud norte (sin "-") y longitud oeste (con "-"). Así una longitud en la columna
  // de la latitud no se convierte en una latitud creíble.
  if (!/^-?[\d.,]+$/.test(limpio)) return nada;
  const negativo = limpio.startsWith('-');
  if ((eje === 'lat') === negativo) return nada;
  const digitos = limpio.replace(/\D/g, '').replace(/^0+/, '');
  if (digitos.length < MIN_DIGITOS_REARMADO[eje]) return nada;
  // Latitud: "0.ddd" o, si se perdió un cero, "0.0ddd". Solo se acepta si una sola de las
  // dos cae en Imbabura ("18.9" → 0.189, porque 0.0189 queda fuera); si caen las dos, no se adivina.
  // Longitud: siempre "-dd.ddd" (77, 78 o 79 grados).
  const candidatos =
    eje === 'lat'
      ? [Number(`0.${digitos}`), Number(`0.0${digitos}`)]
      : [-Number(`${digitos.slice(0, 2)}.${digitos.slice(2)}`)];
  const validos = candidatos.filter(enRango);
  return validos.length === 1 ? { valor: validos[0], rearmada: true } : nada;
}

/** Hoja1 trae títulos arriba: se busca la fila que tenga CODIGO RECINTO, no se asume la primera. */
function buscarEncabezado<C extends string>(
  ws: ExcelJS.Worksheet,
  nombre: string,
  columnas: Record<C, string> & { codigo: string },
  obligatorias: C[],
): { fila: number; indices: Record<C, number> } {
  let encontrado: { fila: number; indices: Record<C, number> } | null = null;
  ws.eachRow((row, n) => {
    if (encontrado) return;
    const encabezados = Array.from(row.values as ExcelJS.CellValue[], (v) => normalizarEncabezado(textoCelda(v)));
    if (!encabezados.includes(columnas.codigo)) return;
    const indices = Object.fromEntries(
      (Object.keys(columnas) as C[]).map((c) => [c, encabezados.indexOf(columnas[c])]),
    ) as Record<C, number>;
    encontrado = { fila: n, indices };
  });
  if (!encontrado) throw new Error(`La hoja "${nombre}" no tiene la columna ${columnas.codigo}`);
  const { indices } = encontrado as { fila: number; indices: Record<C, number> };
  const faltantes = obligatorias.filter((c) => indices[c] === -1).map((c) => columnas[c]);
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
