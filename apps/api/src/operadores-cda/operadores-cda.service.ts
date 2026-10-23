import { BadRequestException, Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { operadorCdaFilaSchema } from '@cne/shared-validation';
import type {
  BulkUploadRow,
  ImportOperadoresCdaResult,
  OperadorCda,
  OperadorCdaFila,
} from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { leerFilasOperadoresCda, type FilaLeida } from './excel-operadores-cda';
import { tamanoDescomprimidoZip } from './zip';

// Un .xlsx es un ZIP: empieza con "PK\x03\x04".
const FIRMA_ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
// Límites contra archivos maliciosos o equivocados (el real: ~190 KB, 65 filas,
// ~1 MB descomprimido). Render tiene 512 MB de RAM y 0.1 vCPU.
const MAX_DESCOMPRIMIDO = 30 * 1024 * 1024;
const MAX_FILAS_HOJA = 2000;
const MAX_OPERADORES = 500;
const MAX_ERRORES = 100;
const MAX_TEXTO_ERROR = 200;

@Injectable()
export class OperadoresCdaService {
  constructor(private readonly prisma: PrismaService) {}

  async list(opts: { search?: string } = {}): Promise<OperadorCda[]> {
    const search = opts.search?.trim();
    const items = await this.prisma.operadorCda.findMany({
      where: {
        activo: true,
        ...(search && {
          OR: [
            { apellidosNombres: { contains: search, mode: 'insensitive' as const } },
            { cedula: { contains: search } },
          ],
        }),
      },
      orderBy: { apellidosNombres: 'asc' },
    });
    return items.map(toOperadorCdaDto);
  }

  /**
   * Importa el Excel de operadores. Con `aplicar=false` solo devuelve la vista
   * previa; con `aplicar=true` guarda todo o nada (si hay errores no guarda).
   * La cédula identifica al operador: si ya existe se actualizan sus datos.
   */
  async importar(
    file: Express.Multer.File | undefined,
    { aplicar }: { aplicar: boolean },
  ): Promise<ImportOperadoresCdaResult> {
    const leidas = await this.leerExcel(file);
    const { filas, errores } = validarFilas(leidas);

    const existentes = await this.prisma.operadorCda.findMany({
      where: { cedula: { in: filas.map((f) => f.cedula) } },
      select: { cedula: true },
    });
    const yaRegistradas = new Set(existentes.map((e) => e.cedula));
    const conAccion: OperadorCdaFila[] = filas.map((f) => ({
      ...f,
      accion: yaRegistradas.has(f.cedula) ? 'ACTUALIZAR' : 'NUEVO',
    }));
    const resultado: ImportOperadoresCdaResult = {
      vistaPrevia: !aplicar,
      nuevos: conAccion.filter((f) => f.accion === 'NUEVO').length,
      actualizados: conAccion.filter((f) => f.accion === 'ACTUALIZAR').length,
      filas: conAccion,
      errores: acotarErrores(errores),
    };
    if (!aplicar) return resultado;

    if (errores.length > 0) {
      throw new BadRequestException(
        `El archivo tiene ${errores.length} fila(s) con errores. Corríjalas y vuelva a cargarlo.`,
      );
    }
    await this.prisma.$transaction(
      conAccion.map(({ fila: _fila, accion: _accion, ...f }) => {
        // Una celda vacía no borra lo que ya estaba (p. ej. un teléfono corregido
        // a mano) y reimportar no cambia `activo` (no reactiva a quien se dio de baja).
        const datos = {
          numero: f.numero,
          apellidosNombres: f.apellidosNombres,
          telefono: f.telefono,
          cargo: f.cargo,
          unidad: f.unidad,
          fechaInicio: f.fechaInicio ? new Date(`${f.fechaInicio}T00:00:00Z`) : undefined,
        };
        return this.prisma.operadorCda.upsert({
          where: { cedula: f.cedula },
          create: { cedula: f.cedula, ...datos },
          update: datos,
        });
      }),
    );
    return resultado;
  }

  private async leerExcel(file: Express.Multer.File | undefined): Promise<FilaLeida[]> {
    if (!file) throw new BadRequestException('Archivo requerido');
    const esXlsx = (file.originalname ?? '').toLowerCase().endsWith('.xlsx');
    if (!esXlsx || !file.buffer?.subarray(0, 4).equals(FIRMA_ZIP)) {
      throw new BadRequestException('Formato no soportado: suba el Excel (.xlsx) de operadores');
    }
    const descomprimido = tamanoDescomprimidoZip(file.buffer);
    if (descomprimido === null || descomprimido > MAX_DESCOMPRIMIDO) {
      throw new BadRequestException('El Excel es demasiado grande o está dañado. Suba solo la hoja de operadores');
    }
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(file.buffer as any);
    } catch {
      throw new BadRequestException('No se pudo leer el Excel. Ábralo y guárdelo de nuevo como .xlsx');
    }
    for (const ws of wb.worksheets) {
      if (ws.rowCount > MAX_FILAS_HOJA) {
        throw new BadRequestException(
          `La hoja "${ws.name.slice(0, 40)}" tiene demasiadas filas (máximo ${MAX_FILAS_HOJA}). Borre las filas vacías o sobrantes`,
        );
      }
      const filas = leerFilasOperadoresCda(ws);
      if (filas) {
        if (filas.length === 0) throw new BadRequestException('El Excel no tiene operadores debajo del encabezado');
        if (filas.length > MAX_OPERADORES) {
          throw new BadRequestException(`Demasiados operadores en el archivo (máximo ${MAX_OPERADORES})`);
        }
        return filas;
      }
    }
    throw new BadRequestException(
      'No se encontró la fila de encabezados (debe tener las columnas "Apellidos Nombres" y "Cédula")',
    );
  }
}

/** Corta textos largos y la cantidad de errores para no devolver respuestas enormes. */
function acotarErrores(errores: BulkUploadRow[]): BulkUploadRow[] {
  const acotados: BulkUploadRow[] = errores.slice(0, MAX_ERRORES).map((e) => ({
    ...e,
    datos: e.datos
      ? Object.fromEntries(
          Object.entries(e.datos).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, MAX_TEXTO_ERROR) : v]),
        )
      : undefined,
  }));
  if (errores.length > MAX_ERRORES) {
    acotados.push({
      fila: errores[MAX_ERRORES].fila,
      error: `… y ${errores.length - MAX_ERRORES} fila(s) más con errores`,
    });
  }
  return acotados;
}

/** Valida cada fila y marca cédulas repetidas dentro del mismo archivo. */
function validarFilas(leidas: FilaLeida[]): {
  filas: Omit<OperadorCdaFila, 'accion'>[];
  errores: BulkUploadRow[];
} {
  const filas: Omit<OperadorCdaFila, 'accion'>[] = [];
  const errores: BulkUploadRow[] = [];
  const vistas = new Map<string, number>();

  for (const { fila, datos } of leidas) {
    const parsed = operadorCdaFilaSchema.safeParse(datos);
    if (!parsed.success) {
      errores.push({
        fila,
        error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        datos,
      });
      continue;
    }
    const previa = vistas.get(parsed.data.cedula);
    if (previa) {
      errores.push({ fila, error: `Cédula repetida (ya está en la fila ${previa})`, datos });
      continue;
    }
    vistas.set(parsed.data.cedula, fila);
    filas.push({ fila, ...parsed.data });
  }
  return { filas, errores };
}

export function toOperadorCdaDto(o: {
  id: string;
  numero: number | null;
  apellidosNombres: string;
  cedula: string;
  telefono: string | null;
  cargo: string;
  unidad: string | null;
  fechaInicio: Date | null;
  fotoKey: string | null;
  activo: boolean;
  creadoEn: Date;
}): OperadorCda {
  return {
    id: o.id,
    numero: o.numero,
    apellidosNombres: o.apellidosNombres,
    cedula: o.cedula,
    telefono: o.telefono,
    cargo: o.cargo,
    unidad: o.unidad,
    fechaInicio: o.fechaInicio ? o.fechaInicio.toISOString().slice(0, 10) : null,
    tieneFoto: !!o.fotoKey,
    activo: o.activo,
    creadoEn: o.creadoEn.toISOString(),
  };
}
