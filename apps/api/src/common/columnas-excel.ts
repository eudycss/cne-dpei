import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { parseUploadRows } from './parse-upload-rows';

/** "N.º mochila" → "nmochila"; "Cédula" → "cedula" (sin tildes ni signos, en minúsculas). */
export function claveColumna(encabezado: string): string {
  return encabezado
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** El valor de la primera columna cuyo encabezado (normalizado) está entre `aceptadas`, o "". */
export function columna(fila: Record<string, string>, aceptadas: readonly string[]): string {
  for (const [encabezado, valor] of Object.entries(fila)) {
    if (aceptadas.includes(claveColumna(encabezado))) return (valor ?? '').trim();
  }
  return '';
}

/**
 * Filas no vacías de un .xlsx o .csv. Otro formato o un archivo dañado es un
 * 400 claro (sin el detalle interno), no un 500. `queEs` va en el mensaje.
 */
export async function leerFilasArchivo(file: Express.Multer.File, queEs: string): Promise<Record<string, string>[]> {
  const nombre = (file.originalname ?? '').toLowerCase();
  if (!nombre.endsWith('.xlsx') && !nombre.endsWith('.csv')) {
    throw new BadRequestException('Use la plantilla en Excel (.xlsx) o un archivo .csv');
  }
  let filas: Record<string, string>[];
  try {
    filas = await parseUploadRows(file);
  } catch {
    throw new BadRequestException(`No se pudo leer el archivo: revise que sea ${queEs}`);
  }
  return filas.filter((f) => Object.values(f).some((v) => (v ?? '').trim() !== ''));
}

/** Texto de una celda de Excel: fecha como AAAA-MM-DD, fórmulas por su resultado, texto con formato por su texto. */
function textoCelda(valor: ExcelJS.CellValue): string {
  if (valor == null) return '';
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  if (typeof valor === 'object') {
    const v = valor as { result?: unknown; text?: unknown; richText?: { text: string }[] };
    if (v.result !== undefined) return v.result instanceof Date ? v.result.toISOString().slice(0, 10) : String(v.result ?? '');
    if (typeof v.text === 'string') return v.text;
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    return '';
  }
  return String(valor).trim();
}

/**
 * Como `leerFilasArchivo`, pero cada fila con su número real en el archivo
 * (para que "fila 12" sea la fila 12 aunque haya filas en blanco) y con un
 * tope de filas que en Excel se revisa antes de leerlas todas.
 */
export async function leerFilasConNumero(
  file: Express.Multer.File,
  queEs: string,
  maxFilas: number,
): Promise<{ fila: number; datos: Record<string, string> }[]> {
  const nombre = (file.originalname ?? '').toLowerCase();
  if (nombre.endsWith('.csv')) {
    return (await leerFilasArchivo(file, queEs)).map((datos, i) => ({ fila: i + 2, datos }));
  }
  if (!nombre.endsWith('.xlsx')) throw new BadRequestException('Use la plantilla en Excel (.xlsx) o un archivo .csv');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file.buffer as any);
  } catch {
    throw new BadRequestException(`No se pudo leer el archivo: revise que sea ${queEs}`);
  }
  const ws = wb.worksheets[0];
  if (!ws) return [];
  if (ws.actualRowCount - 1 > maxFilas) {
    throw new BadRequestException(`El archivo tiene ${ws.actualRowCount - 1} filas; el máximo es ${maxFilas}`);
  }
  const encabezados: string[] = [];
  ws.getRow(1).eachCell((celda, col) => {
    encabezados[col - 1] = textoCelda(celda.value).toLowerCase();
  });
  const filas: { fila: number; datos: Record<string, string> }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, numero) => {
    if (numero === 1) return;
    const datos: Record<string, string> = {};
    encabezados.forEach((h, i) => {
      if (h) datos[h] = textoCelda(row.getCell(i + 1).value);
    });
    if (Object.values(datos).some((v) => v !== '')) filas.push({ fila: numero, datos });
  });
  return filas;
}
