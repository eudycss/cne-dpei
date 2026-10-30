import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { CargoCda, CentroCda, CrearCargoCdaRequest, GrupoCda, RenombrarCargoCdaRequest } from '@cne/shared-types';

import { PrismaService } from '../db/prisma.service';
import { claveParaNombre, registrarCargo, registrarCargos } from './grupo-cda';
import { GRUPOS_CON_CUENTA } from './cuentas-cda.service';

type FilaCargo = { clave: string; nombre: string; centro: string; activo: boolean; orden: number };

const ORDEN = [{ orden: 'asc' as const }, { clave: 'asc' as const }];

/** Cada cuánto se relee la tabla: pone al día un arranque sin base o a otra instancia. */
const REFRESCO_MS = 60_000;

/**
 * Cargos del combo "Cargo" (tabla cargos_cda). Solo se agregan, se renombran
 * y se desactivan: el personal, su asistencia, actas y carnets cuelgan de la
 * clave y nunca se pierden. Operadores y Asistentes CDA no se desactivan.
 */
@Injectable()
export class CargosCdaService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(CargosCdaService.name);
  private temporizador?: ReturnType<typeof setInterval>;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.refrescarSinFallar();
    this.temporizador ??= setInterval(() => void this.refrescarSinFallar(), REFRESCO_MS);
    this.temporizador.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.temporizador);
    this.temporizador = undefined;
  }

  /** Todos los cargos (también desactivados) con sus personas activas. */
  async listar(): Promise<CargoCda[]> {
    const [filas, conteos] = await Promise.all([
      this.refrescar(),
      this.prisma.operadorCda.groupBy({ by: ['grupo'], where: { activo: true }, _count: { _all: true } }),
    ]);
    const personas = new Map(conteos.map((c) => [c.grupo, c._count._all]));
    return filas.map((f) => aCargo(f, personas.get(f.clave) ?? 0));
  }

  async crear({ nombre, centro }: CrearCargoCdaRequest): Promise<CargoCda> {
    await this.nombreLibre(nombre);
    const existentes = await this.prisma.cargoCda.findMany({ select: { clave: true } });
    const clave = claveParaNombre(nombre, new Set(existentes.map((c) => c.clave)));
    const { _max } = await this.prisma.cargoCda.aggregate({ _max: { orden: true } });
    const creado = await this.guardar(() =>
      this.prisma.cargoCda.create({ data: { clave, nombre, centro, orden: (_max.orden ?? 0) + 1 } }),
    );
    registrarCargo(aRegistrado(creado));
    await this.refrescarSinFallar();
    return aCargo(creado, 0);
  }

  /** Solo el nombre visible: la clave, el centro y los textos de actas no cambian. */
  async renombrar(clave: GrupoCda, { nombre }: RenombrarCargoCdaRequest): Promise<CargoCda> {
    await this.existente(clave);
    await this.nombreLibre(nombre, clave);
    const r = await this.guardar(() => this.prisma.cargoCda.update({ where: { clave }, data: { nombre } }));
    return this.conPersonas(r);
  }

  async cambiarActivo(clave: GrupoCda, activo: boolean): Promise<CargoCda> {
    await this.existente(clave);
    if (!activo && esProtegido(clave)) {
      throw new BadRequestException('Operadores y Asistentes CDA no se pueden desactivar: los usa la app (parejas y kits)');
    }
    const r = await this.prisma.cargoCda.update({ where: { clave }, data: { activo } });
    return this.conPersonas(r);
  }

  private async refrescar(): Promise<FilaCargo[]> {
    const filas = await this.prisma.cargoCda.findMany({
      select: { clave: true, nombre: true, centro: true, activo: true, orden: true },
      orderBy: ORDEN,
    });
    registrarCargos(filas.map(aRegistrado));
    return filas;
  }

  /** Si la base falla al releer, queda lo que ya había (y el refresco periódico lo corrige). */
  private async refrescarSinFallar(): Promise<void> {
    try {
      await this.refrescar();
    } catch (e) {
      this.log.warn(`No se pudieron leer los cargos CDA: ${(e as Error).message}`);
    }
  }

  private async conPersonas(fila: FilaCargo): Promise<CargoCda> {
    registrarCargo(aRegistrado(fila));
    await this.refrescarSinFallar();
    const [conteo] = await this.prisma.operadorCda.groupBy({
      by: ['grupo'],
      where: { activo: true, grupo: fila.clave },
      _count: { _all: true },
    });
    return aCargo(fila, conteo?._count._all ?? 0);
  }

  private async existente(clave: GrupoCda): Promise<FilaCargo> {
    const c = await this.prisma.cargoCda.findUnique({ where: { clave } });
    if (!c) throw new NotFoundException('Cargo no encontrado');
    return c;
  }

  private async nombreLibre(nombre: string, excepto?: GrupoCda): Promise<void> {
    const otro = await this.prisma.cargoCda.findFirst({
      where: { nombre: { equals: nombre, mode: 'insensitive' }, ...(excepto ? { clave: { not: excepto } } : {}) },
      select: { clave: true },
    });
    if (otro) throw new ConflictException(`Ya existe un cargo llamado "${nombre}"`);
  }

  /** El índice único (lower(nombre) o la clave) gana si dos guardan a la vez. */
  private async guardar<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Ya existe un cargo con ese nombre');
      }
      throw e;
    }
  }
}

function esProtegido(clave: GrupoCda): boolean {
  return GRUPOS_CON_CUENTA.includes(clave);
}

function aRegistrado(f: FilaCargo) {
  return { clave: f.clave, nombre: f.nombre, centro: f.centro as CentroCda, activo: f.activo };
}

function aCargo(f: FilaCargo, personas: number): CargoCda {
  return {
    clave: f.clave,
    nombre: f.nombre,
    centro: f.centro as CentroCda,
    activo: f.activo,
    protegido: esProtegido(f.clave),
    orden: f.orden,
    personas,
  };
}
