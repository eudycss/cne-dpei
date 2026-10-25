import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { operadorCdaFilaSchema } from '@cne/shared-validation';
import type {
  BulkUploadRow,
  CambiarCargoOperadorCdaResult,
  CrearOperadorCdaRequest,
  EditarOperadorCdaRequest,
  GrupoCda,
  ImportOperadoresCdaResult,
  OperadorCda,
  OperadorCdaFila,
} from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { leerFilasOperadoresCda, type FilaLeida } from './excel-operadores-cda';
import { tamanoDescomprimidoZip } from './zip';
import { TEXTOS_GRUPO } from './grupo-cda';
import { diaDeFechaDb, diaEcuador, fechaDb } from './dia-ecuador';

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

  async list(opts: { search?: string; incluirInactivos?: boolean; grupo?: GrupoCda } = {}): Promise<OperadorCda[]> {
    const search = opts.search?.trim();
    const items = await this.prisma.operadorCda.findMany({
      where: {
        grupo: opts.grupo ?? 'OPERADOR',
        ...(!opts.incluirInactivos && { activo: true }),
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
   * Alta manual (alguien que no vino en el Excel). La cédula no puede repetirse
   * en ninguno de los dos grupos: una persona está en un solo grupo.
   */
  async crear(datos: CrearOperadorCdaRequest): Promise<OperadorCda> {
    const grupo = datos.grupo ?? 'OPERADOR';
    const existente = await this.prisma.operadorCda.findUnique({
      where: { cedula: datos.cedula },
      select: { activo: true, grupo: true },
    });
    if (existente) throw new ConflictException(mensajeCedulaRepetida(existente, grupo));
    try {
      const creado = await this.prisma.operadorCda.create({
        data: { cedula: datos.cedula, grupo, ...datosEditables(datos) },
      });
      return toOperadorCdaDto(creado);
    } catch (e) {
      // Dos altas simultáneas con la misma cédula: la segunda choca con el índice único.
      if ((e as { code?: string } | null)?.code === 'P2002') {
        throw new ConflictException('Ya existe una persona con esa cédula');
      }
      throw e;
    }
  }

  /** Corrige los datos de un operador (activo u oculto). La cédula no cambia. */
  async editar(id: string, datos: EditarOperadorCdaRequest): Promise<OperadorCda> {
    await this.existe(id);
    const editado = await this.prisma.operadorCda.update({ where: { id }, data: datosEditables(datos) });
    return toOperadorCdaDto(editado);
  }

  /**
   * Oculta (baja lógica) o reactiva. Nunca se borra la fila: tiene asistencias y
   * actas ligadas. Al ocultar, el cron de la madrugada borra su foto (LOPDP).
   */
  async cambiarActivo(id: string, activo: boolean): Promise<OperadorCda> {
    await this.existe(id);
    const editado = await this.prisma.operadorCda.update({ where: { id }, data: { activo } });
    return toOperadorCdaDto(editado);
  }

  /**
   * Pasa a la persona a otro cargo desde hoy (hora de Ecuador), o desde
   * mañana si hoy ya marcó entrada: esa marca queda en el cargo de antes,
   * como toda su asistencia anterior (cambios_cargo_cda). El
   * carnet y el acta no se tocan (dicen el cargo anterior); se informa si
   * existen para que la web avise.
   */
  async cambiarCargo(id: string, grupo: GrupoCda, usuarioId: string): Promise<CambiarCargoOperadorCdaResult> {
    const o = await this.prisma.operadorCda.findUnique({
      where: { id },
      select: {
        grupo: true,
        activo: true,
        _count: { select: { credenciales: { where: { revocadaEn: null } }, actas: true } },
      },
    });
    if (!o) throw new NotFoundException('Operador no encontrado');
    if (!o.activo) throw new ConflictException('Reactívelo antes de cambiarlo de cargo');
    if (o.grupo === grupo) throw new BadRequestException(`Ya está en ${TEXTOS_GRUPO[grupo].titulo}`);

    const hoy = diaEcuador();
    const marcoHoy = await this.prisma.asistenciaCda.findFirst({
      where: { operadorId: id, fecha: fechaDb(hoy), entradaEn: { not: null } },
      select: { id: true },
    });
    const desde = marcoHoy ? diaDeFechaDb(new Date(fechaDb(hoy).getTime() + 86_400_000)) : hoy;

    const editado = await this.prisma.$transaction(async (tx) => {
      // Condicionado al cargo leído: si otro administrador lo cambió entretanto, no se pisa.
      const { count } = await tx.operadorCda.updateMany({ where: { id, grupo: o.grupo }, data: { grupo } });
      if (!count) throw new ConflictException('Otro usuario acaba de cambiarle el cargo: recargue la lista');
      await tx.cambioCargoCda.create({
        data: { operadorId: id, grupoAnterior: o.grupo, grupoNuevo: grupo, desde: fechaDb(desde), hechoPorId: usuarioId },
      });
      return tx.operadorCda.findUniqueOrThrow({ where: { id } });
    });
    return {
      operador: toOperadorCdaDto(editado),
      grupoAnterior: o.grupo,
      desde,
      carnetVigente: o._count.credenciales > 0,
      actaVigente: o._count.actas > 0,
    };
  }

  private async existe(id: string): Promise<void> {
    const o = await this.prisma.operadorCda.findUnique({ where: { id }, select: { id: true } });
    if (!o) throw new NotFoundException('Operador no encontrado');
  }

  /**
   * Importa el Excel de operadores. Con `aplicar=false` solo devuelve la vista
   * previa; con `aplicar=true` guarda todo o nada (si hay errores no guarda).
   * La cédula identifica a la persona: si ya existe en este grupo se
   * actualizan sus datos; si está en el otro grupo, la fila es un error.
   */
  async importar(
    file: Express.Multer.File | undefined,
    { aplicar, grupo = 'OPERADOR' }: { aplicar: boolean; grupo?: GrupoCda },
  ): Promise<ImportOperadoresCdaResult> {
    const leidas = await this.leerExcel(file);
    const validadas = validarFilas(leidas);

    const existentes = await this.prisma.operadorCda.findMany({
      where: { cedula: { in: validadas.filas.map((f) => f.cedula) } },
      select: { cedula: true, grupo: true },
    });
    const grupoDe = new Map<string, GrupoCda>(existentes.map((e) => [e.cedula, e.grupo]));
    const yaRegistradas = new Set(existentes.filter((e) => e.grupo === grupo).map((e) => e.cedula));
    const errores = [...validadas.errores];
    const filas = validadas.filas.filter((f) => {
      const otro = grupoDe.get(f.cedula);
      if (!otro || otro === grupo) return true;
      errores.push({ fila: f.fila, error: `La cédula ya está registrada en ${TEXTOS_GRUPO[otro].titulo}` });
      return false;
    });
    errores.sort((a, b) => a.fila - b.fila);
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
          create: { cedula: f.cedula, grupo, ...datos },
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

/** Lo que el formulario manda; un opcional ausente o vacío se guarda vacío (null). */
function datosEditables(d: EditarOperadorCdaRequest) {
  return {
    apellidosNombres: d.apellidosNombres,
    telefono: d.telefono || null,
    cargo: d.cargo,
    unidad: d.unidad || null,
    fechaInicio: d.fechaInicio ? new Date(`${d.fechaInicio}T00:00:00Z`) : null,
  };
}

function mensajeCedulaRepetida(existente: { activo: boolean; grupo: GrupoCda }, grupo: GrupoCda): string {
  if (existente.grupo !== grupo) return `Esa cédula ya está registrada en ${TEXTOS_GRUPO[existente.grupo].titulo}`;
  const quien = TEXTOS_GRUPO[grupo].singular;
  return existente.activo
    ? `Ya existe un ${quien} con esa cédula`
    : `Ya existe un ${quien} oculto con esa cédula: actívelo desde "Mostrar ocultos"`;
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
  grupo: GrupoCda;
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
    grupo: o.grupo,
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
