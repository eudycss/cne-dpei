import { readFileSync } from 'fs';
import { join } from 'path';

import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';

/**
 * Informe de presentación de productos del personal CDA/CPE, en Word.
 *
 * Las plantillas (assets/informes-productos) son los informes oficiales de
 * cada cargo (docs/OperadosCDAs/InformesCDACPE) con el FORMATO ANEXOS agregado
 * al final como otra sección. Solo se agregó el campo {apellidosNombres} y un
 * marcador donde van las 6 fotos: el resto del Word queda igual.
 */
const CARPETA = join(__dirname, '..', 'assets', 'informes-productos');

/** Un informe por cargo (clave de cargos_cda). */
export const CARGOS_CON_INFORME = [
  'OPERADOR',
  'ASISTENTE',
  'OPERADOR_ESCANER_CPE',
  'DIGITADOR',
  'DIGITADOR_ELECCION',
  'ESCANEADORES',
  'ASISTENTE_FIRMAS',
  'RECEPTOR_ACTAS',
  'SUPERVISOR',
  'ASISTENTE_ARCHIVOS',
] as const;

export const FOTOS_POR_INFORME = 6;
/** Párrafo exacto que dejó la preparación de las plantillas donde van las fotos. */
const PARRAFO_MARCADOR = '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>FOTOS_ANEXO_CNE</w:t></w:r></w:p>';

export function tieneInforme(grupo: string): boolean {
  return (CARGOS_CON_INFORME as readonly string[]).includes(grupo);
}

export interface FotoAnexo {
  posicion: number;
  jpeg: Buffer;
  ancho: number;
  alto: number;
}

// Caracteres de control: dejan el XML del Word inválido ("archivo dañado").
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

// Todas las fotos miden lo mismo: 3,35 × 2,4 pulgadas, 3 filas × 2 columnas en
// una hoja A4 con los márgenes del formato de anexos (1,27 cm), junto al título.
const EMU_POR_PULGADA = 914400;
export const CAJA = { cx: Math.round(3.35 * EMU_POR_PULGADA), cy: Math.round(2.4 * EMU_POR_PULGADA) };

/** Recorte (en milésimas de %) para que la foto llene la caja sin deformarse: se corta al centro lo que sobra. */
export function recorteEnCaja(ancho: number, alto: number): { l: number; t: number; r: number; b: number } {
  // Medidas inválidas: sin recorte (nunca "NaN" en el XML, que dañaría el Word).
  if (!(ancho > 0 && alto > 0)) return { l: 0, t: 0, r: 0, b: 0 };
  const proporcionCaja = CAJA.cx / CAJA.cy;
  const proporcionFoto = ancho / alto;
  if (proporcionFoto > proporcionCaja) {
    const lado = Math.round(((1 - proporcionCaja / proporcionFoto) / 2) * 100000);
    return { l: lado, t: 0, r: lado, b: 0 };
  }
  const lado = Math.round(((1 - proporcionFoto / proporcionCaja) / 2) * 100000);
  return { l: 0, t: lado, r: 0, b: lado };
}

function dibujo(rId: string, id: number, ancho: number, alto: number): string {
  const { cx, cy } = CAJA;
  const { l, t, r, b } = recorteEnCaja(ancho, alto);
  return (
    `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Foto ${id}"/>` +
    `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
    `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:nvPicPr><pic:cNvPr id="${id}" name="foto${id}.jpg"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:srcRect l="${l}" t="${t}" r="${r}" b="${b}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing>`
  );
}

/** Alto fijo de cada fila (twips): la foto + su margen + holgura de redondeo; así una foto que falta no descuadra la hoja. */
const ALTO_FILA = Math.round((CAJA.cy / EMU_POR_PULGADA) * 1440) + 160;

/** Tabla 3 × 2 sin bordes; una celda vacía si falta la foto de esa posición. */
function tablaFotos(celdas: (string | null)[]): string {
  const celda = (contenido: string | null) =>
    `<w:tc><w:tcPr><w:tcW w:w="5230" w:type="dxa"/><w:vAlign w:val="center"/></w:tcPr>` +
    `<w:p><w:pPr><w:spacing w:before="60" w:after="60" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/></w:pPr>` +
    `${contenido ? `<w:r>${contenido}</w:r>` : ''}</w:p></w:tc>`;
  const filas: string[] = [];
  for (let f = 0; f < 3; f++) {
    filas.push(`<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${ALTO_FILA}" w:hRule="exact"/></w:trPr>${celda(celdas[f * 2])}${celda(celdas[f * 2 + 1])}</w:tr>`);
  }
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="10460" w:type="dxa"/><w:jc w:val="center"/>` +
    `<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/>` +
    `<w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="5230"/><w:gridCol w:w="5230"/></w:tblGrid>${filas.join('')}</w:tbl>`
  );
}

const plantillas = new Map<string, Buffer>();

function plantilla(grupo: string): Buffer {
  if (!tieneInforme(grupo)) throw new Error(`No hay informe para el cargo ${grupo}`);
  let p = plantillas.get(grupo);
  if (!p) {
    p = readFileSync(join(CARPETA, `informe-productos-${grupo}.docx`));
    plantillas.set(grupo, p);
  }
  return p;
}

/** Informe del cargo con el nombre y el anexo de fotos (posiciones 1 a 6). */
export function generarWordInformeProductos(grupo: string, apellidosNombres: string, fotos: FotoAnexo[]): Buffer {
  const doc = new Docxtemplater(new PizZip(plantilla(grupo)), {
    paragraphLoop: true,
    nullGetter: (parte) => {
      throw new Error(`Falta el campo ${parte.value} del informe`);
    },
  });
  doc.render({ apellidosNombres: apellidosNombres.replace(CONTROL, '').trim().toUpperCase() });
  const zip = doc.getZip();

  let rels = zip.file('word/_rels/document.xml.rels')!.asText();
  const usados = [...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  let siguiente = Math.max(0, ...usados) + 1;
  const celdas: (string | null)[] = Array(FOTOS_POR_INFORME).fill(null);
  for (const f of fotos) {
    if (f.posicion < 1 || f.posicion > FOTOS_POR_INFORME) continue;
    const rId = `rId${siguiente++}`;
    const archivo = `informe_foto_${f.posicion}.jpg`;
    zip.file(`word/media/${archivo}`, f.jpeg);
    rels = rels.replace(
      '</Relationships>',
      `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${archivo}"/></Relationships>`,
    );
    celdas[f.posicion - 1] = dibujo(rId, 9000 + f.posicion, f.ancho, f.alto);
  }
  zip.file('word/_rels/document.xml.rels', rels);

  const xml = zip.file('word/document.xml')!.asText();
  if (!xml.includes(PARRAFO_MARCADOR)) throw new Error('La plantilla no tiene el lugar de las fotos');
  zip.file('word/document.xml', xml.replace(PARRAFO_MARCADOR, tablaFotos(celdas)));
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** "informe_productos_1050123412.docx" (solo dígitos de la cédula). */
export function nombreArchivoInforme(cedula: string): string {
  return `informe_productos_${cedula.replace(/\D/g, '').slice(0, 10)}.docx`;
}
