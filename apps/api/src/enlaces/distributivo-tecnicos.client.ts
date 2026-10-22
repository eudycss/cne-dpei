import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import {
  ArchivoDriveNoConfigurado,
  descargarExcelDrive,
  LecturaCacheada,
  normalizarEncabezado as normalizar,
  textoCelda as texto,
} from './drive-excel';

/** Un recinto CDA con el técnico que responde por él, como en el distributivo. */
export interface AsignacionTecnico {
  codigoRecinto: string;
  localidad: string;
  /** Parroquia del recinto ('' si el archivo no la trae): agrupa las caídas por sector. */
  parroquia: string;
  /** 1, 2, 3… según el orden en que aparece cada técnico en el archivo. */
  numeroTecnico: number;
  tecnico: string;
}

const VARIABLE = 'DISTRIBUTIVO_TECNICOS_DRIVE_ID';

export class DistributivoNoConfigurado extends ArchivoDriveNoConfigurado {
  constructor() {
    super(VARIABLE);
  }
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
    let idxParroquia = -1;
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
        idxParroquia = valores.indexOf('PARROQUIA');
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
        parroquia: idxParroquia === -1 ? '' : texto(valores[idxParroquia]),
        numeroTecnico: numeroPorTecnico.get(clave)!,
        tecnico,
      });
    });
    return asignaciones;
  }
  throw new Error('El distributivo no tiene una hoja con CODIGO DE RECINTO y TECNICOS RESPONSABLES');
}

/** Técnico(s) de cada recinto, para los avisos: un recinto puede tener más de uno
 * (una fila por cada uno) y van todos, sin repetir ("Ana Pérez, Luis Gómez"). */
export function tecnicosPorRecinto(asignaciones: AsignacionTecnico[]): Map<string, string> {
  const nombres = new Map<string, Set<string>>();
  for (const a of asignaciones) {
    nombres.set(a.codigoRecinto, (nombres.get(a.codigoRecinto) ?? new Set<string>()).add(a.tecnico));
  }
  return new Map<string, string>([...nombres].map(([codigo, set]) => [codigo, [...set].join(', ')]));
}

@Injectable()
export class DistributivoTecnicosClient {
  private readonly lectura = new LecturaCacheada<AsignacionTecnico[]>(new Logger('DistributivoTecnicos'));

  asignaciones(ahora = Date.now()): Promise<AsignacionTecnico[]> {
    return this.lectura.obtener(async () => leerAsignaciones(await this.descargar()), ahora);
  }

  /** Descarga por el enlace público de Drive ("cualquier persona con el enlace"). */
  protected async descargar(): Promise<ExcelJS.Workbook> {
    if (!process.env[VARIABLE]?.trim()) throw new DistributivoNoConfigurado();
    return descargarExcelDrive(VARIABLE);
  }
}
