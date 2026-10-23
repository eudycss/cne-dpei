import type * as ExcelJS from 'exceljs';

/** Campos que se leen del Excel de talento humano. */
export type CampoOperadorCda =
  | 'numero'
  | 'apellidosNombres'
  | 'cedula'
  | 'telefono'
  | 'cargo'
  | 'unidad'
  | 'fechaInicio';

export interface FilaLeida {
  /** Número de fila en la hoja (para mostrar errores). */
  fila: number;
  datos: Partial<Record<CampoOperadorCda, string | number>>;
}

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

// El encabezado no siempre está en la fila 1 (el Excel trae membrete): se
// busca en las primeras filas.
const MAX_FILAS_MEMBRETE = 30;

/** Sin tildes, minúsculas y solo letras/números separados por un espacio. */
export function normalizarEncabezado(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function campoDeEncabezado(texto: string): CampoOperadorCda | null {
  const h = normalizarEncabezado(texto);
  if (['n', 'no', 'nro', 'numero'].includes(h)) return 'numero';
  // "Apellidos Nombres" o "Apellidos y Nombres" (una sola columna "apellidos"
  // es de otra plantilla, p. ej. la de militares).
  if (/^apellidos (y )?nombres$/.test(h)) return 'apellidosNombres';
  if (h.startsWith('cedula')) return 'cedula';
  if (h.startsWith('telefono')) return 'telefono';
  if (h === 'cargo') return 'cargo';
  if (h === 'unidad') return 'unidad';
  if (h === 'inicial' || h.startsWith('fecha')) return 'fechaInicio';
  return null;
}

function fechaIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function textoCelda(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (v instanceof Date) return fechaIso(v);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('').trim();
    if ('result' in v) return textoCelda(v.result as ExcelJS.CellValue);
    if ('text' in v) return textoCelda(v.text as ExcelJS.CellValue);
    return '';
  }
  return String(v).trim();
}

/**
 * "20 de octubre de 2026" o "20/10/2026" → "2026-10-20". Si no se reconoce,
 * devuelve el texto tal cual para que la validación muestre el error.
 */
export function normalizarFecha(texto: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  const n = normalizarEncabezado(texto);
  const larga = /^(\d{1,2}) de ([a-z]+) del? (\d{4})$/.exec(n);
  const corta = /^(\d{1,2}) (\d{1,2}) (\d{4})$/.exec(n);
  let dia: number, mes: number | undefined, anio: number;
  if (larga) {
    [dia, mes, anio] = [Number(larga[1]), MESES[larga[2]], Number(larga[3])];
  } else if (corta) {
    [dia, mes, anio] = [Number(corta[1]), Number(corta[2]), Number(corta[3])];
  } else {
    return texto;
  }
  if (!mes || mes > 12 || dia < 1 || dia > 31) return texto;
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

// Excel guarda a veces cédulas y celulares como número y se pierde el 0
// inicial (cédulas de provincias 01-09, celulares 09…).
function conCeroInicial(texto: string): string {
  return /^\d{9}$/.test(texto) ? `0${texto}` : texto;
}

function valorCampo(campo: CampoOperadorCda, texto: string): string | number {
  switch (campo) {
    case 'numero':
      return /^\d+$/.test(texto) ? Number(texto) : texto;
    case 'cedula':
    case 'telefono':
      return conCeroInicial(texto.replace(/\s+/g, ''));
    case 'fechaInicio':
      return normalizarFecha(texto);
    default:
      return texto;
  }
}

/**
 * Lee las filas de operadores de una hoja: encuentra la fila de encabezados
 * (la que tiene "Apellidos Nombres" y "Cédula") y devuelve las filas de
 * datos que siguen. Devuelve null si la hoja no tiene ese encabezado.
 */
export function leerFilasOperadoresCda(ws: ExcelJS.Worksheet): FilaLeida[] | null {
  let filaEncabezado = 0;
  const columnas = new Map<number, CampoOperadorCda>();

  for (let r = 1; r <= Math.min(ws.rowCount, MAX_FILAS_MEMBRETE) && !filaEncabezado; r++) {
    const candidatas = new Map<number, CampoOperadorCda>();
    ws.getRow(r).eachCell((cell, col) => {
      const campo = campoDeEncabezado(textoCelda(cell.value));
      if (campo && ![...candidatas.values()].includes(campo)) candidatas.set(col, campo);
    });
    const campos = [...candidatas.values()];
    if (campos.includes('cedula') && campos.includes('apellidosNombres')) {
      filaEncabezado = r;
      candidatas.forEach((campo, col) => columnas.set(col, campo));
    }
  }
  if (!filaEncabezado) return null;

  const filas: FilaLeida[] = [];
  for (let r = filaEncabezado + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const datos: FilaLeida['datos'] = {};
    columnas.forEach((campo, col) => {
      const texto = textoCelda(row.getCell(col).value);
      if (texto) datos[campo] = valorCampo(campo, texto);
    });
    // Filas sin nombre ni cédula (totales, firmas al pie) no son operadores.
    if (datos.cedula || datos.apellidosNombres) filas.push({ fila: r, datos });
  }
  return filas;
}
