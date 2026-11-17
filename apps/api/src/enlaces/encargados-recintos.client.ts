import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import {
  CAMPOS_CONTACTOS_CDA,
  claveTelefono,
  type ContactosCda,
  primerTelefono,
  telefonosDeContactos,
  telefonosEnTexto,
  textoContactosBot,
} from '../catalog/contactos-cda';
import { PrismaService } from '../db/prisma.service';
import { descargarExcelDrive, LecturaCacheada, normalizarEncabezado, textoCelda } from './drive-excel';

/** Persona encargada de un recinto CDA, a quien se llama cuando su enlace se cae. */
export interface EncargadoRecinto {
  nombre: string;
  telefono: string;
  /** Hay un teléfono dentro del texto del nombre (rector y conserjes de la base): sí hay a quién llamar. */
  conTelefono?: boolean;
}

const VARIABLE = 'ENCARGADOS_RECINTOS_DRIVE_ID';
const MAX_NOMBRE = 80;
/** Nombres y números juntos en una celda (formulario): caben 2 o 3 contactos. */
const MAX_CONTACTO = 200;
const MAX_TELEFONO = 25;

const esColumnaCodigo = (v: string) =>
  v === 'CODIGO DE RECINTO' || v === 'CODIGO RECINTO' || v === 'CODIGO' || v.startsWith('SELECCIONE EL CDA');
const esColumnaNombre = (v: string) => v.startsWith('ENCARGADO') || v.startsWith('RESPONSABLE') || v === 'NOMBRE';
/** Formulario de Google: "Número de la persona encargada… (nombre, apellido y número)". */
const esColumnaContacto = (v: string) => v.includes('PERSONA ENCARGADA');
const esColumnaTelefono = (v: string) =>
  v.startsWith('TELEFONO') || v.startsWith('CELULAR') || v.startsWith('CONTACTO') || v.startsWith('NUMERO');

/** Solo dígitos, "+", espacios, guiones y paréntesis: el número va a un mensaje con parse_mode HTML. */
function limpiarTelefono(valor: string): string {
  return valor.replace(/[^\d+\s()-]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_TELEFONO);
}

/**
 * "U. E. Ejemplo - 1299" (lista del formulario) → "1299". Exige espacio antes
 * del guion para no partir un código con guion; sin sufijo queda igual.
 */
function codigoDeLista(valor: string): string {
  return valor.match(/\s-\s*(\d+)$/)?.[1] ?? valor;
}

/** Un celular escrito como número en Excel pierde el 0 inicial (0991234567 → 991234567). */
function textoTelefono(valor: ExcelJS.CellValue): string {
  const texto = textoCelda(valor);
  return typeof valor === 'number' && /^9\d{8}$/.test(texto) ? `0${texto}` : texto;
}

/**
 * Encargados por código de recinto, desde el Excel u hoja de Google en Drive.
 * Acepta dos formatos (la primera hoja que tenga uno):
 * - CODIGO DE RECINTO + una columna de nombre (ENCARGADO… / RESPONSABLE… /
 *   NOMBRE) y una de teléfono (TELEFONO… / CELULAR… / CONTACTO… / NUMERO…).
 * - Las respuestas del formulario de instalación: "Seleccione el CDA"
 *   ("Nombre - código") y "…persona encargada…" con nombres y números juntos.
 * Si un recinto aparece varias veces, vale la última fila (la respuesta más
 * reciente). Nombres y teléfonos no se guardan en el código ni en la base.
 */
export function leerEncargados(workbook: ExcelJS.Workbook): Map<string, EncargadoRecinto> {
  for (const ws of workbook.worksheets) {
    const columnas = buscarColumnas(ws);
    if (!columnas) continue;

    const encargados = new Map<string, EncargadoRecinto>();
    ws.eachRow((row, n) => {
      if (n <= columnas.filaEncabezado) return;
      const valores = row.values as ExcelJS.CellValue[];
      const codigoCelda = textoCelda(valores[columnas.codigo]);
      const codigoRecinto = columnas.codigoEnLista ? codigoDeLista(codigoCelda) : codigoCelda;
      const encargado =
        columnas.contacto !== -1
          ? { nombre: unaLinea(textoCelda(valores[columnas.contacto])).slice(0, MAX_CONTACTO), telefono: '' }
          : {
              nombre: unaLinea(textoCelda(valores[columnas.nombre])).slice(0, MAX_NOMBRE),
              telefono: limpiarTelefono(textoTelefono(valores[columnas.telefono])),
            };
      if (!codigoRecinto || (!encargado.nombre && !encargado.telefono)) return;
      encargados.set(codigoRecinto, encargado);
    });
    return encargados;
  }
  throw new Error(
    'El archivo de encargados no tiene una hoja con CODIGO DE RECINTO, ENCARGADO y TELEFONO ' +
      '(o las respuestas del formulario con "Seleccione el CDA" y la persona encargada)',
  );
}

interface Columnas {
  filaEncabezado: number;
  codigo: number;
  /** El código viene al final del nombre ("Seleccione el CDA" del formulario). */
  codigoEnLista: boolean;
  nombre: number;
  telefono: number;
  /** Nombres y números juntos (formulario); -1 si van en columnas separadas. */
  contacto: number;
}

function buscarColumnas(ws: ExcelJS.Worksheet): Columnas | null {
  let columnas: Columnas | null = null;
  ws.eachRow((row, n) => {
    if (columnas) return;
    // Array.from y no .map: row.values tiene huecos (celdas vacías) que .map salta.
    const valores = Array.from(row.values as ExcelJS.CellValue[], (v) => normalizarEncabezado(textoCelda(v)));
    const codigo = valores.findIndex(esColumnaCodigo);
    if (codigo === -1) return;
    const contacto = valores.findIndex(esColumnaContacto);
    const nombre = valores.findIndex(esColumnaNombre);
    const telefono = valores.findIndex(esColumnaTelefono);
    if (contacto !== -1 || (nombre !== -1 && telefono !== -1)) {
      const codigoEnLista = valores[codigo].startsWith('SELECCIONE EL CDA');
      columnas = { filaEncabezado: n, codigo, codigoEnLista, nombre, telefono, contacto };
    }
  });
  return columnas;
}

/**
 * Saltos de línea y espacios repetidos a un solo espacio; sin caracteres de
 * control ni invisibles (ancho cero, dirección de texto) que disfracen el aviso.
 */
function unaLinea(valor: string): string {
  // eslint-disable-next-line no-control-regex
  return valor.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩﻿]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Un CDA con los contactos de su rector y conserjes guardados en la base. */
export type ContactosDeRecinto = ContactosCda & { codigoRecinto: string };

/**
 * El encargado del Drive sin quien ya figura en la base (mismo número): en el formato de
 * columnas se descarta entero; en el del formulario ("Rector Ana 099…, inspector Luis 098…")
 * se quita cada persona cuyo número ya salió. null si no queda nadie nuevo.
 */
function encargadoSinRepetir(encargado: EncargadoRecinto, vistos: Set<string>): EncargadoRecinto | null {
  const clave = claveTelefono(encargado.telefono);
  if (clave) return vistos.has(clave) ? null : encargado;
  const nuevos = encargado.nombre.split(/\s*[,;]\s*/).filter((parte) => {
    const telefonos = telefonosEnTexto(parte);
    return parte && !(telefonos.length > 0 && telefonos.every((t) => vistos.has(t)));
  });
  return nuevos.length > 0 ? { ...encargado, nombre: nuevos.join(', ') } : null;
}

/**
 * Suma el rector y los conserjes (base de datos) a los encargados del Drive:
 * "Rector: Nombre, teléfono 099… · Conserje: …", y el encargado del formulario
 * va detrás ("· Encargado: …") solo con quien no repita un número de la base.
 * Un CDA solo con contactos de la base también aparece.
 */
export function combinarContactos(
  drive: Map<string, EncargadoRecinto>,
  contactos: ContactosDeRecinto[],
): Map<string, EncargadoRecinto> {
  const mapa = new Map(drive);
  for (const c of contactos) {
    const texto = textoContactosBot(c);
    if (!texto) continue;
    const previo = drive.get(c.codigoRecinto);
    const extra = previo ? encargadoSinRepetir(previo, telefonosDeContactos(c)) : null;
    mapa.set(c.codigoRecinto, {
      nombre: extra?.nombre ? `${texto} · Encargado: ${extra.nombre}` : texto,
      telefono: extra?.telefono ?? '',
      conTelefono: !!(extra?.telefono?.trim() || primerTelefono(c)),
    });
  }
  return mapa;
}

@Injectable()
export class EncargadosRecintosClient {
  private readonly log = new Logger('EncargadosRecintos');
  private readonly lectura = new LecturaCacheada<Map<string, EncargadoRecinto>>(this.log);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Encargados del Drive más rector y conserjes de la base. Si el Drive falla pero
   * hay contactos en la base, se responde solo con ellos; sin ninguno, el fallo sigue igual.
   */
  async encargados(ahora = Date.now()): Promise<Map<string, EncargadoRecinto>> {
    const contactos = await this.contactosDeLaBase();
    try {
      const drive = await this.lectura.obtener(async () => leerEncargados(await descargarExcelDrive(VARIABLE)), ahora);
      return combinarContactos(drive, contactos);
    } catch (e) {
      if (contactos.length === 0) throw e;
      this.log.warn(`Sin el archivo de encargados de Drive, solo rector y conserjes de la base: ${(e as Error)?.message ?? e}`);
      return combinarContactos(new Map(), contactos);
    }
  }

  private async contactosDeLaBase(): Promise<ContactosDeRecinto[]> {
    return this.prisma.recinto.findMany({
      // Sin filtrar por campo: combinarContactos descarta a quien no tenga ningún dato.
      where: { tipo: 'CDA', activo: true },
      select: { codigoRecinto: true, ...CAMPOS_CONTACTOS_CDA },
    });
  }
}
