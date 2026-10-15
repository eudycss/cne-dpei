import { ANCHO, asegurarEspacio, encabezado, fecha, GRIS, LINEA, MARGEN, nuevoPdf, tabla, titulo } from '../common/pdf';

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

const ESTADO: Record<string, string> = { BUENO: 'Bueno', REGULAR: 'Regular', MALO: 'Malo' };

const BLANCO = '____________________';

/** "16 de noviembre del 2026", hora de Ecuador continental (como la plantilla en Word). */
export function fechaLarga(d: Date): string {
  const [dia, mes, anio] = d
    .toLocaleDateString('es-EC', { timeZone: 'America/Guayaquil', day: 'numeric', month: 'long', year: 'numeric' })
    .split(' de ');
  return `${dia} de ${mes} del ${anio}`;
}

function quien(p: Persona | null): string {
  return p ? `${p.nombre} con C.C. ${p.cedula}` : `${BLANCO} con C.C. ${BLANCO}`;
}

/**
 * Párrafo inicial del acta, al estilo de la plantilla en Word ("En la ciudad
 * de Ibarra al día…"), con la cadena de custodia en una sola narración. Lo que
 * aún no se registró queda en blanco para llenarlo a mano.
 */
export function textoActa(a: DatosActa): string {
  const dia = a.entrega?.fecha ?? a.recepcion?.fecha;
  let texto =
    `En la ciudad de Ibarra, al día ${dia ? fechaLarga(dia) : BLANCO}, el/la Sr./Srta. ${quien(a.entrega?.asistente ?? a.asistente)}, ` +
    `ASISTENTE ELECTORAL TRANSVERSAL, realiza la ENTREGA DEL KIT CDA ${a.codigoUnico} al MILITAR ${quien(a.militar)}, ` +
    `quien lo traslada y entrega al OPERADOR CDA ${quien(a.operador)} en el recinto ${a.recinto}, cantón ${a.canton}.`;
  if (a.devolucion) {
    texto += ' Concluida la jornada, el OPERADOR CDA devuelve el kit al ASISTENTE ELECTORAL TRANSVERSAL en la Delegación.';
  }
  return texto;
}

/**
 * Acta de entrega y recepción del kit CDA, una página por kit. A diferencia
 * de la plantilla en Word (una tabla de artículos por cada entrega), la tabla
 * del kit va una sola vez, con el estado a la salida y al retorno, seguida de
 * la cadena de custodia completa (3 entregas) y las firmas.
 */
export async function generarActasPdf(actas: DatosActa[]): Promise<Buffer> {
  const { doc, terminado } = nuevoPdf();
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

function dibujarActa(doc: PDFKit.PDFDocument, a: DatosActa, foto: Buffer | null): void {
  doc.addPage();

  encabezado(doc, ANCHO, 'ACTA DE ENTREGA Y RECEPCIÓN DEL KIT CDA');
  doc.font('Helvetica').fontSize(9.5)
    .text(`${a.eventoNombre}  ·  Kit ${a.codigoUnico}  ·  ${a.recinto}  ·  Cantón ${a.canton}`, { align: 'center' });
  doc.moveDown(0.8);
  doc.font('Helvetica').fontSize(9.5).text(textoActa(a), { width: ANCHO, align: 'justify' });
  doc.moveDown(0.4);

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
