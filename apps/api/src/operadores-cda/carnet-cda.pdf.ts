import * as QRCode from 'qrcode';

import { GRIS, LINEA, RUTA_LOGO, fecha, hayLogo, nuevoPdf } from '../common/pdf';

/**
 * Carnets QR de operadores CDA en tamaño tarjeta (ISO CR80, 85,6 × 54 mm),
 * 10 por hoja A4 con el borde como guía de corte. Lleva el logo, la foto (para
 * que quien escanea compare), nombre, cargo y el QR con el token.
 */

const MM = 72 / 25.4;
const ANCHO = 85.6 * MM;
const ALTO = 54 * MM;
const COLUMNAS = 2;
const FILAS = 5;
const POR_HOJA = COLUMNAS * FILAS;
const PAD = 8;
const LADO_QR = 78;
/** Zona silenciosa del QR (~4 módulos de 2,7 pt): sin ella, algunos lectores fallan junto al borde de corte. */
const MARGEN_QR = 11;
const FOTO = { ancho: 52, alto: 66 };
// Centrado en A4 vertical (595,28 × 841,89 pt).
const X0 = (595.28 - ANCHO * COLUMNAS) / 2;
const Y0 = (841.89 - ALTO * FILAS) / 2;

export interface DatosCarnet {
  /** "OPERADOR CDA" o "ASISTENTE CDA", arriba a la derecha. */
  grupo: string;
  nombre: string;
  cargo: string;
  token: string;
  /** JPEG descifrado o null si aún no sube su foto. */
  foto: Buffer | null;
}

export async function carnetsPdf(carnets: DatosCarnet[], emitidoEn: Date): Promise<Buffer> {
  const { doc, terminado } = nuevoPdf('portrait');
  const emitido = fecha(emitidoEn).slice(0, 10);
  for (const [i, c] of carnets.entries()) {
    // Las opciones de addPage reemplazan a las del documento: sin size, pdfkit usa Carta.
    if (i % POR_HOJA === 0) doc.addPage({ size: 'A4', layout: 'portrait', margin: 0 });
    const n = i % POR_HOJA;
    dibujarCarnet(doc, c, X0 + (n % COLUMNAS) * ANCHO, Y0 + Math.floor(n / COLUMNAS) * ALTO, emitido);
  }
  doc.end();
  return terminado;
}

function dibujarCarnet(doc: PDFKit.PDFDocument, c: DatosCarnet, x: number, y: number, emitido: string) {
  doc.save().lineWidth(0.5).dash(3, { space: 2 }).rect(x, y, ANCHO, ALTO).stroke(LINEA).undash().restore();

  if (hayLogo) doc.image(RUTA_LOGO, x + PAD, y + 6, { fit: [92, 34] });
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#0e7490')
    .text(c.grupo, x + 104, y + 10, { width: ANCHO - 104 - PAD, align: 'right' });
  doc.font('Helvetica').fontSize(5.8).fillColor(GRIS)
    .text('Delegación Provincial Electoral de Imbabura', x + 104, y + 21, { width: ANCHO - 104 - PAD, align: 'right' });

  const yCuerpo = y + 46;
  const xFoto = x + PAD;
  if (c.foto) {
    try {
      doc.image(c.foto, xFoto, yCuerpo, { fit: [FOTO.ancho, FOTO.alto], align: 'center', valign: 'center' });
    } catch {
      sinFoto(doc, xFoto, yCuerpo);
    }
  } else {
    sinFoto(doc, xFoto, yCuerpo);
  }
  doc.lineWidth(0.5).rect(xFoto, yCuerpo, FOTO.ancho, FOTO.alto).stroke(LINEA);

  const xTexto = xFoto + FOTO.ancho + 6;
  const anchoTexto = ANCHO - PAD - MARGEN_QR - FOTO.ancho - 6 - LADO_QR - 6;
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#000')
    .text(c.nombre, xTexto, yCuerpo, { width: anchoTexto, height: 40, ellipsis: true });
  doc.font('Helvetica').fontSize(6.3).fillColor(GRIS)
    .text(c.cargo, xTexto, yCuerpo + 42, { width: anchoTexto, height: 24, ellipsis: true });

  qrVectorial(doc, c.token, x + ANCHO - MARGEN_QR - LADO_QR, y + ALTO - MARGEN_QR - LADO_QR - 6);

  doc.font('Helvetica').fontSize(5.3).fillColor(GRIS)
    .text(`Emitido el ${emitido} · Personal e intransferible`, x + PAD, y + ALTO - PAD - 6, {
      width: ANCHO - PAD * 2,
      align: 'left',
      lineBreak: false,
    });
}

/**
 * El QR como rectángulos (vector): nítido al imprimir y sin pasar por PNG, que
 * pdfkit decodifica en JS (60 carnets tardaban ~80 s; así, milisegundos).
 */
function qrVectorial(doc: PDFKit.PDFDocument, texto: string, x: number, y: number) {
  const { modules } = QRCode.create(texto, { errorCorrectionLevel: 'M' });
  const lado = LADO_QR / modules.size;
  doc.save().fillColor('#000');
  for (let fila = 0; fila < modules.size; fila++) {
    for (let col = 0; col < modules.size; col++) {
      if (modules.get(fila, col)) doc.rect(x + col * lado, y + fila * lado, lado, lado);
    }
  }
  doc.fill().restore();
}

function sinFoto(doc: PDFKit.PDFDocument, x: number, y: number) {
  doc.rect(x, y, FOTO.ancho, FOTO.alto).fill('#f3f4f6');
  doc.font('Helvetica').fontSize(6).fillColor(GRIS).text('Sin foto', x, y + FOTO.alto / 2 - 3, {
    width: FOTO.ancho,
    align: 'center',
  });
}
