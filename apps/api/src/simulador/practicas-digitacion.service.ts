import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { NovedadDigitacion, PracticaDigitacion } from '@cne/shared-types';
import type { PracticaDigitacionInput } from '@cne/shared-validation';

import { PrismaService } from '../db/prisma.service';

const INCLUIR = {
  cargos: { select: { cargo: true }, orderBy: { cargo: 'asc' as const } },
  personas: { select: { operadorId: true, incluida: true } },
  _count: { select: { intentos: true } },
};

type FilaPractica = Prisma.PracticaDigitacionGetPayload<{ include: typeof INCLUIR }>;

/** Campos que definen cómo se califica: con intentos ya hechos no se tocan. */
const CAMPOS_FIJOS_CON_INTENTOS = ['filasPorActa', 'votoMin', 'votoMax', 'metaActas', 'plazoMinutos', 'pctDigitosDistintos'] as const;

export function aPractica(f: FilaPractica): PracticaDigitacion {
  return {
    id: f.id,
    nombre: f.nombre,
    filasPorActa: f.filasPorActa,
    votoMin: f.votoMin,
    votoMax: f.votoMax,
    metaActas: f.metaActas,
    plazoMinutos: f.plazoMinutos,
    inicio: f.inicio.toISOString(),
    fin: f.fin.toISOString(),
    pctDigitosDistintos: f.pctDigitosDistintos,
    intentosMax: f.intentosMax,
    activa: f.activa,
    cargos: f.cargos.map((c) => c.cargo),
    incluir: f.personas.filter((p) => p.incluida).map((p) => p.operadorId),
    excluir: f.personas.filter((p) => !p.incluida).map((p) => p.operadorId),
    intentos: f._count.intentos,
    creadoEn: f.creadoEn.toISOString(),
  };
}

function datosPractica(input: PracticaDigitacionInput) {
  return {
    nombre: input.nombre,
    filasPorActa: input.filasPorActa,
    votoMin: input.votoMin,
    votoMax: input.votoMax,
    metaActas: input.metaActas,
    plazoMinutos: input.plazoMinutos,
    inicio: new Date(input.inicio),
    fin: new Date(input.fin),
    pctDigitosDistintos: input.pctDigitosDistintos,
    intentosMax: input.intentosMax,
  };
}

function filasAsignacion(practicaId: string, input: PracticaDigitacionInput) {
  return {
    cargos: input.cargos.map((cargo) => ({ practicaId, cargo })),
    personas: [
      ...input.incluir.map((operadorId) => ({ practicaId, operadorId, incluida: true })),
      ...input.excluir.map((operadorId) => ({ practicaId, operadorId, incluida: false })),
    ],
  };
}

/** Un cargo o una persona que no existe llega como violación de llave foránea. */
function traducirError(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === 'P2003') throw new BadRequestException('Algún cargo o persona elegida ya no existe');
    if (e.code === 'P2002') throw new ConflictException('Ya existe una novedad con ese nombre');
    if (e.code === 'P2025') throw new NotFoundException('No encontrado');
  }
  throw e;
}

@Injectable()
export class PracticasDigitacionService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(): Promise<PracticaDigitacion[]> {
    const filas = await this.prisma.practicaDigitacion.findMany({ include: INCLUIR, orderBy: { creadoEn: 'desc' } });
    return filas.map(aPractica);
  }

  async obtener(id: string): Promise<PracticaDigitacion> {
    const fila = await this.prisma.practicaDigitacion.findUnique({ where: { id }, include: INCLUIR });
    if (!fila) throw new NotFoundException('Práctica no encontrada');
    return aPractica(fila);
  }

  async crear(input: PracticaDigitacionInput): Promise<PracticaDigitacion> {
    try {
      const id = await this.prisma.$transaction(async (tx) => {
        const { id } = await tx.practicaDigitacion.create({ data: datosPractica(input), select: { id: true } });
        const filas = filasAsignacion(id, input);
        if (filas.cargos.length) await tx.practicaDigitacionCargo.createMany({ data: filas.cargos });
        if (filas.personas.length) await tx.practicaDigitacionPersona.createMany({ data: filas.personas });
        return id;
      });
      return this.obtener(id);
    } catch (e) {
      traducirError(e);
    }
  }

  /**
   * Reemplaza la práctica completa. Con intentos hechos, lo que define la
   * calificación queda fijo (para que todos compitan con las mismas reglas);
   * nombre, ventana, intentos y a quién aplica sí cambian.
   */
  async editar(id: string, input: PracticaDigitacionInput): Promise<PracticaDigitacion> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // FOR UPDATE: un intento que empiece ahora espera (su llave foránea
        // choca con este bloqueo), así no cambian las reglas bajo un intento vivo.
        await tx.$queryRaw`SELECT 1 FROM "practicas_digitacion" WHERE "id" = ${id}::uuid FOR UPDATE`;
        const actual = await tx.practicaDigitacion.findUnique({ where: { id }, include: INCLUIR });
        if (!actual) throw new NotFoundException('Práctica no encontrada');
        if (actual._count.intentos > 0 && CAMPOS_FIJOS_CON_INTENTOS.some((c) => actual[c] !== input[c])) {
          throw new ConflictException(
            'La práctica ya tiene intentos: no se pueden cambiar filas, rango de votos, meta, plazo ni el % de dígitos distintos. Cree otra práctica.',
          );
        }
        await tx.practicaDigitacion.update({ where: { id }, data: datosPractica(input) });
        await tx.practicaDigitacionCargo.deleteMany({ where: { practicaId: id } });
        await tx.practicaDigitacionPersona.deleteMany({ where: { practicaId: id } });
        const filas = filasAsignacion(id, input);
        if (filas.cargos.length) await tx.practicaDigitacionCargo.createMany({ data: filas.cargos });
        if (filas.personas.length) await tx.practicaDigitacionPersona.createMany({ data: filas.personas });
      });
    } catch (e) {
      traducirError(e);
    }
    return this.obtener(id);
  }

  async cambiarActiva(id: string, activa: boolean): Promise<PracticaDigitacion> {
    try {
      await this.prisma.practicaDigitacion.update({ where: { id }, data: { activa } });
    } catch (e) {
      traducirError(e);
    }
    return this.obtener(id);
  }

  // ---- Catálogo de novedades del SIER ----

  listarNovedades(): Promise<NovedadDigitacion[]> {
    return this.prisma.novedadDigitacion.findMany({ orderBy: [{ orden: 'asc' }, { nombre: 'asc' }] });
  }

  async crearNovedad(nombre: string): Promise<NovedadDigitacion> {
    await this.nombreNovedadLibre(nombre);
    const { _max } = await this.prisma.novedadDigitacion.aggregate({ _max: { orden: true } });
    try {
      return await this.prisma.novedadDigitacion.create({ data: { nombre, orden: (_max.orden ?? 0) + 1 } });
    } catch (e) {
      traducirError(e);
    }
  }

  async renombrarNovedad(id: string, nombre: string): Promise<NovedadDigitacion> {
    await this.nombreNovedadLibre(nombre, id);
    try {
      return await this.prisma.novedadDigitacion.update({ where: { id }, data: { nombre } });
    } catch (e) {
      traducirError(e);
    }
  }

  async cambiarActivaNovedad(id: string, activa: boolean): Promise<NovedadDigitacion> {
    try {
      return await this.prisma.novedadDigitacion.update({ where: { id }, data: { activa } });
    } catch (e) {
      traducirError(e);
    }
  }

  /** El índice único distingue mayúsculas; aquí "Acta ilegible" = "ACTA ILEGIBLE". */
  private async nombreNovedadLibre(nombre: string, excepto?: string): Promise<void> {
    const otra = await this.prisma.novedadDigitacion.findFirst({
      where: { nombre: { equals: nombre, mode: 'insensitive' }, ...(excepto ? { id: { not: excepto } } : {}) },
      select: { id: true },
    });
    if (otra) throw new ConflictException('Ya existe una novedad con ese nombre');
  }
}
