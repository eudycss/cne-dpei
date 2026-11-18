import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AjustesPerimetro, PlanPerimetroDetalle, PlanPerimetroResumen, VistaPerimetro } from '@cne/shared-types';
import {
  ajustesPerimetroSchema,
  anilloPerimetroSchema,
  vallasPerimetroGuardadasSchema,
  vistaPerimetroSchema,
  zonasPerimetroGuardadasSchema,
  type CrearPlanPerimetroInput,
  type GuardarPlanPerimetroInput,
} from '@cne/shared-validation';
import type { ZodType } from 'zod';
import { assertEventoNoReabierto } from '../common/evento-no-reabierto.guard';
import { PrismaService } from '../db/prisma.service';
import { StorageService } from '../storage/storage.service';

export const MENSAJE_EVENTO_CERRADO = 'El evento está cerrado; sus planes solo se pueden consultar';
export const MENSAJE_PLAN_CAMBIADO = 'Otra persona guardó este plan mientras usted lo editaba. Recárguelo para ver los cambios.';
export const MENSAJE_PERSONAS_INVALIDAS = 'Hay personas que no existen o que ya no están activas en el personal CDA/CPE';

type DatosPlan = Omit<CrearPlanPerimetroInput, 'eventoId'>;
/** Cliente normal o el de una transacción: las comprobaciones corren dentro de la misma. */
type Db = Pick<Prisma.TransactionClient, 'eventoElectoral' | 'operadorCda'>;

const INCLUIR_DETALLE = {
  puestos: {
    orderBy: { orden: 'asc' },
    // De la persona solo sale el nombre y si tiene foto: nada de cédula, cargo, sexo ni teléfono.
    include: { operador: { select: { id: true, apellidosNombres: true, fotoKey: true } } },
  },
} satisfies Prisma.PlanPerimetroInclude;

type PlanConPuestos = Prisma.PlanPerimetroGetPayload<{ include: typeof INCLUIR_DETALLE }>;

/** Lo guardado se vuelve a validar al leerlo; si algo está dañado se descarta y se avisa. */
function leerJson<T>(schema: ZodType<T>, valor: unknown, vacio: T, avisos: string[], que: string): T {
  if (valor === null || valor === undefined) return vacio;
  const r = schema.safeParse(valor);
  if (r.success) return r.data;
  avisos.push(`Se descartó ${que} porque estaba dañado`);
  return vacio;
}

@Injectable()
export class PerimetroService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async listar(eventoId: string): Promise<PlanPerimetroResumen[]> {
    const planes = await this.prisma.planPerimetro.findMany({
      where: { eventoId },
      orderBy: { nombre: 'asc' },
      select: { id: true, eventoId: true, nombre: true, lugar: true, actualizadoEn: true },
    });
    if (planes.length === 0) return [];
    const conteos = await this.prisma.puestoPerimetro.groupBy({
      by: ['planId'],
      where: { planId: { in: planes.map((p) => p.id) } },
      // _count de una columna cuenta solo los no nulos: puestos con persona.
      _count: { _all: true, operadorCdaId: true },
    });
    const porPlan = new Map(conteos.map((c) => [c.planId, c._count]));
    return planes.map((p) => ({
      ...p,
      actualizadoEn: p.actualizadoEn.toISOString(),
      puestos: porPlan.get(p.id)?._all ?? 0,
      puestosConPersona: porPlan.get(p.id)?.operadorCdaId ?? 0,
    }));
  }

  async detalle(id: string): Promise<PlanPerimetroDetalle> {
    const plan = await this.prisma.planPerimetro.findUnique({ where: { id }, include: INCLUIR_DETALLE });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    return this.aDetalle(plan);
  }

  async crear(input: CrearPlanPerimetroInput, usuarioId: string): Promise<PlanPerimetroDetalle> {
    const { eventoId, ...datos } = input;
    const plan = await this.prisma.$transaction(async (tx) => {
      await this.eventoEditable(tx, eventoId);
      await this.personasActivas(tx, datos);
      return tx.planPerimetro.create({
        data: {
          eventoId,
          ...this.columnas(datos),
          creadoPorId: usuarioId,
          actualizadoPorId: usuarioId,
          puestos: { create: this.filasPuestos(datos) },
        },
        include: INCLUIR_DETALLE,
      });
    });
    return this.aDetalle(plan);
  }

  /**
   * Guarda el plan completo (dibujo + puestos) en una transacción. Bloqueo
   * optimista con un contador: solo se escribe si version sigue siendo la que
   * leyó la web; si otra persona guardó antes, 409 en vez de pisar su trabajo.
   */
  async guardar(id: string, input: GuardarPlanPerimetroInput, usuarioId: string): Promise<PlanPerimetroDetalle> {
    const { version, ...datos } = input;
    const plan = await this.prisma.$transaction(async (tx) => {
      const actual = await tx.planPerimetro.findUnique({ where: { id }, select: { eventoId: true } });
      if (!actual) throw new NotFoundException('Plan no encontrado');
      await this.eventoEditable(tx, actual.eventoId);
      await this.personasActivas(tx, datos);
      const { count } = await tx.planPerimetro.updateMany({
        where: { id, version },
        data: { ...this.columnas(datos), actualizadoPorId: usuarioId, version: { increment: 1 } },
      });
      if (count === 0) throw new ConflictException(MENSAJE_PLAN_CAMBIADO);
      await tx.puestoPerimetro.deleteMany({ where: { planId: id } });
      const filas = this.filasPuestos(datos);
      if (filas.length > 0) await tx.puestoPerimetro.createMany({ data: filas.map((f) => ({ ...f, planId: id })) });
      return tx.planPerimetro.findUniqueOrThrow({ where: { id }, include: INCLUIR_DETALLE });
    });
    return this.aDetalle(plan);
  }

  async eliminar(id: string): Promise<{ id: string }> {
    const plan = await this.prisma.planPerimetro.findUnique({ where: { id }, select: { eventoId: true } });
    if (!plan) throw new NotFoundException('Plan no encontrado');
    await this.eventoEditable(this.prisma, plan.eventoId);
    await this.prisma.planPerimetro.delete({ where: { id } });
    return { id };
  }

  /** Foto de una persona del plan: solo si de verdad está en un puesto de ESE plan. */
  async foto(planId: string, operadorId: string): Promise<Buffer> {
    const puesto = await this.prisma.puestoPerimetro.findFirst({
      where: { planId, operadorCdaId: operadorId },
      select: { operador: { select: { fotoKey: true } } },
    });
    if (!puesto) throw new NotFoundException('La persona no está en este plan');
    if (!puesto.operador?.fotoKey) throw new NotFoundException('La persona aún no tiene foto');
    return this.storage.readDecrypted(puesto.operador.fotoKey);
  }

  private async eventoEditable(db: Db, eventoId: string): Promise<void> {
    const evento = await db.eventoElectoral.findUnique({
      where: { id: eventoId },
      select: { estado: true, reabiertoEn: true },
    });
    if (!evento) throw new NotFoundException('Evento no encontrado');
    assertEventoNoReabierto(evento);
    if (evento.estado === 'CERRADO') throw new ForbiddenException(MENSAJE_EVENTO_CERRADO);
  }

  private async personasActivas(db: Db, datos: DatosPlan): Promise<void> {
    const ids = datos.puestos.map((p) => p.operadorCdaId).filter((x): x is string => x !== null);
    if (ids.length === 0) return;
    const activas = await db.operadorCda.count({ where: { id: { in: ids }, activo: true } });
    if (activas !== new Set(ids).size) throw new BadRequestException(MENSAJE_PERSONAS_INVALIDAS);
  }

  private columnas(datos: DatosPlan) {
    return {
      nombre: datos.nombre,
      lugar: datos.lugar,
      perimetro: datos.perimetro ?? Prisma.DbNull,
      zonas: datos.zonas,
      vallas: datos.vallas,
      ajustes: datos.ajustes,
      vista: datos.vista ?? Prisma.DbNull,
    };
  }

  private filasPuestos(datos: DatosPlan) {
    return datos.puestos.map((p, i) => ({
      orden: i + 1,
      lat: p.lat,
      lng: p.lng,
      operadorCdaId: p.operadorCdaId,
      etiqueta: p.etiqueta,
    }));
  }

  private async aDetalle(plan: PlanConPuestos): Promise<PlanPerimetroDetalle> {
    const avisos: string[] = [];
    const ajustesFabrica = ajustesPerimetroSchema.parse({}) as AjustesPerimetro;
    const detalle: PlanPerimetroDetalle = {
      id: plan.id,
      eventoId: plan.eventoId,
      nombre: plan.nombre,
      lugar: plan.lugar,
      perimetro: leerJson(anilloPerimetroSchema, plan.perimetro, null, avisos, 'el perímetro'),
      zonas: leerJson(zonasPerimetroGuardadasSchema, plan.zonas, [], avisos, 'las zonas'),
      vallas: leerJson(vallasPerimetroGuardadasSchema, plan.vallas, [], avisos, 'las vallas'),
      ajustes: leerJson(ajustesPerimetroSchema, plan.ajustes, ajustesFabrica, avisos, 'los ajustes') as AjustesPerimetro,
      vista: leerJson(vistaPerimetroSchema, plan.vista, null, avisos, 'la vista') as VistaPerimetro | null,
      puestos: plan.puestos.map((p) => ({
        id: p.id,
        orden: p.orden,
        lat: p.lat,
        lng: p.lng,
        etiqueta: p.etiqueta,
        persona: p.operador ? { id: p.operador.id, nombre: p.operador.apellidosNombres, tieneFoto: !!p.operador.fotoKey } : null,
      })),
      version: plan.version,
      actualizadoEn: plan.actualizadoEn.toISOString(),
      avisos,
    };
    detalle.avisos.push(...(await this.avisosOtrosPlanes(plan)));
    return detalle;
  }

  /** No bloquea (puede haber relevos), pero avisa si alguien también está en otro plan del evento. */
  private async avisosOtrosPlanes(plan: PlanConPuestos): Promise<string[]> {
    const ids = plan.puestos.map((p) => p.operadorCdaId).filter((x): x is string => x !== null);
    if (ids.length === 0) return [];
    const otros = await this.prisma.puestoPerimetro.findMany({
      where: { operadorCdaId: { in: ids }, plan: { eventoId: plan.eventoId, id: { not: plan.id } } },
      select: { operador: { select: { apellidosNombres: true } }, plan: { select: { nombre: true } } },
      orderBy: [{ plan: { nombre: 'asc' } }],
    });
    return otros
      .filter((o) => o.operador)
      .map((o) => `${o.operador!.apellidosNombres} también está en el plan «${o.plan.nombre}»`);
  }
}
