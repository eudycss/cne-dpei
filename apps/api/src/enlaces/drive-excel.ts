import { Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 5 * 1024 * 1024;
/** Los archivos cambian poco: se releen cada 10 min, no en cada uso. */
const CACHE_MS = 10 * 60 * 1000;

/** La variable de entorno con el id del archivo no está definida. */
export class ArchivoDriveNoConfigurado extends Error {
  constructor(variable: string) {
    super(`${variable} no está configurado`);
  }
}

/** Texto de una celda (texto enriquecido, fórmula o valor simple), sin espacios en los bordes. */
export function textoCelda(valor: ExcelJS.CellValue): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'object' && 'richText' in valor) return valor.richText.map((t) => t.text).join('').trim();
  if (typeof valor === 'object' && 'result' in valor) return String(valor.result ?? '').trim();
  return String(valor).trim();
}

/** Para comparar encabezados: sin tildes, en mayúsculas y con espacios simples. */
export function normalizarEncabezado(valor: string): string {
  return valor.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/**
 * Enlaces de descarga, en orden: un .xlsx subido a Drive baja por el primero;
 * una hoja de cálculo de Google (nativa) solo por el segundo, exportada a .xlsx.
 */
const urlsDescarga = (id: string) => [
  `https://drive.google.com/uc?export=download&id=${id}`,
  `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`,
];

/**
 * Descarga un Excel (o una hoja de Google) de Drive por su enlace público
 * ("cualquier persona con el enlace"). `variable` es la variable de entorno con
 * el id, para los mensajes. Si el primer enlace falla, prueba el siguiente.
 */
export async function descargarExcelDrive(variable: string): Promise<ExcelJS.Workbook> {
  const id = process.env[variable]?.trim();
  if (!id) throw new ArchivoDriveNoConfigurado(variable);
  if (!/^[\w-]{10,100}$/.test(id)) throw new Error(`${variable} no es un id de Drive válido`);

  const errores: string[] = [];
  for (const url of urlsDescarga(id)) {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load((await descargar(url, variable)) as unknown as ArrayBuffer);
      return workbook;
    } catch (e) {
      errores.push((e as Error)?.message ?? String(e));
    }
  }
  // Los dos motivos: cuál aplica depende de si es un .xlsx subido o una hoja de Google.
  throw new Error([...new Set(errores)].join(' / '));
}

async function descargar(url: string, variable: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  if (!res.ok) throw new Error(`Drive respondió HTTP ${res.status} al descargar el archivo de ${variable}`);
  // Si Drive anuncia el tamaño, se rechaza antes de cargar el cuerpo en memoria.
  if (Number(res.headers?.get('content-length') ?? 0) > MAX_BYTES) {
    throw new Error(`El archivo de ${variable} pesa más de 5 MB`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > MAX_BYTES) throw new Error(`El archivo de ${variable} pesa más de 5 MB`);
  // Un .xlsx/.xlsm es un ZIP ("PK"); si no, Drive devolvió una página (sin permiso, por ejemplo).
  if (buffer.subarray(0, 2).toString() !== 'PK') {
    throw new Error('Drive no devolvió un Excel: revise que el archivo esté compartido con "cualquier persona con el enlace"');
  }
  return buffer;
}

/**
 * Guarda la última lectura 10 min y, si después falla, devuelve la última
 * copia (mejor eso que nada). Un archivo no configurado siempre se propaga.
 */
export class LecturaCacheada<T> {
  private cache: { leidoEn: number; valor: T } | null = null;

  constructor(private readonly log: Logger) {}

  async obtener(leer: () => Promise<T>, ahora = Date.now()): Promise<T> {
    if (this.cache && ahora - this.cache.leidoEn < CACHE_MS) return this.cache.valor;
    try {
      const valor = await leer();
      this.cache = { leidoEn: ahora, valor };
      return valor;
    } catch (e) {
      if (this.cache && !(e instanceof ArchivoDriveNoConfigurado)) {
        this.log.warn(`No se pudo releer el archivo de Drive, se usa la última copia: ${(e as Error)?.message ?? e}`);
        return this.cache.valor;
      }
      throw e;
    }
  }
}
