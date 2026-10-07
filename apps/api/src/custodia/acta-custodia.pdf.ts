import PDFDocument from 'pdfkit';

/** Todo lo que lleva el acta de un kit (ya resuelto: nombres, fechas, foto). */
export interface DatosActa {
  eventoNombre: string;
  codigoUnico: string;
  recinto: string; // "28 — Escuela Central"
  canton: string;
  articulos: { articulo: string; serie: string | null; estadoSalida: string; estadoRetorno: string | null }[];
  entrega: { militar: Persona; fecha: Date; asistente: Persona } | null;
  /** La foto se pide al dibujar el acta (no se tienen todas en memoria a la vez). */
  recepcion: { fecha: Date; operador: Persona; foto: () => Promise<Buffer | null> } | null;
  devolucion: { fecha: Date; asistente: Persona; observaciones: string | null } | null;
  correcciones: { campo: string; anterior: string; nuevo: string; motivo: string; fecha: Date }[];
  operador: Persona | null;
  militar: Persona | null;
  asistente: Persona | null;
}

export interface Persona {
  nombre: string;
  cedula: string;
}

const MARGEN = 48;
const ANCHO = 595.28 - MARGEN * 2; // A4
const GRIS = '#6b7280';
const LINEA = '#9ca3af';
const ESTADO: Record<string, string> = { BUENO: 'Bueno', REGULAR: 'Regular', MALO: 'Malo' };

function fecha(d: Date): string {
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

/**
 * Acta de entrega y recepción del kit CDA, una página por kit. A diferencia
 * de la plantilla en Word (una tabla de artículos por cada entrega), la tabla
 * del kit va una sola vez, con el estado a la salida y al retorno, seguida de
 * la cadena de custodia completa (3 entregas) y las firmas.
 */
export async function generarActasPdf(actas: DatosActa[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: MARGEN, autoFirstPage: false });
  const chunks: Buffer[] = [];
  const terminado = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  // De a una: cada foto se descarga justo antes de dibujar su acta y se suelta.
  for (const acta of actas) {
    const foto = acta.recepcion ? await acta.recepcion.foto() : null;
    dibujarActa(doc, acta, foto);
  }
  if (actas.length === 0) {
    doc.addPage();
    doc.font('Helvetica').fontSize(12).text('No hay kits para los filtros elegidos.');
  }
  doc.end();
  return terminado;
}

/** Si lo que sigue (alto en pt) no cabe en la página, pasa a una nueva. */
function asegurarEspacio(doc: PDFKit.PDFDocument, alto: number): void {
  if (doc.y + alto > doc.page.height - MARGEN) {
    doc.addPage();
    doc.x = MARGEN;
    doc.y = MARGEN;
  }
}

function dibujarActa(doc: PDFKit.PDFDocument, a: DatosActa, foto: Buffer | null): void {
  doc.addPage();

  doc.font('Helvetica-Bold').fontSize(9).fillColor(GRIS)
    .text('CONSEJO NACIONAL ELECTORAL — DELEGACIÓN PROVINCIAL DE IMBABURA', { align: 'center' });
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#000')
    .text('ACTA DE ENTREGA Y RECEPCIÓN DEL KIT CDA', { align: 'center' });
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(9.5)
    .text(`${a.eventoNombre}  ·  Kit ${a.codigoUnico}  ·  ${a.recinto}  ·  Cantón ${a.canton}`, { align: 'center' });
  doc.moveDown(0.8);

  // 1. Contenido del kit (una sola vez)
  titulo(doc, 'Contenido del kit');
  tabla(
    doc,
    ['Artículo', 'Código / serie', 'Estado al entregar', 'Estado al retornar'],
    [0.34, 0.26, 0.2, 0.2],
    a.articulos.length
      ? a.articulos.map((x) => [
          x.articulo,
          x.serie ?? 'S/N',
          ESTADO[x.estadoSalida] ?? x.estadoSalida,
          x.estadoRetorno ? ESTADO[x.estadoRetorno] ?? x.estadoRetorno : '—',
        ])
      : [['Sin artículos registrados', '', '', '']],
  );

  // 2. Cadena de custodia
  titulo(doc, 'Cadena de custodia');
  const filas = [
    [
      '1. Asistente Electoral Transversal entrega al militar (DPEI)',
      a.entrega ? `${a.entrega.militar.nombre}, C.I. ${a.entrega.militar.cedula}` : 'No registrada',
      a.entrega ? fecha(a.entrega.fecha) : '—',
    ],
    [
      '2. Militar entrega al operador CDA (recinto)',
      a.recepcion ? `${a.recepcion.operador.nombre}, C.I. ${a.recepcion.operador.cedula}` : 'No registrada',
      a.recepcion ? fecha(a.recepcion.fecha) : '—',
    ],
    [
      '3. Operador CDA devuelve al Asistente Electoral Transversal (DPEI)',
      a.devolucion ? `${a.devolucion.asistente.nombre}, C.I. ${a.devolucion.asistente.cedula}` : 'No registrada',
      a.devolucion ? fecha(a.devolucion.fecha) : '—',
    ],
  ];
  const yTabla = doc.y;
  const anchoTabla = foto ? ANCHO - 120 : ANCHO;
  tabla(doc, ['Entrega', 'Recibe', 'Fecha y hora'], [0.48, 0.32, 0.2], filas, anchoTabla);
  if (foto) {
    try {
      doc.image(foto, MARGEN + ANCHO - 110, yTabla, { fit: [110, 110] });
      doc.font('Helvetica').fontSize(7).fillColor(GRIS)
        .text('Militar que entregó el kit al CDA', MARGEN + ANCHO - 110, yTabla + 112, { width: 110, align: 'center' });
      doc.fillColor('#000');
      doc.y = Math.max(doc.y, yTabla + 125);
    } catch {
      // Una foto ilegible no impide emitir el acta.
    }
  }
  doc.x = MARGEN;

  if (a.correcciones.length) {
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(8.5).text('Correcciones registradas:');
    doc.font('Helvetica').fontSize(8);
    for (const c of a.correcciones) {
      doc.text(`• ${fecha(c.fecha)} — ${c.campo}: de ${c.anterior} a ${c.nuevo}. Motivo: ${c.motivo}`, { width: ANCHO });
    }
  }

  if (a.devolucion?.observaciones) {
    doc.moveDown(0.4);
    doc.font('Helvetica-Bold').fontSize(8.5).text('Observaciones al retorno: ', { continued: true })
      .font('Helvetica').text(a.devolucion.observaciones, { width: ANCHO });
  }

  doc.moveDown(0.8);
  doc.font('Helvetica').fontSize(9).text(
    'Considerando que las partes manifiestan su total conformidad, se ratifica y aceptan todo su contenido, ' +
      'entendiendo su alcance y significado, por lo que firman.',
    { width: ANCHO, align: 'justify' },
  );

  // 3. Firmas: al pie de la página o, si el contenido llegó hasta ahí, en una nueva.
  const ALTO_FIRMAS = 50 + 45;
  asegurarEspacio(doc, ALTO_FIRMAS);
  const yFirmas = Math.max(doc.y + 50, Math.min(680, doc.page.height - MARGEN - 45));
  const anchoFirma = ANCHO / 3;
  const firmas: [string, Persona | null][] = [
    ['ASISTENTE ELECTORAL TRANSVERSAL', a.asistente],
    ['MILITAR', a.militar],
    ['OPERADOR CDA', a.operador],
  ];
  firmas.forEach(([cargo, p], i) => {
    const x = MARGEN + i * anchoFirma;
    doc.moveTo(x + 10, yFirmas).lineTo(x + anchoFirma - 10, yFirmas).stroke(LINEA);
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#000')
      .text(p?.nombre ?? '', x, yFirmas + 4, { width: anchoFirma, align: 'center' });
    doc.font('Helvetica').fontSize(8)
      .text(p ? `C.I. ${p.cedula}` : 'C.I.: ______________', x, doc.y, { width: anchoFirma, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GRIS).text(cargo, x, doc.y, { width: anchoFirma, align: 'center' });
    doc.fillColor('#000');
  });
}

function titulo(doc: PDFKit.PDFDocument, texto: string): void {
  doc.x = MARGEN;
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#000').text(texto.toUpperCase());
  doc.moveDown(0.25);
}

function tabla(
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
    asegurarEspacio(doc, alto);
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
