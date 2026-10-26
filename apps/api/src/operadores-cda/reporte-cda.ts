import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import type { Response } from 'express';
import {
  MAX_DIAS_REPORTE_PDF,
  MENSAJE_MAX_DIAS_PDF,
  diasDelRango,
  modoReporteCdaSchema,
} from '@cne/shared-validation';
import type { FormatoReporteCda, ModoReporteCda } from '@cne/shared-types';

import {
  ANCHO_HORIZONTAL,
  FONDO_RESALTADO,
  GRIS,
  RUTA_LOGO,
  asegurarEspacio,
  encabezado,
  fecha as fechaHora,
  hayLogo,
  nuevoPdf,
  piePaginas,
  tabla,
  titulo,
} from '../common/pdf';
import { fechaDb } from './dia-ecuador';

/**
 * Excel y PDF de los reportes de Operadores CDA (asistencia y atrasos) con el
 * mismo encabezado institucional que las actas de custodia: logo de las
 * Elecciones 2027, institución, título y una línea con el rango y la regla.
 * Cada tabla es una hoja del Excel y una sección (desde página nueva) del PDF.
 */

// Armar el archivo cuesta CPU (Render: 0.1 vCPU); mismo límite que las descargas de actas.
export const LIMITE_DESCARGA_REPORTE = { default: { limit: 30, ttl: 60_000 } };

const INSTITUCION = 'CONSEJO NACIONAL ELECTORAL — DELEGACIÓN PROVINCIAL DE IMBABURA';
/** Filas 1-3: logo; 4: institución; 5: título; 6: tabla; 7: detalle; 8: encabezados. */
export const FILA_ENCABEZADOS_EXCEL = 8;
const MAX_NOMBRE_HOJA = 31;

export type Celda = string | number;

export interface ColumnaReporte {
  titulo: string;
  /** Ancho en caracteres en el Excel; en el PDF, proporción respecto a las demás. */
  ancho: number;
}

/** Tabla corta que va debajo de la principal, en la misma hoja/sección. */
export interface AnexoReporte {
  titulo: string;
  columnas: ColumnaReporte[];
  /** Vacío = solo se imprime el título. */
  filas: Celda[][];
}

export interface TablaReporte {
  /** Nombre de la hoja del Excel (único, se recorta a 31 caracteres). */
  hoja: string;
  titulo: string;
  columnas: ColumnaReporte[];
  filas: Celda[][];
  /** Índices de `filas` con fondo rojo claro. */
  resaltadas?: number[];
  anexo?: AnexoReporte;
}

export interface ReporteCda {
  titulo: string;
  /** Rango, regla de puntualidad, etc.: va bajo el título de cada tabla. */
  detalle: string;
  /** Prefijo del nombre del archivo (solo [a-z0-9_]). */
  archivo: string;
  desde: string;
  hasta: string;
  modo: ModoReporteCda;
  tablas: TablaReporte[];
}

export interface ArchivoReporte {
  nombre: string;
  tipo: string;
  contenido: Buffer;
}

const TIPO: Record<FormatoReporteCda, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

const RESALTADO_EXCEL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: `FF${FONDO_RESALTADO.slice(1).toUpperCase()}` },
};

const SIN_DATOS: TablaReporte = {
  hoja: 'Reporte',
  titulo: 'Sin registros',
  columnas: [{ titulo: 'Mensaje', ancho: 60 }],
  filas: [['No hay operadores activos en el rango elegido.']],
};

export function parsearModo(v: unknown): ModoReporteCda {
  const r = modoReporteCdaSchema.safeParse(v);
  if (!r.success) throw new BadRequestException(r.error.issues[0]?.message ?? 'Modo de reporte inválido');
  return r.data;
}

/** "viernes, 23 de octubre de 2026". */
export function diaLargo(dia: string): string {
  return new Intl.DateTimeFormat('es-EC', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(fechaDb(dia));
}

/** AAAA-MM-DD → dd/mm/aaaa. */
export function diaCorto(dia: string): string {
  const [a, m, d] = dia.split('-');
  return `${d}/${m}/${a}`;
}

/** Agrupa por `fecha` respetando el orden en que llegan las filas. */
export function agruparPorDia<T extends { fecha: string }>(filas: T[]): Map<string, T[]> {
  const grupos = new Map<string, T[]>();
  for (const f of filas) {
    const g = grupos.get(f.fecha);
    if (g) g.push(f);
    else grupos.set(f.fecha, [f]);
  }
  return grupos;
}

export async function generarReporte(r: ReporteCda, formato: FormatoReporteCda): Promise<ArchivoReporte> {
  // 100 operadores x 120 días en PDF tardan ~10 s en un equipo de escritorio: en Render bloquearía el API.
  if (formato === 'pdf' && diasDelRango(r.desde, r.hasta) > MAX_DIAS_REPORTE_PDF) {
    throw new BadRequestException(MENSAJE_MAX_DIAS_PDF);
  }
  const contenido = formato === 'pdf' ? await pdfReporte(r) : await excelReporte(r);
  const sufijo = r.modo === 'POR_DIA' ? '_por_dia' : '';
  return { nombre: `${r.archivo}_${r.desde}_${r.hasta}${sufijo}.${formato}`, tipo: TIPO[formato], contenido };
}

export function enviarReporte(res: Response, a: ArchivoReporte): void {
  res.setHeader('Content-Type', a.tipo);
  res.setHeader('Content-Disposition', `attachment; filename="${a.nombre}"`);
  // Llevan cédulas: que ningún caché los guarde.
  res.setHeader('Cache-Control', 'no-store');
  res.send(a.contenido);
}

async function excelReporte(r: ReporteCda): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const logo = hayLogo ? wb.addImage({ filename: RUTA_LOGO, extension: 'jpeg' }) : null;
  const detalle = `${r.detalle} · Generado el ${fechaHora(new Date())}`;

  for (const t of r.tablas.length ? r.tablas : [SIN_DATOS]) {
    const ws = wb.addWorksheet(t.hoja.slice(0, MAX_NOMBRE_HOJA));
    const n = t.columnas.length;
    ws.columns = t.columnas.map((c) => ({ width: c.ancho }));

    // Logo de 1200x487 px: a 70 px de alto cabe en las tres primeras filas.
    for (const f of [1, 2, 3]) ws.getRow(f).height = 20;
    if (logo !== null) ws.addImage(logo, { tl: { col: 0, row: 0 }, ext: { width: 172, height: 70 } });

    const lineas: [string, Partial<ExcelJS.Font>][] = [
      [INSTITUCION, { bold: true, size: 9, color: { argb: 'FF6B7280' } }],
      [r.titulo, { bold: true, size: 14 }],
      [t.titulo, { bold: true, size: 11 }],
      [detalle, { italic: true, size: 9, color: { argb: 'FF6B7280' } }],
    ];
    lineas.forEach(([texto, font], i) => {
      const fila = 4 + i;
      ws.getCell(fila, 1).value = texto;
      ws.getCell(fila, 1).font = font;
      ws.getCell(fila, 1).alignment = { horizontal: 'center', wrapText: true };
      if (n > 1) ws.mergeCells(fila, 1, fila, n);
    });

    encabezadosExcel(ws.getRow(FILA_ENCABEZADOS_EXCEL), t.columnas);
    const resaltadas = new Set(t.resaltadas);
    t.filas.forEach((f, i) => {
      const fila = ws.getRow(FILA_ENCABEZADOS_EXCEL + 1 + i);
      fila.values = f;
      if (resaltadas.has(i)) for (let c = 1; c <= n; c++) fila.getCell(c).fill = RESALTADO_EXCEL;
    });

    if (t.anexo) {
      // Una fila en blanco, el título y (si hay) la tabla con sus encabezados.
      const inicio = FILA_ENCABEZADOS_EXCEL + t.filas.length + 2;
      ws.getCell(inicio, 1).value = t.anexo.titulo;
      ws.getCell(inicio, 1).font = { bold: true, size: 11 };
      if (t.anexo.filas.length > 0) {
        encabezadosExcel(ws.getRow(inicio + 1), t.anexo.columnas);
        t.anexo.filas.forEach((f, i) => (ws.getRow(inicio + 2 + i).values = f));
      }
    }

    ws.views = [{ state: 'frozen', ySplit: FILA_ENCABEZADOS_EXCEL }];
    ws.autoFilter = { from: { row: FILA_ENCABEZADOS_EXCEL, column: 1 }, to: { row: FILA_ENCABEZADOS_EXCEL, column: n } };
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    ws.pageSetup.printTitlesRow = `${FILA_ENCABEZADOS_EXCEL}:${FILA_ENCABEZADOS_EXCEL}`;
  }
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

function encabezadosExcel(fila: ExcelJS.Row, columnas: ColumnaReporte[]): void {
  fila.values = columnas.map((c) => c.titulo);
  fila.font = { bold: true };
  fila.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
    c.border = { bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } } };
    // Un título más largo que su columna ("Origen entrada") pasa a dos líneas en vez de cortarse.
    c.alignment = { wrapText: true, vertical: 'top' };
  });
}

const proporciones = (columnas: ColumnaReporte[]) => {
  const total = columnas.reduce((s, c) => s + c.ancho, 0);
  return columnas.map((c) => c.ancho / total);
};

async function pdfReporte(r: ReporteCda): Promise<Buffer> {
  const { doc, terminado } = nuevoPdf('landscape', { paginar: true });
  for (const t of r.tablas.length ? r.tablas : [SIN_DATOS]) {
    doc.addPage();
    encabezado(doc, ANCHO_HORIZONTAL, r.titulo);
    doc.font('Helvetica').fontSize(9).fillColor(GRIS).text(r.detalle, { width: ANCHO_HORIZONTAL, align: 'center' });
    titulo(doc, t.titulo);
    tabla(
      doc,
      t.columnas.map((c) => c.titulo),
      proporciones(t.columnas),
      t.filas.map((f) => f.map(String)),
      ANCHO_HORIZONTAL,
      new Set(t.resaltadas),
    );
    if (t.anexo) {
      // Que el título no quede solo al pie de una página.
      asegurarEspacio(doc, 60);
      titulo(doc, t.anexo.titulo);
      if (t.anexo.filas.length > 0) {
        tabla(
          doc,
          t.anexo.columnas.map((c) => c.titulo),
          proporciones(t.anexo.columnas),
          t.anexo.filas.map((f) => f.map(String)),
          ANCHO_HORIZONTAL,
        );
      }
    }
  }
  piePaginas(doc, `Generado el ${fechaHora(new Date())}`);
  doc.end();
  return terminado;
}
