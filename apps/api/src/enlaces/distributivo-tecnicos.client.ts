import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

/** Un recinto CDA con el técnico que responde por él, como en el distributivo. */
export interface AsignacionTecnico {
  codigoRecinto: string;
  localidad: string;
  /** 1, 2, 3… según el orden en que aparece cada técnico en el archivo. */
  numeroTecnico: number;
  tecnico: string;
}

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 5 * 1024 * 1024;
/** El archivo cambia poco: se relee cada 10 min, no en cada toque del botón. */
const CACHE_MS = 10 * 60 * 1000;

export class DistributivoNoConfigurado extends Error {
  constructor() {
    super('DISTRIBUTIVO_TECNICOS_DRIVE_ID no está configurado');
  }
}

function texto(valor: ExcelJS.CellValue): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'object' && 'richText' in valor) return valor.richText.map((t) => t.text).join('').trim();
  if (typeof valor === 'object' && 'result' in valor) return String(valor.result ?? '').trim();
  return String(valor).trim();
}

function normalizar(valor: string): string {
  return valor.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/**
 * Lee las asignaciones del distributivo (Excel en Drive, compartido por enlace):
 * la primera hoja que tenga las columnas CODIGO DE RECINTO y TECNICOS
 * RESPONSABLES. Los nombres no se guardan en el código ni en la base: si
 * editan el archivo, el bot lo refleja en la siguiente lectura.
 */
export function leerAsignaciones(workbook: ExcelJS.Workbook): AsignacionTecnico[] {
  for (const ws of workbook.worksheets) {
    let idxCodigo = -1;
    let idxTecnico = -1;
    let idxLocalidad = -1;
    let filaEncabezado = -1;
    ws.eachRow((row, n) => {
      if (filaEncabezado !== -1) return;
      // Array.from y no .map: row.values tiene huecos (celdas vacías) que .map salta.
      const valores = Array.from(row.values as ExcelJS.CellValue[], (v) => normalizar(texto(v)));
      const codigo = valores.indexOf('CODIGO DE RECINTO');
      const tecnico = valores.findIndex((v) => v.startsWith('TECNICO'));
      if (codigo !== -1 && tecnico !== -1) {
        filaEncabezado = n;
        idxCodigo = codigo;
        idxTecnico = tecnico;
        idxLocalidad = valores.indexOf('LOCALIDAD');
      }
    });
    if (filaEncabezado === -1) continue;

    const numeroPorTecnico = new Map<string, number>();
    const asignaciones: AsignacionTecnico[] = [];
    ws.eachRow((row, n) => {
      if (n <= filaEncabezado) return;
      const valores = row.values as ExcelJS.CellValue[];
      const codigoRecinto = texto(valores[idxCodigo]);
      const tecnico = texto(valores[idxTecnico]).replace(/\s+/g, ' ');
      if (!codigoRecinto || !tecnico) return;
      const clave = normalizar(tecnico);
      if (!numeroPorTecnico.has(clave)) numeroPorTecnico.set(clave, numeroPorTecnico.size + 1);
      asignaciones.push({
        codigoRecinto,
        localidad: idxLocalidad === -1 ? '' : texto(valores[idxLocalidad]),
        numeroTecnico: numeroPorTecnico.get(clave)!,
        tecnico,
      });
    });
    return asignaciones;
  }
  throw new Error('El distributivo no tiene una hoja con CODIGO DE RECINTO y TECNICOS RESPONSABLES');
}

@Injectable()
export class DistributivoTecnicosClient {
  private readonly log = new Logger('DistributivoTecnicos');
  private cache: { leidoEn: number; asignaciones: AsignacionTecnico[] } | null = null;

  async asignaciones(ahora = Date.now()): Promise<AsignacionTecnico[]> {
    if (this.cache && ahora - this.cache.leidoEn < CACHE_MS) return this.cache.asignaciones;
    try {
      const asignaciones = leerAsignaciones(await this.descargar());
      this.cache = { leidoEn: ahora, asignaciones };
      return asignaciones;
    } catch (e) {
      // Si Drive falla, mejor la última versión leída que nada.
      if (this.cache && !(e instanceof DistributivoNoConfigurado)) {
        this.log.warn(`No se pudo releer el distributivo, se usa la última copia: ${(e as Error)?.message ?? e}`);
        return this.cache.asignaciones;
      }
      throw e;
    }
  }

  /** Descarga por el enlace público de Drive ("cualquier persona con el enlace"). */
  protected async descargar(): Promise<ExcelJS.Workbook> {
    const id = process.env.DISTRIBUTIVO_TECNICOS_DRIVE_ID?.trim();
    if (!id) throw new DistributivoNoConfigurado();
    if (!/^[\w-]{10,100}$/.test(id)) throw new Error('DISTRIBUTIVO_TECNICOS_DRIVE_ID no es un id de Drive válido');

    const res = await fetch(`https://drive.google.com/uc?export=download&id=${id}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`Drive respondió HTTP ${res.status} al descargar el distributivo`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_BYTES) throw new Error('El distributivo pesa más de 5 MB');
    // Un .xlsx/.xlsm es un ZIP ("PK"); si no, Drive devolvió una página (sin permiso, por ejemplo).
    if (buffer.subarray(0, 2).toString() !== 'PK') {
      throw new Error('Drive no devolvió un Excel: revise que el archivo esté compartido con "cualquier persona con el enlace"');
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    return workbook;
  }
}
