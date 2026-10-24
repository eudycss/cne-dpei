import { existsSync } from 'fs';
import { join } from 'path';

import PDFDocument from 'pdfkit';
import type { Response } from 'express';

// Estilo común de los PDF institucionales (actas de custodia, informe del
// operador CDA): A4, Helvetica, tablas con borde gris.
export const MARGEN = 48;
export const ANCHO = 595.28 - MARGEN * 2; // A4 vertical
export const ANCHO_HORIZONTAL = 841.89 - MARGEN * 2; // A4 horizontal
export const GRIS = '#6b7280';
export const LINEA = '#9ca3af';

// Logo de las Elecciones 2027 (src/assets, copiado a dist por nest-cli). JPEG
// sobre blanco: pdfkit lo incrusta sin decodificar transparencias. Se pasa por
// ruta para que pdfkit lo incruste una sola vez y lo reutilice en cada página.
// Si falta, el PDF sale sin logo en vez de fallar.
// También lo usan los Excel de reportes (ExcelJS lo lee por ruta).
export const RUTA_LOGO = join(__dirname, '..', 'assets', 'logo-elecciones-2027.jpg');
export const hayLogo = existsSync(RUTA_LOGO);
const ALTO_LOGO = 70;

/**
 * Crea un documento A4 y la promesa que se resuelve con el PDF al llamar
 * `doc.end()`. La orientación vale también para las páginas que agrega
 * `asegurarEspacio`. Con `paginar` las páginas quedan en memoria hasta el
 * final para poder escribir el pie con `piePaginas`.
 */
export function nuevoPdf(
  layout: 'portrait' | 'landscape' = 'portrait',
  { paginar = false }: { paginar?: boolean } = {},
): { doc: PDFKit.PDFDocument; terminado: Promise<Buffer> } {
  const doc = new PDFDocument({ size: 'A4', layout, margin: MARGEN, autoFirstPage: false, bufferPages: paginar });
  const chunks: Buffer[] = [];
  const terminado = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  return { doc, terminado };
}

export function fecha(d: Date): string {
  // dd/mm/aaaa hh:mm, hora de Ecuador continental.
  return d.toLocaleString('es-EC', {
    timeZone: 'America/Guayaquil',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Si lo que sigue (alto en pt) no cabe en la página, pasa a una nueva. */
export function asegurarEspacio(doc: PDFKit.PDFDocument, alto: number): void {
  if (doc.y + alto > doc.page.height - MARGEN) {
    doc.addPage();
    doc.x = MARGEN;
    doc.y = MARGEN;
  }
}

/** Logo, institución y título, centrados en `ancho`. */
export function encabezado(doc: PDFKit.PDFDocument, ancho: number, textoTitulo: string): void {
  if (hayLogo) {
    doc.image(RUTA_LOGO, MARGEN, MARGEN, { fit: [ancho, ALTO_LOGO], align: 'center' });
    doc.y = MARGEN + ALTO_LOGO + 10;
  }
  doc.font('Helvetica-Bold').fontSize(9).fillColor(GRIS)
    .text('CONSEJO NACIONAL ELECTORAL — DELEGACIÓN PROVINCIAL DE IMBABURA', MARGEN, doc.y, {
      width: ancho,
      align: 'center',
    });
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#000').text(textoTitulo, { width: ancho, align: 'center' });
  doc.moveDown(0.4);
}

export function titulo(doc: PDFKit.PDFDocument, texto: string): void {
  doc.x = MARGEN;
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#000').text(texto.toUpperCase());
  doc.moveDown(0.25);
}

export function tabla(
  doc: PDFKit.PDFDocument,
  encabezados: string[],
  proporciones: number[],
  filas: string[][],
  ancho = ANCHO,
): void {
  const anchos = proporciones.map((p) => p * ancho);
  const pad = 4;
  const dibujarFila = (celdas: string[], negrita: boolean) => {
    doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
    const alto =
      Math.max(...celdas.map((c, i) => doc.heightOfString(c, { width: anchos[i] - pad * 2 }))) + pad * 2;
    const pagina = doc.page;
    asegurarEspacio(doc, alto);
    // En página nueva se repiten los encabezados (si no, las columnas quedan sin título).
    if (!negrita && doc.page !== pagina) {
      dibujarFila(encabezados, true);
      doc.font('Helvetica').fontSize(8.5);
    }
    const y = doc.y;
    let x = MARGEN;
    celdas.forEach((c, i) => {
      if (negrita) doc.rect(x, y, anchos[i], alto).fillAndStroke('#f3f4f6', LINEA).fillColor('#000');
      else doc.rect(x, y, anchos[i], alto).stroke(LINEA);
      doc.text(c, x + pad, y + pad, { width: anchos[i] - pad * 2 });
      x += anchos[i];
    });
    doc.x = MARGEN;
    doc.y = y + alto;
  };
  dibujarFila(encabezados, true);
  for (const f of filas) dibujarFila(f, false);
  doc.moveDown(0.3);
}

/**
 * "texto · Página n de N" al pie de cada página. Requiere `nuevoPdf(…, { paginar: true })`
 * y se llama justo antes de `doc.end()`.
 */
export function piePaginas(doc: PDFKit.PDFDocument, texto: string): void {
  const { start, count } = doc.bufferedPageRange();
  for (let i = 0; i < count; i++) {
    doc.switchToPage(start + i);
    // Sin margen inferior: si no, escribir por debajo de él abre una página nueva.
    const inferior = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7.5).fillColor(GRIS)
      .text(`${texto} · Página ${i + 1} de ${count}`, MARGEN, doc.page.height - MARGEN / 2 - 6, {
        width: doc.page.width - MARGEN * 2,
        align: 'center',
        lineBreak: false,
      });
    doc.page.margins.bottom = inferior;
  }
}

export function enviarPdf(res: Response, pdf: Buffer, archivo: string): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${archivo}"`);
  // Llevan cédulas y fotos: que ningún caché los guarde.
  res.setHeader('Cache-Control', 'no-store');
  res.send(pdf);
}
