import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CandidatoDistribucion,
  DistribucionDiasDetalle,
  DistribucionDiasResumen,
  FormatoReporteCda,
  PersonaDistribucionDias,
} from '@cne/shared-types';
import {
  MAX_CANDIDATOS_DISTRIBUCION,
  archivoContactosDia,
  tieneCupoDia,
  type AgregarPersonaDistribucionInput,
  type CrearDistribucionDiasInput,
  type EditarPersonaDistribucionInput,
  type IntercambiarPersonaDistribucionInput,
  type ReporteDistribucionInput,
} from '@cne/shared-validation';

import { idsPorBusqueda } from '../common/busqueda-sql';
import { PrismaService } from '../db/prisma.service';
import { DistributivoTecnicosClient, tecnicosPorRecinto } from '../enlaces/distributivo-tecnicos.client';
import { fechaDb } from './dia-ecuador';
import { contactosVcard, normalizarSexo, ordenarPersonas, repartirEnDias, reporteDistribucion, totalesPorDia } from './distribucion-dias';
import { type ArchivoReporte, generarReporte } from './reporte-cda';

const AVISO_DISTRIBUTIVO = 'No se pudo leer el distributivo de técnicos (Drive): la columna Encargado del CDA quedó vacía. Puede llenarla a mano.';

const SELECT_PERSONA = {
  id: true,
  fecha: true,
  operadorId: true,
  cedula: true,
  nombres: true,
  telefono: true,
  sexo: true,
  cargo: true,
  canton: true,
  encargado: true,
  operador: { select: { apellidosNombres: true, cedula: true, telefono: true, sexo: true, cargoCda: { select: { nombre: true } } } },
} satisfies Prisma.DistribucionDiasPersonaSelect;

type FilaPersona = Prisma.DistribucionDiasPersonaGetPayload<{ select: typeof SELECT_PERSONA }>;

interface Distribucion {
  id: string;
  fechas: string[];
  excluirCargos: string[];
  cantonCpe: string | null;
  encargadoCpe: string | null;
}

/** Cantón y encargado de una persona del personal registrado. */
interface Origen {
  canton: string | null;
  encargado: string | null;
}

const dia = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Distribución del personal CDA/CPE por días. Independiente de Parejas, kits y
 * asistencia: solo organiza quién va cada día, con su cantón y su encargado.
 * Del personal registrado, nombre, celular, sexo y cargo salen siempre de su
 * ficha; de una persona externa, de la propia fila.
 */
@Injectable()
export class DistribucionDiasService {
  private readonly logger = new Logger(DistribucionDiasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly distributivo: DistributivoTecnicosClient,
  ) {}

  async listar(): Promise<DistribucionDiasResumen[]> {
    const filas = await this.prisma.distribucionDias.findMany({
      orderBy: { creadoEn: 'desc' },
      select: { id: true, nombre: true, fechas: true, creadoEn: true, _count: { select: { personas: true } } },
    });
    return filas.map((f) => ({ id: f.id, nombre: f.nombre, fechas: f.fechas.map(dia), total: f._count.personas, creadoEn: f.creadoEn.toISOString() }));
  }

  async detalle(id: string, avisos: string[] = []): Promise<DistribucionDiasDetalle> {
    const d = await this.prisma.distribucionDias.findUnique({
      where: { id },
      select: {
        id: true,
        nombre: true,
        fechas: true,
        excluirCargos: true,
        cantonCpe: true,
        encargadoCpe: true,
        creadoEn: true,
        personas: { select: SELECT_PERSONA },
      },
    });
    if (!d) throw new NotFoundException('Distribución no encontrada');
    const fechas = d.fechas.map(dia);
    const personas = ordenarPersonas(d.personas.map(aPersona));
    return {
      id: d.id,
      nombre: d.nombre,
      fechas,
      total: personas.length,
      creadoEn: d.creadoEn.toISOString(),
      excluirCargos: d.excluirCargos,
      cantonCpe: d.cantonCpe,
      encargadoCpe: d.encargadoCpe,
      totales: totalesPorDia(personas, fechas),
      personas,
      avisos,
    };
  }

  async crear(body: CrearDistribucionDiasInput, usuarioId: string): Promise<DistribucionDiasDetalle> {
    await this.exigirCargos(body.excluirCargos);
    const { id } = await this.prisma.distribucionDias.create({
      data: {
        nombre: body.nombre,
        fechas: body.fechas.map(fechaDb),
        excluirCargos: body.excluirCargos,
        cantonCpe: body.cantonCpe || null,
        encargadoCpe: body.encargadoCpe || null,
        creadoPorId: usuarioId,
      },
      select: { id: true },
    });
    try {
      return await this.regenerar(id);
    } catch (e) {
      // Sin reparto no queda una distribución vacía a medias.
      await this.prisma.distribucionDias.delete({ where: { id } }).catch(() => undefined);
      throw e;
    }
  }

  /** Borra todas las filas (también las agregadas a mano) y vuelve a repartir desde cero. */
  async regenerar(id: string): Promise<DistribucionDiasDetalle> {
    const d = await this.base(id);
    const excluir = d.excluirCargos;
    const personal = await this.prisma.operadorCda.findMany({
      where: { activo: true, ...(excluir.length ? { grupo: { notIn: excluir } } : {}) },
      orderBy: { apellidosNombres: 'asc' },
      select: { id: true, cedula: true, sexo: true, cargoCda: { select: { centro: true } } },
    });
    const avisos: string[] = [];
    const origenes = await this.origenes(d, personal, avisos);
    const filas = repartirEnDias(
      personal.map((p) => ({ ...p, sexo: normalizarSexo(p.sexo) })),
      d.fechas,
    ).map(({ persona, fecha }) => ({
      distribucionId: id,
      fecha: fechaDb(fecha),
      operadorId: persona.id,
      cedula: persona.cedula,
      canton: origenes.get(persona.id)?.canton ?? null,
      encargado: origenes.get(persona.id)?.encargado ?? null,
    }));
    await this.conCandado(id, async (tx) => {
      await tx.distribucionDiasPersona.deleteMany({ where: { distribucionId: id } });
      await tx.distribucionDiasPersona.createMany({ data: filas });
      await tx.distribucionDias.update({ where: { id }, data: { actualizadoEn: new Date() }, select: { id: true } });
    });
    return this.detalle(id, avisos);
  }

  async eliminar(id: string): Promise<{ ok: true }> {
    await this.base(id);
    await this.prisma.distribucionDias.delete({ where: { id } });
    return { ok: true };
  }

  /** Personal activo de cualquier cargo que todavía no está en la distribución. */
  async candidatos(id: string, buscar: string): Promise<CandidatoDistribucion[]> {
    await this.base(id);
    const ids = await idsPorBusqueda(this.prisma, Prisma.sql`operadores_cda t`, [Prisma.raw('t.apellidos_nombres'), Prisma.raw('t.cedula')], buscar);
    const filas = await this.prisma.operadorCda.findMany({
      where: { activo: true, ...(ids ? { id: { in: ids } } : {}), distribucionesDias: { none: { distribucionId: id } } },
      orderBy: { apellidosNombres: 'asc' },
      take: MAX_CANDIDATOS_DISTRIBUCION,
      select: { id: true, apellidosNombres: true, cedula: true, cargoCda: { select: { nombre: true } } },
    });
    return filas.map((f) => ({ id: f.id, nombre: f.apellidosNombres, cedula: f.cedula, cargo: f.cargoCda.nombre }));
  }

  async agregar(id: string, body: AgregarPersonaDistribucionInput): Promise<PersonaDistribucionDias> {
    const d = await this.base(id);
    exigirDia(d, body.fecha);
    let data: Prisma.DistribucionDiasPersonaUncheckedCreateInput;
    if (body.tipo === 'REGISTRADA') {
      const p = await this.prisma.operadorCda.findFirst({
        where: { id: body.operadorId, activo: true },
        select: { id: true, cedula: true, cargoCda: { select: { centro: true } } },
      });
      if (!p) throw new NotFoundException('Esa persona no está activa en el personal CDA/CPE');
      const origen = (await this.origenes(d, [p], [])).get(p.id);
      data = { distribucionId: id, fecha: fechaDb(body.fecha), operadorId: p.id, cedula: p.cedula, canton: origen?.canton ?? null, encargado: origen?.encargado ?? null };
    } else {
      data = {
        distribucionId: id,
        fecha: fechaDb(body.fecha),
        cedula: body.cedula,
        nombres: body.nombres,
        telefono: body.telefono ?? null,
        sexo: body.sexo,
        cargo: body.cargo,
        canton: body.canton || null,
        encargado: body.encargado || null,
      };
    }
    try {
      return aPersona(await this.conCandado(id, (tx) => tx.distribucionDiasPersona.create({ data, select: SELECT_PERSONA })));
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Esa cédula ya está en esta distribución');
      }
      throw e;
    }
  }

  async editar(id: string, personaId: string, body: EditarPersonaDistribucionInput): Promise<PersonaDistribucionDias> {
    const d = await this.base(id);
    if (body.fecha !== undefined) exigirDia(d, body.fecha);
    await this.fila(id, personaId);
    const actualizar = (tx: Prisma.TransactionClient) =>
      tx.distribucionDiasPersona
        .update({
        where: { id: personaId },
        data: {
          ...(body.fecha !== undefined ? { fecha: fechaDb(body.fecha) } : {}),
          ...(body.canton !== undefined ? { canton: body.canton || null } : {}),
          ...(body.encargado !== undefined ? { encargado: body.encargado || null } : {}),
        },
        select: SELECT_PERSONA,
      })
        .catch((e: unknown) => {
          // La quitaron mientras se editaba: 404, no 500.
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new NotFoundException('Esa persona no está en esta distribución');
          throw e;
        });
    if (body.fecha === undefined) return aPersona(await actualizar(this.prisma));
    const destino = body.fecha;
    // Mover de día solo hacia un día con cupo para su sexo (con el candado, para que dos cambios a la vez no lo salten).
    return aPersona(
      await this.conCandado(id, async (tx) => {
        const personas = (await tx.distribucionDiasPersona.findMany({ where: { distribucionId: id }, select: SELECT_PERSONA })).map(aPersona);
        const p = personas.find((x) => x.id === personaId);
        if (!p) throw new NotFoundException('Esa persona no está en esta distribución');
        if (p.fecha !== destino && p.sexo) {
          const mismo = (f: string) => personas.filter((x) => x.fecha === f && x.sexo === p.sexo).length;
          if (!tieneCupoDia(mismo(destino), mismo(p.fecha))) {
            throw new ConflictException(
              `Ese día no tiene cupo de ${p.sexo === 'M' ? 'hombres' : 'mujeres'}: rompería lo equitativo. Intercambie con alguien de ese día.`,
            );
          }
        }
        return actualizar(tx);
      }),
    );
  }

  /** Intercambia el día de dos personas del mismo sexo: los totales de cada día no cambian. */
  async intercambiar(id: string, personaId: string, body: IntercambiarPersonaDistribucionInput): Promise<PersonaDistribucionDias[]> {
    if (personaId === body.conId) throw new BadRequestException('Elija a otra persona');
    await this.base(id);
    return this.conCandado(id, async (tx) => {
      const filas = await tx.distribucionDiasPersona.findMany({ where: { distribucionId: id, id: { in: [personaId, body.conId] } }, select: SELECT_PERSONA });
      const a = filas.find((f) => f.id === personaId);
      const b = filas.find((f) => f.id === body.conId);
      if (!a || !b) throw new NotFoundException('Esa persona no está en esta distribución');
      const pa = aPersona(a);
      const pb = aPersona(b);
      if (pa.fecha === pb.fecha) throw new BadRequestException('Las dos personas ya van el mismo día');
      if (pa.sexo !== pb.sexo) throw new BadRequestException('Solo se intercambia con alguien del mismo sexo, para no romper lo equitativo');
      const [na, nb] = [
        await tx.distribucionDiasPersona.update({ where: { id: a.id }, data: { fecha: b.fecha }, select: SELECT_PERSONA }),
        await tx.distribucionDiasPersona.update({ where: { id: b.id }, data: { fecha: a.fecha }, select: SELECT_PERSONA }),
      ];
      return [aPersona(na), aPersona(nb)];
    });
  }

  async quitar(id: string, personaId: string): Promise<{ ok: true }> {
    await this.fila(id, personaId);
    await this.prisma.distribucionDiasPersona.delete({ where: { id: personaId } });
    return { ok: true };
  }

  async reporte(id: string, filtro: ReporteDistribucionInput, formato: FormatoReporteCda): Promise<ArchivoReporte> {
    const d = await this.detalle(id);
    if (filtro.fecha !== undefined) exigirDia(d, filtro.fecha);
    return generarReporte(reporteDistribucion(d, filtro), formato);
  }

  /** Contactos (.vcf) de un día para importarlos en el teléfono y armar el grupo de WhatsApp. */
  async contactos(id: string, fecha: string): Promise<ArchivoReporte> {
    const d = await this.detalle(id);
    exigirDia(d, fecha);
    const { contenido, incluidos } = contactosVcard(d.personas, fecha);
    if (incluidos === 0) throw new BadRequestException('Nadie de ese día tiene un celular válido');
    return {
      nombre: archivoContactosDia(fecha),
      tipo: 'text/vcard; charset=utf-8',
      contenido: Buffer.from(contenido, 'utf8'),
    };
  }

  /**
   * Rehacer el reparto y agregar a mano se hacen de a uno por distribución
   * (candado de PostgreSQL hasta el fin de la transacción): dos "Rehacer"
   * seguidos o un "Agregar" cruzado ya no chocan en la cédula única.
   */
  private conCandado<T>(id: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`distribucion-dias:${id}`}))`;
      return fn(tx);
    });
  }

  private async exigirCargos(claves: string[]): Promise<void> {
    if (claves.length === 0) return;
    const existen = await this.prisma.cargoCda.findMany({ where: { clave: { in: claves } }, select: { clave: true } });
    const faltan = claves.filter((c) => !existen.some((e) => e.clave === c));
    if (faltan.length) throw new BadRequestException(`Cargo inexistente: ${faltan.join(', ').slice(0, 120)}`);
  }

  private async base(id: string): Promise<Distribucion> {
    const d = await this.prisma.distribucionDias.findUnique({ where: { id }, select: { id: true, fechas: true, excluirCargos: true, cantonCpe: true, encargadoCpe: true } });
    if (!d) throw new NotFoundException('Distribución no encontrada');
    return { ...d, fechas: d.fechas.map(dia) };
  }

  private async fila(distribucionId: string, personaId: string) {
    const f = await this.prisma.distribucionDiasPersona.findFirst({ where: { id: personaId, distribucionId }, select: { id: true } });
    if (!f) throw new NotFoundException('Esa persona no está en esta distribución');
    return f;
  }

  /**
   * CPE: el cantón y el encargado de la distribución. CDA: el cantón del
   * recinto de su última pareja y el técnico de ese recinto en el distributivo.
   */
  private async origenes(d: Distribucion, personal: { id: string; cargoCda: { centro: string } }[], avisos: string[]): Promise<Map<string, Origen>> {
    const salida = new Map<string, Origen>();
    const cda: string[] = [];
    for (const p of personal) {
      if (p.cargoCda.centro === 'CPE') salida.set(p.id, { canton: d.cantonCpe, encargado: d.encargadoCpe });
      else cda.push(p.id);
    }
    if (cda.length === 0) return salida;
    const [recintos, tecnicos] = await Promise.all([this.ultimoRecinto(cda), this.tecnicos(avisos)]);
    for (const r of recintos) salida.set(r.operadorId, { canton: r.canton, encargado: tecnicos?.get(r.codigo) ?? null });
    return salida;
  }

  private ultimoRecinto(ids: string[]) {
    return this.prisma.$queryRaw<{ operadorId: string; canton: string; codigo: string }[]>(Prisma.sql`
      SELECT DISTINCT ON (x.oid) x.oid AS "operadorId", c.nombre AS canton, r.codigo_recinto AS codigo
      FROM (
        SELECT operador_cda_id AS oid, recinto_id, fecha, creado_en FROM parejas_cda
        UNION ALL
        SELECT asistente_cda_id, recinto_id, fecha, creado_en FROM parejas_cda
      ) x
      JOIN recintos r ON r.id = x.recinto_id
      JOIN cantones c ON c.id = r.canton_id
      WHERE x.oid = ANY(${ids}::uuid[])
      ORDER BY x.oid, x.fecha DESC, x.creado_en DESC`);
  }

  /** null si el Drive falla: la distribución se arma igual, con el aviso. */
  private async tecnicos(avisos: string[]): Promise<Map<string, string> | null> {
    try {
      return tecnicosPorRecinto(await this.distributivo.asignaciones());
    } catch (e) {
      this.logger.warn(`No se pudo leer el distributivo de técnicos: ${(e as Error).message}`);
      avisos.push(AVISO_DISTRIBUTIVO);
      return null;
    }
  }
}

function exigirDia(d: { fechas: string[] }, fecha: string): void {
  if (!d.fechas.includes(fecha)) throw new BadRequestException('Ese día no es parte de la distribución');
}

function aPersona(f: FilaPersona): PersonaDistribucionDias {
  const o = f.operador;
  return {
    id: f.id,
    fecha: dia(f.fecha),
    operadorId: f.operadorId,
    nombres: o?.apellidosNombres ?? f.nombres ?? '',
    // Si se corrige la cédula en la ficha, se muestra la corregida.
    cedula: o?.cedula ?? f.cedula,
    telefono: (o ? o.telefono : f.telefono) ?? null,
    sexo: normalizarSexo(o ? o.sexo : f.sexo),
    cargo: o?.cargoCda.nombre ?? f.cargo ?? '',
    canton: f.canton,
    encargado: f.encargado,
  };
}
