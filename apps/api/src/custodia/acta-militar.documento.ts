import { readFileSync } from 'fs';
import { join } from 'path';

import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';

/**
 * Acta de Constancia y Custodia del kit entregado a un militar, en Word, desde
 * la plantilla oficial (docs/Militares/actaentrega). En la copia de assets solo
 * se cambiaron los datos de ejemplo por campos {…}: letra, colores, espacios y
 * tabla quedan idénticos. Nada se guarda: se genera al momento.
 */
const RUTA_PLANTILLA = join(__dirname, '..', 'assets', 'plantilla-acta-custodia-militar.docx');

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
/** Línea para llenar a mano cuando el dato aún no está registrado. */
export const EN_BLANCO = '____________________';

export interface PersonaActa {
  nombre: string;
  cedula: string;
}

export interface DatosActaMilitar {
  fecha: Date;
  responsable: (PersonaActa & { cargo: string }) | null;
  militar: (PersonaActa & { grado: string | null }) | null;
  /** N.º de la mochila (o el código del kit si no tiene número). */
  kitNumero: string;
  /** "1359 – Unidad Educativa … (kit 2)". */
  recintoTexto: string;
  operador: PersonaActa | null;
}

// Caracteres de control: dejan el XML del Word inválido ("archivo dañado").
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Fecha en hora de Ecuador continental (el servidor corre en UTC). */
function partesFecha(d: Date): { diaSemana: string; dia: string; mes: string; anio: string } {
  const ec = new Date(d.getTime() - 5 * 3600_000);
  return {
    diaSemana: DIAS[ec.getUTCDay()],
    dia: String(ec.getUTCDate()),
    mes: MESES[ec.getUTCMonth()],
    anio: String(ec.getUTCFullYear()),
  };
}

/** Campos de la plantilla, con el mismo estilo que el acta de ejemplo. */
export function camposActaMilitar(d: DatosActaMilitar): Record<string, string> {
  const m = d.militar;
  // "CBOP" va en su propio fragmento (resaltado en la plantilla) y el nombre
  // sigue con ". "; sin grado, solo el nombre.
  const grado = m?.grado ?? '';
  const campos: Record<string, string> = {
    ...partesFecha(d.fecha),
    responsableNombre: d.responsable?.nombre ?? EN_BLANCO,
    responsableCedula: d.responsable?.cedula ?? EN_BLANCO,
    responsableCargo: d.responsable?.cargo ?? EN_BLANCO,
    militarGrado: grado,
    militarNombre: m ? `${grado ? '. ' : ''}${m.nombre}` : EN_BLANCO,
    militarFirma: m ? `${grado ? `${grado}. ` : ''}${m.nombre}` : EN_BLANCO,
    militarCedula: m?.cedula ?? EN_BLANCO,
    kitNumero: d.kitNumero,
    recintoTexto: d.recintoTexto,
    operadorNombre: d.operador?.nombre ?? EN_BLANCO,
    operadorCedula: d.operador?.cedula ?? EN_BLANCO,
  };
  return Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, v.replace(CONTROL, '')]));
}

let plantilla: Buffer | null = null;

export function generarWordActaMilitar(d: DatosActaMilitar): Buffer {
  plantilla ??= readFileSync(RUTA_PLANTILLA);
  const doc = new Docxtemplater(new PizZip(plantilla), {
    paragraphLoop: true,
    // Un campo faltante es un error de programación: mejor fallar que imprimir "undefined".
    nullGetter: (parte) => {
      throw new Error(`Falta el campo ${parte.value} del acta militar`);
    },
  });
  doc.render(camposActaMilitar(d));
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Varias actas en un .zip (un Word por kit). */
export function zipActasMilitares(actas: { archivo: string; datos: DatosActaMilitar }[]): Buffer {
  const zip = new PizZip();
  for (const a of actas) zip.file(a.archivo, generarWordActaMilitar(a.datos));
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** Nombre de archivo seguro: "acta_militar_17_1359.docx". */
export function nombreArchivoActaMilitar(kitNumero: string, codigoRecinto: string | null): string {
  const limpio = (s: string) => s.replace(/[^A-Za-z0-9-]/g, '').slice(0, 20);
  return `acta_militar_${limpio(kitNumero) || 'kit'}${codigoRecinto ? `_${limpio(codigoRecinto)}` : ''}.docx`;
}
