import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import type { EstadoPrenda } from '@cne/shared-types';

import { nuevoPdf } from '../common/pdf';

/**
 * Acta de entrega de indumentaria y credencial del personal CDA o CPE, en Word
 * (desde la plantilla oficial) y en PDF (mismo texto, dibujado con pdfkit).
 * Nada se guarda: se genera al momento con los datos del acta.
 */

// Copia limpia de la plantilla oficial: los datos de ejemplo se cambiaron por
// campos {…} y se le quitó la combinación de correspondencia (traía el Excel
// de operadores). Quien entrega es siempre ingeniero: "Ing." va fijo en ella.
const RUTA_PLANTILLA = join(__dirname, '..', 'assets', 'plantilla-acta-indumentaria-cda.docx');
const RUTA_LOGO = join(__dirname, '..', 'assets', 'logo-cne.png');
const hayLogo = existsSync(RUTA_LOGO);

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export interface DatosActaCda {
  lugar: string;
  /** AAAA-MM-DD */
  fecha: string;
  entregaNombre: string;
  entregaCedula: string;
  entregaCargo: string;
  operadorNombre: string;
  operadorCedula: string;
  /** el cargo del grupo ("OPERADOR CDA", "SUPERVISOR CPE", …). */
  operadorCargo: string;
  estadoPeto: EstadoPrenda;
  estadoCredencial: EstadoPrenda;
  estadoCordon: EstadoPrenda;
}

// Caracteres de control: dejan el XML del Word inválido ("archivo dañado").
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Campos de la plantilla. Nombres y cargos en mayúsculas, como el acta original. */
export function camposPlantilla(d: DatosActaCda): Record<string, string> {
  const [anio, mes, dia] = d.fecha.split('-').map(Number);
  const campos: Record<string, string> = {
    lugar: d.lugar,
    dia: String(dia),
    mes: MESES[mes - 1],
    anio: String(anio),
    entregaNombre: d.entregaNombre.toUpperCase(),
    entregaCedula: d.entregaCedula,
    entregaCargo: d.entregaCargo.toUpperCase(),
    operadorNombre: d.operadorNombre.toUpperCase(),
    operadorCedula: d.operadorCedula,
    operadorCargo: d.operadorCargo,
    estadoPeto: d.estadoPeto,
    estadoCredencial: d.estadoCredencial,
    estadoCordon: d.estadoCordon,
  };
  // También cubre los datos del operador, que vinieron del Excel.
  return Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, v.replace(CONTROL, '')]));
}

/** Párrafo principal en tres partes: la del medio va en negrita, como en la plantilla. */
function partesTextoActa(d: DatosActaCda): [string, string, string] {
  const c = camposPlantilla(d);
  return [
    `En la ciudad de ${c.lugar} a los ${c.dia} días del mes de ${c.mes} del ${c.anio}, ` +
      `el Ing. ${c.entregaNombre} con C.I. ${c.entregaCedula} ${c.entregaCargo}; realiza la `,
    'Entrega de indumentaria y credencial',
    `; al Sr./Srta. ${c.operadorNombre} con C.I. ${c.operadorCedula} ${c.operadorCargo}`,
  ];
}

/** Párrafo principal del acta (el mismo texto que la plantilla en Word). */
export function textoActaCda(d: DatosActaCda): string {
  return partesTextoActa(d).join('');
}

const CIERRE =
  'Considerando que las partes manifiestan su total conformidad, se ratifica y aceptan todo su contenido, ' +
  'entendiendo su alcance y significado por lo que firman en dos ejemplares.';

let plantilla: Buffer | null = null;

export function generarWordActaCda(d: DatosActaCda): Buffer {
  plantilla ??= readFileSync(RUTA_PLANTILLA);
  const doc = new Docxtemplater(new PizZip(plantilla), {
    paragraphLoop: true,
    // Un campo faltante es un error de programación: mejor fallar que imprimir "undefined".
    nullGetter: (parte) => {
      throw new Error(`Falta el campo ${parte.value} del acta`);
    },
  });
  doc.render(camposPlantilla(d));
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Una página por acta. */
export async function generarPdfActasCda(actas: DatosActaCda[]): Promise<Buffer> {
  const { doc, terminado } = nuevoPdf();
  for (const a of actas) dibujarActa(doc, a);
  doc.end();
  return terminado;
}

// Medidas de la plantilla en Word (A4, márgenes de 3 cm, Times New Roman 12, interlineado 1,5).
const IZQ = 85;
const ANCHO_TEXTO = 595.28 - IZQ * 2;
const ABAJO = 50;
const INTERLINEA = 7;
const AZUL_UNIDAD = '#1f3864';
export const NOMBRE_UNIDAD =
  'Unidad Provincial de Seguridad Informática y Proyectos Tecnológicos Electorales de Imbabura';
const ESPACIO_FIRMA = 70;
// Columna del encabezado: junto al logo (x 40-140) hasta el margen derecho del texto.
const ENCABEZADO_IZQ = 145;
const ENCABEZADO_DER = IZQ + ANCHO_TEXTO;

function dibujarActa(doc: PDFKit.PDFDocument, d: DatosActaCda): void {
  doc.addPage();
  const c = camposPlantilla(d);

  // Encabezado: logo a la izquierda y, centrados en el espacio que queda a su
  // derecha, la Unidad (dos líneas) y el título del acta; abajo, una línea fina.
  if (hayLogo) doc.image(RUTA_LOGO, 40, 26, { fit: [100, 61] });
  const columna = { width: ENCABEZADO_DER - ENCABEZADO_IZQ, align: 'center' as const };
  doc.font('Times-Bold').fontSize(14).fillColor(AZUL_UNIDAD)
    .text(NOMBRE_UNIDAD, ENCABEZADO_IZQ, 28, columna);
  doc.font('Times-Bold').fontSize(11).fillColor('#000')
    .text('ACTA ENTREGA DE INDUMENTARIA Y CREDENCIAL', ENCABEZADO_IZQ, doc.y + 6, columna);
  const yLinea = Math.max(96, doc.y + 8);
  doc.lineWidth(0.8).moveTo(40, yLinea).lineTo(595.28 - 40, yLinea).stroke(AZUL_UNIDAD);

  const [antes, negrita, despues] = partesTextoActa(d);
  const parrafo = { width: ANCHO_TEXTO, align: 'justify' as const, lineGap: INTERLINEA };
  doc.font('Times-Roman').fontSize(12).text(antes, IZQ, 125, { ...parrafo, continued: true });
  doc.font('Times-Bold').text(negrita, { ...parrafo, continued: true });
  doc.font('Times-Roman').text(despues, parrafo);
  doc.moveDown(1);

  // Tabla a todo el ancho: encabezado centrado en negrita, valores a la izquierda.
  const mitad = ANCHO_TEXTO / 2;
  const filas: [string, string, boolean][] = [
    ['Indumentaria', 'Estado', true],
    ['PETO', c.estadoPeto, false],
    ['CREDENCIAL', c.estadoCredencial, false],
    ['CORDON CREDENCIAL', c.estadoCordon, false],
  ];
  const alto = 21;
  for (const [prenda, estado, encabezado] of filas) {
    const y = doc.y;
    doc.lineWidth(0.6).rect(IZQ, y, mitad, alto).rect(IZQ + mitad, y, mitad, alto).stroke('#000');
    doc.font(encabezado ? 'Times-Bold' : 'Times-Roman').fontSize(12).fillColor('#000');
    const opciones = { width: mitad - 8, align: encabezado ? ('center' as const) : ('left' as const) };
    doc.text(prenda, IZQ + 4, y + 5, opciones);
    doc.text(estado, IZQ + mitad + 4, y + 5, opciones);
    doc.y = y + alto;
  }
  doc.moveDown(1.2);
  doc.font('Times-Roman').fontSize(12).text(CIERRE, IZQ, doc.y, parrafo);

  // Recuadro de firmas de dos columnas. Con textos muy largos sube para no partir el acta en dos páginas.
  const firmas: [string, string, string][] = [
    ['Entrega conforme:', `Ing. ${c.entregaNombre}`, c.entregaCargo],
    ['Recibe conforme:', c.operadorNombre, c.operadorCargo],
  ];
  const altoRecuadro = Math.max(...firmas.map(([, nombre, cargo]) => altoFirma(doc, mitad, nombre, cargo)));
  const y0 = Math.min(doc.y + 80, doc.page.height - ABAJO - altoRecuadro);
  firmas.forEach(([rotulo, nombre, cargo], i) => {
    const x = IZQ + i * mitad;
    doc.lineWidth(0.6).rect(x, y0, mitad, altoRecuadro).stroke('#000');
    doc.font('Times-Bold').fontSize(12).text(rotulo, x, y0 + 4, { width: mitad, align: 'center' });
    const yLinea = y0 + 4 + 14 + ESPACIO_FIRMA;
    doc.moveTo(x + 6, yLinea).lineTo(x + mitad - 6, yLinea).stroke('#000');
    doc.font('Times-Roman').fontSize(12).text(nombre, x + 8, yLinea + 3, { width: mitad - 16, align: 'center' });
    doc.font('Times-Bold').fontSize(12).text(cargo, x + 8, doc.y, { width: mitad - 16, align: 'center' });
  });
}

/** Alto (pt) de una columna del recuadro de firmas, con las mismas fuentes con que se dibuja. */
function altoFirma(doc: PDFKit.PDFDocument, ancho: number, nombre: string, cargo: string): number {
  const opciones = { width: ancho - 16, align: 'center' as const };
  const hNombre = doc.font('Times-Roman').fontSize(12).heightOfString(nombre, opciones);
  const hCargo = doc.font('Times-Bold').fontSize(12).heightOfString(cargo, opciones);
  return 4 + 14 + ESPACIO_FIRMA + 3 + hNombre + hCargo + 10;
}

/** "acta-perez-lopez-juan-4512": solo ASCII (cabeceras y ZIP) y sin la cédula completa. */
export function nombreArchivoActa(nombre: string, cedula: string): string {
  const slug = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `acta-${slug || 'operador'}-${cedula.replace(/\D/g, '').slice(-4)}`;
}

/** Homónimos con los mismos 4 últimos dígitos: "-2", "-3"… para que en el ZIP ninguno pise a otro. */
export function nombresUnicos(nombres: string[]): string[] {
  const usados = new Map<string, number>();
  return nombres.map((n) => {
    const veces = (usados.get(n) ?? 0) + 1;
    usados.set(n, veces);
    return veces === 1 ? n : `${n}-${veces}`;
  });
}

/**
 * ZIP con un archivo por entrada (nombre → contenido). Sin comprimir: Word y
 * PDF ya vienen comprimidos y así no se gasta CPU (Render tiene 0.1 vCPU).
 */
export function zipArchivos(archivos: { nombre: string; contenido: Buffer }[]): Buffer {
  const zip = new PizZip();
  for (const a of archivos) zip.file(a.nombre, a.contenido);
  return zip.generate({ type: 'nodebuffer', compression: 'STORE' });
}
