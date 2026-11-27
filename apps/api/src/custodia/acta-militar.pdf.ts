import { readFileSync } from 'fs';

import PDFDocument from 'pdfkit';
import PizZip from 'pizzip';

import { type DatosActaMilitar, RUTA_PLANTILLA, camposActaMilitar } from './acta-militar.documento';

/**
 * Acta de Constancia y Custodia del militar en PDF, redibujada a partir de la
 * plantilla oficial en Word (docs/Militares/actaentrega): mismo texto, letra
 * Times, logo del CNE, tabla del kit y firmas. Una página por kit; varias
 * actas salen en un solo PDF listo para imprimir. Los campos son los mismos
 * del Word (camposActaMilitar), así los dos formatos dicen lo mismo.
 */

// Medidas de la plantilla (A4; 1 pt = 20 twips).
const ANCHO_PAGINA = 595.28;
const IZQ = 85; // 1701 twips
const ARRIBA = 71; // 1417 twips
const ANCHO = ANCHO_PAGINA - IZQ * 2;
const AZUL = '#1F4E79';
const NORMAL = 'Times-Roman';
const NEGRITA = 'Times-Bold';
const INTERLINEADO = 1.5; // w:line 259 ≈ 1,08 líneas en Word

type Segmento = { t: string; b?: boolean };
/** Imagen ya abierta por pdfkit (doc.image la acepta igual que un Buffer o una ruta). */
type ImagenPdf = { readonly width: number; readonly height: number };

let logo: Buffer | null | undefined;

/** El logo del CNE es el del encabezado de la plantilla: se lee de ella una sola vez. */
function logoCne(): Buffer | null {
  if (logo !== undefined) return logo;
  try {
    const zip = new PizZip(readFileSync(RUTA_PLANTILLA));
    logo = zip.file('word/media/image1.jpg')?.asNodeBuffer() ?? null;
  } catch {
    logo = null; // Sin logo el acta sale igual.
  }
  return logo;
}

export async function generarPdfActasMilitares(actas: DatosActaMilitar[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margins: { top: ARRIBA, bottom: ARRIBA, left: IZQ, right: IZQ }, autoFirstPage: false });
  const chunks: Buffer[] = [];
  const terminado = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const imagen = logoCne();
  // openImage existe en pdfkit pero no en sus tipos: abre el logo una vez y se reutiliza en cada página.
  const logoPdf = imagen ? (doc as unknown as { openImage(src: Buffer): ImagenPdf }).openImage(imagen) : null;
  for (const a of actas) {
    dibujarActa(doc, a, logoPdf);
    // Cede el event loop entre acta y acta (Render: 0.1 vCPU).
    await new Promise<void>((r) => setImmediate(r));
  }
  if (actas.length === 0) {
    doc.addPage();
    doc.font(NORMAL).fontSize(12).text('No hay kits para los filtros elegidos.');
  }
  doc.end();
  return terminado;
}

/** Párrafo con partes en negrita (como los fragmentos del Word). */
function parrafo(
  doc: PDFKit.PDFDocument,
  segmentos: Segmento[],
  { x = IZQ, y, width = ANCHO, size = 11, align = 'justify' as const }: { x?: number; y?: number; width?: number; size?: number; align?: 'left' | 'center' | 'right' | 'justify' } = {},
): void {
  const partes = segmentos.filter((s) => s.t !== '');
  partes.forEach((s, i) => {
    doc.font(s.b ? NEGRITA : NORMAL).fontSize(size);
    const opciones = { width, align, lineGap: INTERLINEADO, continued: i < partes.length - 1 };
    if (i === 0) doc.text(s.t, x, y ?? doc.y, opciones);
    else doc.text(s.t, opciones);
  });
}

function altoTexto(doc: PDFKit.PDFDocument, texto: string, ancho: number, negrita = false, size = 11): number {
  return doc.font(negrita ? NEGRITA : NORMAL).fontSize(size).heightOfString(texto, { width: ancho, lineGap: INTERLINEADO });
}

function dibujarActa(doc: PDFKit.PDFDocument, d: DatosActaMilitar, logoPdf: ImagenPdf | null): void {
  doc.addPage();
  const c = camposActaMilitar(d);
  if (logoPdf) doc.image(logoPdf as unknown as Buffer, IZQ, 30, { fit: [73, 51] });
  doc.y = ARRIBA + 20;

  parrafo(doc, [{ t: 'ACTA DE CONSTANCIA Y CUSTODIA', b: true }], { size: 16, align: 'center' });
  doc.moveDown(0.6);
  parrafo(doc, [{ t: `Ibarra ${c.dia} ${c.mes} ${c.anio}`, b: true }], { size: 12, align: 'right' });
  doc.moveDown(0.6);

  parrafo(doc, [
    {
      t:
        'En la ciudad de Ibarra, en las instalaciones de la Delegación Provincial Electoral de Imbabura, siendo el ' +
        `día ${c.diaSemana} ${c.dia} de ${c.mes} de ${c.anio}, el `,
    },
    { t: `Ing. ${c.responsableNombre}`, b: true },
    { t: `, portador de la cédula de ciudadanía Nro. ${c.responsableCedula}, en calidad de ${c.responsableCargo}, realiza la entrega y deja en custodia al ` },
    { t: `${c.militarGrado}${c.militarNombre}`, b: true },
    { t: `, portador de la cédula de ciudadanía Nro. ${c.militarCedula}, ` },
    { t: `un (1) kit técnico electoral (Kit Nro. ${c.kitNumero})`, b: true },
    { t: ', correspondiente al proceso de ' },
    { t: 'Elecciones Seccionales y CPCCS 2027', b: true },
    { t: ', de acuerdo con el detalle y especificaciones consignados a continuación:' },
  ]);
  doc.moveDown(0.8);

  tablaKit(doc, c);
  doc.moveDown(1.2);

  parrafo(
    doc,
    [
      { t: 'Nota: ', b: true },
      {
        t:
          'Se deja constancia de que el miembro de las Fuerzas Armadas (custodio) cesa en su calidad de custodio del kit ' +
          'técnico electoral una vez efectuada su entrega formal al Operador CDA ',
      },
      { t: c.operadorNombre, b: true },
      { t: `, portador de la cédula de ciudadanía Nro. ${c.operadorCedula}, quien asume la responsabilidad correspondiente y será la última persona en suscribir la presente acta.` },
    ],
    { size: 12 },
  );
  doc.moveDown(1.5);

  firmas(doc, c);
}

/** Tabla "CONTENIDO DEL KIT ELECTORAL" con las celdas combinadas de la plantilla. */
function tablaKit(doc: PDFKit.PDFDocument, c: Record<string, string>): void {
  const total = 1691 + 2410 + 1559 + 2694;
  const anchos = [1691, 2410, 1559, 2694].map((w) => (w / total) * ANCHO);
  const xs = anchos.reduce<number[]>((acc, w, i) => [...acc, i === 0 ? IZQ : acc[i - 1] + anchos[i - 1]], []);
  const pad = 4;
  let y = doc.y;
  doc.lineWidth(0.6).strokeColor('#000');

  const celda = (x: number, yy: number, w: number, h: number, fondo?: string) => {
    if (fondo) doc.rect(x, yy, w, h).fillAndStroke(fondo, '#000');
    else doc.rect(x, yy, w, h).stroke();
    doc.fillColor('#000');
  };
  const texto = (t: string, x: number, yy: number, w: number, h: number, { b = false, blanco = false } = {}) => {
    const alto = altoTexto(doc, t, w - pad * 2, b);
    doc.font(b ? NEGRITA : NORMAL).fontSize(11).fillColor(blanco ? '#FFFFFF' : '#000')
      .text(t, x + pad, yy + Math.max(pad / 2, (h - alto) / 2), { width: w - pad * 2, align: 'center', lineGap: INTERLINEADO });
    doc.fillColor('#000');
  };

  // Encabezados en azul con letra blanca.
  const titulo = 'CONTENIDO DEL KIT ELECTORAL PROCESO: ELECCIONES SECCIONALES Y CPCCS 2027';
  const h0 = Math.max(20, altoTexto(doc, titulo, ANCHO - pad * 2, true) + pad * 2);
  celda(IZQ, y, ANCHO, h0, AZUL);
  texto(titulo, IZQ, y, ANCHO, h0, { b: true, blanco: true });
  y += h0;
  const h1 = 18;
  ['CONTENIDO', 'DETALLE', 'CANTIDAD', 'KIT - RECINTO'].forEach((t, i) => {
    celda(xs[i], y, anchos[i], h1, AZUL);
    texto(t, xs[i], y, anchos[i], h1, { b: true, blanco: true });
  });
  y += h1;

  const filas: [grupo: string | null, detalle: string][] = [
    ['ESCÁNER', 'Marca XEROX'],
    [null, 'Cable de poder'],
    [null, 'Cable de datos'],
    ['LAPTOP', 'Marca HP'],
    [null, 'Cable de poder'],
    [null, 'Mochila Quasad Negra'],
  ];
  // La celda "KIT - RECINTO" ocupa las 6 filas: si su texto no cabe, las filas crecen.
  const kitTexto = `NUMERO DE KIT (S): ${c.kitNumero}\n\nRecinto: ${c.recintoTexto}`;
  const altoKit = altoTexto(doc, kitTexto, anchos[3] - pad * 2) + pad * 2;
  const hFila = Math.max(17, altoKit / filas.length);
  const inicio = y;

  filas.forEach(([, detalle], i) => {
    const yy = inicio + i * hFila;
    celda(xs[1], yy, anchos[1], hFila);
    texto(detalle, xs[1], yy, anchos[1], hFila);
    celda(xs[2], yy, anchos[2], hFila);
    texto('1', xs[2], yy, anchos[2], hFila);
  });
  // Grupos combinados: ESCÁNER (3 filas) y LAPTOP (3 filas).
  for (const [fila, nombre] of [[0, 'ESCÁNER'], [3, 'LAPTOP']] as const) {
    const yy = inicio + fila * hFila;
    celda(xs[0], yy, anchos[0], hFila * 3);
    texto(nombre, xs[0], yy, anchos[0], hFila * 3, { b: true });
  }
  const altoTotal = hFila * filas.length;
  celda(xs[3], inicio, anchos[3], altoTotal);
  const yKit = inicio + Math.max(pad / 2, (altoTotal - altoKit) / 2) + pad;
  // "NUMERO DE KIT (S): " normal y el número en negrita, centrados a mano
  // (pdfkit descuadra el centrado de un texto "continued").
  const etiqueta = 'NUMERO DE KIT (S): ';
  const anchoEtiqueta = doc.font(NORMAL).fontSize(11).widthOfString(etiqueta);
  const anchoNumero = doc.font(NEGRITA).fontSize(11).widthOfString(c.kitNumero);
  const xKit = xs[3] + Math.max(pad, (anchos[3] - anchoEtiqueta - anchoNumero) / 2);
  doc.font(NORMAL).text(etiqueta, xKit, yKit, { lineBreak: false });
  doc.font(NEGRITA).text(c.kitNumero, xKit + anchoEtiqueta, yKit, { lineBreak: false });
  doc.font(NORMAL).fontSize(11).text(`Recinto: ${c.recintoTexto}`, xs[3] + pad, yKit + 2 * (11 + INTERLINEADO + 2), {
    width: anchos[3] - pad * 2,
    align: 'center',
    lineGap: INTERLINEADO,
  });

  doc.x = IZQ;
  doc.y = inicio + altoTotal;
}

/** Firmas sin bordes: cargo, nombre y cédula; debajo el espacio para firmar. */
function firmas(doc: PDFKit.PDFDocument, c: Record<string, string>): void {
  const total = 2687 + 2693 + 3114;
  const anchos = [2687, 2693, 3114].map((w) => (w / total) * ANCHO);
  const xs = [IZQ, IZQ + anchos[0], IZQ + anchos[0] + anchos[1]];
  const columnas: { cargo: string; nombre: string; cedula: string; negrita: boolean }[] = [
    { cargo: 'Responsable TICs', nombre: `Ing. ${c.responsableNombre}`, cedula: c.responsableCedula, negrita: false },
    { cargo: 'Militar Custodio', nombre: c.militarFirma, cedula: c.militarCedula, negrita: true },
    { cargo: 'Custodio final-Operador CDA', nombre: c.operadorNombre, cedula: c.operadorCedula, negrita: true },
  ];
  const y = doc.y;
  let fin = y;
  columnas.forEach((col, i) => {
    const w = anchos[i] - 6;
    doc.font(NORMAL).fontSize(11).text(col.cargo, xs[i] + 3, y, { width: w, align: 'center', lineGap: INTERLINEADO });
    const yNombre = y + 22;
    doc.font(col.negrita ? NEGRITA : NORMAL).fontSize(11).text(col.nombre, xs[i] + 3, yNombre, { width: w, align: 'center', lineGap: INTERLINEADO });
    doc.font(NORMAL).fontSize(11).text(col.cedula, { width: w, align: 'center', lineGap: INTERLINEADO });
    fin = Math.max(fin, doc.y);
  });
  doc.x = IZQ;
  doc.y = fin + 74; // fila en blanco de la plantilla (1478 twips) para firmar
}
