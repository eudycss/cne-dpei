import {
  ANCHO,
  ANCHO_HORIZONTAL,
  asegurarEspacio,
  encabezado,
  fecha,
  GRIS,
  LINEA,
  MARGEN,
  nuevoPdf,
  tabla,
  titulo,
} from '../common/pdf';

export const TITULO_INFORME = 'Informe del Operador CDA - Elecciones Seccionales y CPCCS 2027';
export const TITULO_REPORTE_GENERAL =
  'Reporte General de Seguimiento de CDAs - Elecciones Seccionales y CPCCS 2027';
export const CARGO_RESPONSABLE =
  'Unidad Provincial de Seguridad Informática y Proyectos Tecnológicos Electorales de Imbabura';

export interface Persona {
  nombre: string;
  cedula: string;
}

/** Datos de la jornada de un operador CDA (lo común al informe y al reporte general). */
export interface JornadaOperador {
  operador: Persona;
  cda: string; // "1961 — UNIDAD EDUCATIVA GARCÍA MORENO"
  canton: string;
  kits: string[];
  salidaDpi: Date | null;
  llegadaRecinto: Date | null;
  pruebaConexion: Date | null;
  salidaRecinto: Date | null;
  llegadaDpi: Date | null;
  /** Registrada por un administrador desde la web (el operador olvidó marcarla). */
  llegadaDpiManual?: boolean;
}

/** Todo lo que lleva el informe de un operador (las fotos se piden al dibujarlo). */
export interface DatosInformeOperador extends JornadaOperador {
  actaInstalacion: () => Promise<Buffer | null>;
  actaEscrutinio: () => Promise<Buffer | null>;
}

const ALTO_FOTO = 250;

/**
 * Informe del Operador CDA: una sección (página nueva) por operador, con sus
 * hitos de la jornada y las firmas del operador y del responsable.
 * `incluirJornada` (día de elecciones) agrega la prueba de conexión y las fotos
 * de los reportes de instalación y escrutinio; en las pruebas técnicas no van
 * y ni siquiera se descifran las fotos.
 */
export async function generarInformesOperadorPdf(
  informes: DatosInformeOperador[],
  responsable: Persona,
  incluirJornada: boolean,
): Promise<Buffer> {
  const { doc, terminado } = nuevoPdf();
  // De a uno: las 2 fotos de cada operador se descargan justo antes de dibujarlo.
  for (const informe of informes) {
    const [instalacion, escrutinio] = incluirJornada
      ? await Promise.all([informe.actaInstalacion(), informe.actaEscrutinio()])
      : [null, null];
    dibujarInforme(doc, informe, responsable, incluirJornada, instalacion, escrutinio);
  }
  if (informes.length === 0) sinOperadores(doc);
  doc.end();
  return terminado;
}

/**
 * Reporte general: una tabla (A4 horizontal) con la jornada de todos los
 * operadores y la firma del responsable. Sin fotos.
 */
export async function generarReporteGeneralPdf(
  filas: JornadaOperador[],
  responsable: Persona,
  incluirJornada: boolean,
): Promise<Buffer> {
  const { doc, terminado } = nuevoPdf('landscape');
  if (filas.length === 0) {
    sinOperadores(doc);
  } else {
    doc.addPage();
    encabezado(doc, ANCHO_HORIZONTAL, TITULO_REPORTE_GENERAL);
    doc.font('Helvetica').fontSize(9.5)
      .text(`${filas.length} operador${filas.length === 1 ? '' : 'es'} CDA`, { width: ANCHO_HORIZONTAL, align: 'center' });
    doc.moveDown(0.6);

    const columnas = ['Operador', 'Cédula', 'CDA', 'Cantón', 'Kit(s)', 'Salida DPI', 'Llegada al recinto'];
    const proporciones = [0.13, 0.08, 0.17, 0.07, 0.07, 0.09, 0.09];
    if (incluirJornada) {
      columnas.push('Prueba de conexión');
      proporciones.push(0.09);
    }
    columnas.push('Salida del recinto', 'Llegada al DPI');
    proporciones.push(0.09, 0.09);
    // Lo que sobra (sin la columna de prueba) se reparte en Operador y CDA.
    const sobra = 1 - proporciones.reduce((a, b) => a + b, 0);
    proporciones[0] += sobra / 2;
    proporciones[2] += sobra / 2;

    tabla(
      doc,
      columnas,
      proporciones,
      filas.map((f) => [
        f.operador.nombre,
        f.operador.cedula,
        f.cda,
        f.canton,
        f.kits.join(', ') || '—',
        hito(f.salidaDpi),
        hito(f.llegadaRecinto),
        ...(incluirJornada ? [hito(f.pruebaConexion)] : []),
        hito(f.salidaRecinto),
        hitoLlegadaDpi(f),
      ]),
      ANCHO_HORIZONTAL,
    );

    // Firma del responsable, centrada al pie.
    asegurarEspacio(doc, 100);
    const anchoFirma = ANCHO_HORIZONTAL / 2;
    firma(doc, responsable, CARGO_RESPONSABLE.toUpperCase(), MARGEN + anchoFirma / 2, doc.y + 50, anchoFirma);
  }
  doc.end();
  return terminado;
}

function hito(d: Date | null): string {
  return d ? fecha(d) : 'Pendiente';
}

function hitoLlegadaDpi(j: { llegadaDpi: Date | null; llegadaDpiManual?: boolean }): string {
  return j.llegadaDpi && j.llegadaDpiManual ? `${hito(j.llegadaDpi)} (registrada por el administrador)` : hito(j.llegadaDpi);
}

function sinOperadores(doc: PDFKit.PDFDocument): void {
  doc.addPage();
  doc.font('Helvetica').fontSize(12).text('No hay operadores CDA para los filtros elegidos.');
}

/** Línea de firma con nombre, cédula y cargo, centrada en `ancho` desde `x`. */
function firma(doc: PDFKit.PDFDocument, p: Persona, cargo: string, x: number, y: number, ancho: number): void {
  doc.moveTo(x + 20, y).lineTo(x + ancho - 20, y).stroke(LINEA);
  doc.font('Helvetica-Bold').fontSize(8).fillColor('#000')
    .text(p.nombre, x + 10, y + 4, { width: ancho - 20, align: 'center' });
  doc.font('Helvetica').fontSize(8).text(`C.I. ${p.cedula}`, x + 10, doc.y, { width: ancho - 20, align: 'center' });
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(GRIS)
    .text(cargo, x + 10, doc.y, { width: ancho - 20, align: 'center' });
  doc.fillColor('#000');
}

function dibujarInforme(
  doc: PDFKit.PDFDocument,
  a: DatosInformeOperador,
  responsable: Persona,
  incluirJornada: boolean,
  instalacion: Buffer | null,
  escrutinio: Buffer | null,
): void {
  doc.addPage();
  encabezado(doc, ANCHO, TITULO_INFORME);
  doc.font('Helvetica-Bold').fontSize(12).text(a.operador.nombre, { width: ANCHO, align: 'center' });
  doc.moveDown(0.2);
  doc.font('Helvetica').fontSize(9.5).text(
    `C.I. ${a.operador.cedula}  ·  CDA ${a.cda}  ·  Cantón ${a.canton}  ·  Kit(s) ${a.kits.join(', ') || '—'}`,
    { width: ANCHO, align: 'center' },
  );
  doc.moveDown(0.8);

  // 1. Jornada: los mismos hitos del reporte de flujo (+ la prueba de conexión el día de elecciones).
  titulo(doc, 'Registro de la jornada');
  const columnas = ['Salida DPI', 'Llegada al recinto'];
  const valores = [hito(a.salidaDpi), hito(a.llegadaRecinto)];
  if (incluirJornada) {
    columnas.push('Prueba de conexión');
    valores.push(a.pruebaConexion ? `Conexión verificada ${fecha(a.pruebaConexion)}` : 'Pendiente');
  }
  columnas.push('Salida del recinto', 'Llegada al DPI');
  valores.push(hito(a.salidaRecinto), hitoLlegadaDpi(a));
  if (incluirJornada) {
    // Día de elecciones: una fila con todos los hitos (como el reporte de flujo).
    tabla(doc, columnas, columnas.map(() => 1 / columnas.length), [valores]);
  } else {
    // Pruebas técnicas: un hito por fila.
    tabla(doc, ['Hito', 'Fecha y hora'], [0.5, 0.5], columnas.map((c, i) => [c, valores[i]]));
  }

  // 2. Fotos de los reportes, lado a lado (solo el día de elecciones).
  if (incluirJornada) {
    titulo(doc, 'Reportes del recinto');
    asegurarEspacio(doc, ALTO_FOTO + 20);
    const yFotos = doc.y;
    const anchoFoto = (ANCHO - 12) / 2;
    dibujarFoto(doc, instalacion, 'Reporte de instalación', MARGEN, yFotos, anchoFoto);
    dibujarFoto(doc, escrutinio, 'Reporte de escrutinio', MARGEN + anchoFoto + 12, yFotos, anchoFoto);
    doc.x = MARGEN;
    doc.y = yFotos + ALTO_FOTO + 20;
  }

  // 3. Firmas: al pie de la página o, si no caben, en una nueva.
  const ALTO_FIRMAS = 50 + 60;
  asegurarEspacio(doc, ALTO_FIRMAS);
  const yFirmas = Math.max(doc.y + 50, Math.min(690, doc.page.height - MARGEN - 60));
  const anchoFirma = ANCHO / 2;
  firma(doc, a.operador, 'OPERADOR CDA', MARGEN, yFirmas, anchoFirma);
  firma(doc, responsable, CARGO_RESPONSABLE.toUpperCase(), MARGEN + anchoFirma, yFirmas, anchoFirma);
}

function dibujarFoto(
  doc: PDFKit.PDFDocument,
  foto: Buffer | null,
  leyenda: string,
  x: number,
  y: number,
  ancho: number,
): void {
  doc.rect(x, y, ancho, ALTO_FOTO).stroke(LINEA);
  let dibujada = false;
  if (foto) {
    try {
      doc.image(foto, x + 4, y + 4, { fit: [ancho - 8, ALTO_FOTO - 8], align: 'center', valign: 'center' });
      dibujada = true;
    } catch {
      // Una foto ilegible no impide emitir el informe.
    }
  }
  if (!dibujada) {
    doc.font('Helvetica').fontSize(9).fillColor(GRIS)
      .text(foto ? 'No se pudo mostrar la foto' : 'No registrado', x, y + ALTO_FOTO / 2 - 5, {
        width: ancho,
        align: 'center',
      });
  }
  doc.font('Helvetica-Bold').fontSize(8).fillColor(GRIS)
    .text(leyenda, x, y + ALTO_FOTO + 4, { width: ancho, align: 'center' });
  doc.fillColor('#000');
}
