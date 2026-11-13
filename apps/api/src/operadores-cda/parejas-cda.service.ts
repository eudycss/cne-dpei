import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { CODIGO_RESERVA_PAREJAS_CDA, filaParejaCdaSchema } from '@cne/shared-validation';
import type {
  AplicarParejasCdaResult,
  CampoParejaCda,
  CargarPropuestaParejasCdaRequest,
  CopiarParejasCdaResult,
  DispositivoCda,
  CrearKitConParejaCdaRequest,
  CrearParejaCdaRequest,
  CrearReservasParejaCdaRequest,
  CrearReservasParejaCdaResult,
  DisponiblesParejasCda,
  EditarParejaCdaRequest,
  EditarParejaCdaResult,
  IntegrantesParejaCda,
  EstadoParejaCda,
  FilaImportParejaCda,
  FormatoReporteCda,
  ImportParejasCdaResult,
  Kit,
  MoverDiaParejasCdaResult,
  ParejaCdaFila,
  ParejaReservaCda,
  ParejasCdaDia,
  PersonaParejaCda,
  RecintoParejaCda,
} from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { KitsService } from '../kits/kits.service';
import { parseUploadRows } from '../common/parse-upload-rows';
import { CuentasCdaService } from './cuentas-cda.service';
import { textosGrupo } from './grupo-cda';
import { diaDeFechaDb, diaEcuador, fechaDb } from './dia-ecuador';
import { type ArchivoReporte, generarReporte } from './reporte-cda';
import { reporteParejas } from './reporte-parejas-cda';
import type { FilaTecnico, QuienIngresa } from './reporte-tecnicos-cda';

/** Cargo con el que se registra a quien llega nuevo en la plantilla. */
const CARGO_NUEVO: Record<'OPERADOR' | 'ASISTENTE', string> = {
  OPERADOR: 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - OPERADORES CDA',
  ASISTENTE: 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - ASISTENTES CDA',
};

const PERSONA = { id: true, apellidosNombres: true, cedula: true, telefono: true, dispositivo: true, grupo: true } as const;

/**
 * Regla (2026-11-03): cada pareja es un Operador CDA y, si va, un Asistente
 * CDA; nunca dos operadores ni dos asistentes, tampoco la 2.ª pareja de un
 * recinto. Las parejas anteriores que no la cumplen quedan como historial.
 */
type GrupoPareja = 'OPERADOR' | 'ASISTENTE';
const ROL_DE: Record<GrupoPareja, string> = { OPERADOR: 'operador', ASISTENTE: 'asistente' };

const CON_RELACIONES = {
  recinto: { select: { id: true, codigoRecinto: true, nombre: true, canton: { select: { nombre: true } } } },
  operador: { select: { ...PERSONA, usuarioId: true, activo: true } },
  asistente: { select: { ...PERSONA, usuarioId: true, activo: true } },
  kit: { select: { codigoUnico: true, eventoId: true, operadorId: true, estado: true } },
} satisfies Prisma.ParejaCdaInclude;

type ParejaPrisma = Prisma.ParejaCdaGetPayload<{ include: typeof CON_RELACIONES }>;
/** Pareja con recinto: las de reserva (sin recinto) no van a la app ni reciben kit. */
/** Pareja con recinto: siempre tiene operador (lo exige la base, ck_parejas_cda_operador_o_reserva). */
type ParejaConRelaciones = ParejaPrisma & {
  recintoId: string;
  recinto: NonNullable<ParejaPrisma['recinto']>;
  operadorCdaId: string;
  operador: NonNullable<ParejaPrisma['operador']>;
};
type PersonaDePareja = ParejaConRelaciones['operador'];
type Evento = { id: string; nombre: string };
/** Qué parejas del día pasar a la app: por id o por recinto (todas si no se indica). */
type Filtro = { ids?: string[]; recintos?: string[] };

/** La plantilla es pequeña (~60 parejas): un tope protege a la API de archivos enormes. */
const MAX_FILAS = 300;
const MENSAJE_CONGELADO =
  'Las asignaciones están congeladas: ya inició la jornada. Escriba una justificación para pasar esta pareja a la app.';
const MENSAJE_CONGELADO_KIT =
  'Las asignaciones están congeladas: ya inició la jornada. Escriba una justificación para crear y asignar este kit.';

/** Un kit en estos estados aún no sale de la Delegación: su operador se puede cambiar. */
const EN_DELEGACION = new Set(['EN_BODEGA', 'ASIGNADO']);

const MENSAJE_RESERVA_SIN_KIT = 'Esta pareja es de reserva: asígnele un recinto para darle kit';
const MENSAJE_RESERVA_RECINTO = 'Esta pareja es de reserva: use "Asignar a recinto"';
const MENSAJE_RESERVA_SIN_OPERADOR = 'Esta reserva no tiene operador: complétela con un Operador CDA antes de asignarle un recinto';
const MENSAJE_RESERVA_VACIA = 'La pareja de reserva no puede quedar sin nadie';

/** Recintos de una lista sin los null (parejas de reserva). */
const conRecinto = (ids: (string | null)[]): string[] => ids.filter((id): id is string => !!id);

const vacio = (): AplicarParejasCdaResult => ({ enApp: 0, kitsCreados: 0, sinKit: 0, errores: [] });

/** Ids de los integrantes y del recinto de una pareja (para la bitácora). */
/** Si otra acción le dio un kit a la lista mientras se escribía, se revierte todo en vez de dejar ese kit huérfano. */
function exigirMismaLista(afectadas: number, esperadas: number): void {
  if (afectadas !== esperadas) throw new ConflictException('La lista cambió mientras se procesaba: revísela y vuelva a intentar');
}

const integrantes = (p: IntegrantesParejaCda): IntegrantesParejaCda => ({
  operadorCdaId: p.operadorCdaId,
  asistenteCdaId: p.asistenteCdaId,
  recintoId: p.recintoId,
});

/**
 * Parejas Operador CDA + Asistente CDA por día. Cada día tiene su lista; la
 * lista del día D pasa a la app (kit del recinto asignado al operador) solo
 * si el evento ACTIVO tiene su jornada el día D. La segunda pareja de un
 * mismo recinto y día solo queda registrada.
 */
@Injectable()
export class ParejasCdaService {
  private readonly log = new Logger(ParejasCdaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cuentas: CuentasCdaService,
    private readonly kits: KitsService,
  ) {}

  /** Días que tienen lista, del más reciente al más antiguo. */
  async fechas(): Promise<string[]> {
    const filas = await this.prisma.parejaCda.findMany({ distinct: ['fecha'], select: { fecha: true }, orderBy: { fecha: 'desc' } });
    return filas.map((f) => diaDeFechaDb(f.fecha));
  }

  async listar(fecha: string): Promise<ParejasCdaDia> {
    const [evento, parejas, reserva] = await Promise.all([this.eventoDeFecha(fecha), this.parejasDelDia(fecha), this.reservaDelDia(fecha)]);
    const porRecinto = parejasPorRecinto(parejas);
    const recintosSinPareja = await this.prisma.recinto.findMany({
      where: { tipo: 'CDA', activo: true, id: { notIn: [...porRecinto.keys()] } },
      select: { id: true, codigoRecinto: true, nombre: true },
      orderBy: { nombre: 'asc' },
    });
    return {
      fecha,
      evento,
      congelado: !!evento && this.kits.estaCongelado({ estado: 'ACTIVO', fechaJornada: fechaDb(fecha) }),
      parejas: parejas
        .map((p) => aFila(p, evento, portadorDe(p), porRecinto.get(p.recintoId) ?? 1))
        .sort((a, b) => a.recinto.nombre.localeCompare(b.recinto.nombre, 'es') || a.operador.apellidosNombres.localeCompare(b.operador.apellidosNombres, 'es')),
      reserva,
      recintosSinPareja: recintosSinPareja.map(aRecinto),
    };
  }

  /**
   * La lista del día con quién tiene de verdad el kit de cada pareja (para el
   * reporte por técnico: esa persona es la que ingresa a la app).
   */
  async listarConIngreso(fecha: string): Promise<{ dia: ParejasCdaDia; filas: FilaTecnico[] }> {
    const [dia, parejas] = await Promise.all([this.listar(fecha), this.parejasDelDia(fecha)]);
    const porId = new Map(parejas.map((p) => [p.id, p]));
    return {
      dia,
      filas: dia.parejas.map((fila) => {
        const p = porId.get(fila.id);
        const delRecinto = p ? parejas.filter((x) => x.recintoId === p.recintoId) : [];
        return { pareja: fila, ...quienTieneElKit(p, delRecinto, dia.evento) };
      }),
    };
  }

  /**
   * Lo que se puede elegir para una pareja nueva. Por defecto se ocultan las
   * personas y recintos que ya estuvieron en cualquier lista; con `todos`
   * solo quien ya tiene pareja ese mismo día (no puede tener dos).
   */
  async disponibles(fecha: string, todos: boolean): Promise<DisponiblesParejasCda> {
    const usadas = await this.prisma.parejaCda.findMany({
      where: todos ? { fecha: fechaDb(fecha) } : {},
      select: { fecha: true, operadorCdaId: true, asistenteCdaId: true, recintoId: true },
    });
    const personas = [...new Set(usadas.flatMap((u) => [u.operadorCdaId, u.asistenteCdaId]).filter((id): id is string => !!id))];
    const recintos = todos ? [] : [...new Set(conRecinto(usadas.map((u) => u.recintoId)))];
    const sinEstos = (ids: string[]) => (ids.length ? { id: { notIn: ids } } : {});

    const [operadores, asistentes, listaRecintos] = await Promise.all([
      this.prisma.operadorCda.findMany({
        where: { grupo: 'OPERADOR', activo: true, ...sinEstos(personas) },
        select: PERSONA,
        orderBy: { apellidosNombres: 'asc' },
      }),
      this.prisma.operadorCda.findMany({
        where: { grupo: 'ASISTENTE', activo: true, ...sinEstos(personas) },
        select: PERSONA,
        orderBy: { apellidosNombres: 'asc' },
      }),
      this.prisma.recinto.findMany({
        where: { tipo: 'CDA', activo: true, ...sinEstos(recintos) },
        select: { id: true, codigoRecinto: true, nombre: true },
        orderBy: { nombre: 'asc' },
      }),
    ]);
    return { operadores: operadores.map(aPersona), asistentes: asistentes.map(aPersona), recintos: listaRecintos.map(aRecinto) };
  }

  async crear(datos: CrearParejaCdaRequest, usuarioId: string): Promise<AplicarParejasCdaResult> {
    await this.validarIntegrantes(datos.operadorCdaId, datos.asistenteCdaId ?? null);
    await this.validarRecinto(datos.recintoId);
    await this.libresEseDia(fechaDb(datos.fecha), datos.fecha, datos.operadorCdaId, datos.asistenteCdaId ?? null);
    const articulos = datos.articulos?.trim() || null;
    if (articulos) await this.detalleDeArticulos(articulos);

    const creada = await this.guardar(datos.fecha, () =>
      this.prisma.parejaCda.create({
        data: {
          fecha: fechaDb(datos.fecha),
          operadorCdaId: datos.operadorCdaId,
          asistenteCdaId: datos.asistenteCdaId ?? null,
          recintoId: datos.recintoId,
          articulos,
          creadoPorId: usuarioId,
        },
      }),
    );
    return (await this.aplicarDia(datos.fecha, { ids: [creada.id] }, datos.justificacion)) ?? vacio();
  }

  /**
   * Cambia integrantes o recinto. Si cambia el operador, el kit del recinto
   * pasa al nuevo. Si cambia el recinto, el kit anterior queda en su recinto
   * sin operador (su QR impreso no cambia); antes de guardar se comprueba
   * que se pueda soltar, y se suelta solo si el cambio se guardó.
   * Con `aReserva`, quien sale (operador o asistente reemplazado o quitado)
   * queda en una pareja de reserva solo con él o ella; si no, queda libre.
   */
  async editar(
    id: string,
    datos: Omit<EditarParejaCdaRequest, 'saleAReserva' | 'justificacion'>,
    justificacion?: string,
    opciones: { aReserva?: boolean; usuarioId?: string } = {},
  ): Promise<EditarParejaCdaResult> {
    const actual = await this.leerPareja(id);
    const operadorCdaId = datos.operadorCdaId ?? actual.operadorCdaId;
    const asistenteCdaId = datos.asistenteCdaId === undefined ? actual.asistenteCdaId : datos.asistenteCdaId;
    // Solo se valida a quien entra: una pareja anterior a la regla (historial)
    // puede cambiar de recinto o del integrante que no cumple, sin bloquearse.
    if (operadorCdaId && operadorCdaId === asistenteCdaId) throw new BadRequestException('Elija dos personas distintas para la pareja');
    // Una reserva puede ir incompleta, pero no vacía.
    if (!operadorCdaId && !asistenteCdaId) throw new BadRequestException(MENSAJE_RESERVA_VACIA);
    await this.validarIntegrantes(
      operadorCdaId !== actual.operadorCdaId ? operadorCdaId : null,
      asistenteCdaId !== actual.asistenteCdaId ? asistenteCdaId : null,
    );
    // Los únicos de la base son por columna: aquí se mira también la otra columna.
    await this.libresEseDia(actual.fecha, diaDeFechaDb(actual.fecha), operadorCdaId, asistenteCdaId, id);
    // Una pareja de reserva recibe recinto solo con "Asignar a recinto" (puede intercambiarse con la titular).
    if (!actual.recintoId && datos.recintoId) throw new BadRequestException(MENSAJE_RESERVA_RECINTO);
    if (!operadorCdaId && datos.recintoId) throw new BadRequestException(MENSAJE_RESERVA_SIN_OPERADOR);
    const cambiaRecinto = !!datos.recintoId && datos.recintoId !== actual.recintoId;
    if (cambiaRecinto) await this.validarRecinto(datos.recintoId as string);
    await this.quienLlevaKitSalidoSeQueda(actual, operadorCdaId, asistenteCdaId, cambiaRecinto);

    const kitAnterior = cambiaRecinto ? await this.kitDelOperador(actual) : null;
    if (kitAnterior) await this.kits.quitarOperador(kitAnterior, justificacion, true);

    const fecha = diaDeFechaDb(actual.fecha);
    // Quien sale va a la columna de su cargo (no a la de donde estaba: una pareja
    // anterior a la regla puede tener a un asistente como operador).
    const enSuColumna = (personaId: string, grupo: string | undefined) =>
      grupo === 'ASISTENTE' ? { operadorCdaId: null, asistenteCdaId: personaId } : { operadorCdaId: personaId, asistenteCdaId: null };
    const salen = [
      ...(actual.operadorCdaId && actual.operadorCdaId !== operadorCdaId ? [enSuColumna(actual.operadorCdaId, actual.operador?.grupo)] : []),
      ...(actual.asistenteCdaId && actual.asistenteCdaId !== asistenteCdaId ? [enSuColumna(actual.asistenteCdaId, actual.asistente?.grupo)] : []),
    ];
    const reservas = opciones.aReserva ? salen : [];
    // La pareja y las reservas de quien sale se guardan juntas: o todo o nada.
    await this.guardar(fecha, () =>
      this.prisma.$transaction(async (tx) => {
        await tx.parejaCda.update({
          where: { id },
          data: {
            operadorCdaId,
            asistenteCdaId,
            ...(cambiaRecinto && { recintoId: datos.recintoId, kitId: null }),
          },
        });
        for (const r of reservas) {
          await tx.parejaCda.create({
            data: { fecha: actual.fecha, ...r, recintoId: null, articulos: null, creadoPorId: opciones.usuarioId ?? null },
          });
        }
      }),
    );
    if (kitAnterior) await this.kits.quitarOperador(kitAnterior, justificacion);
    const recintos = conRecinto([actual.recintoId, ...(cambiaRecinto ? [datos.recintoId as string] : [])]);
    const resultado = (await this.aplicarDia(fecha, { recintos }, justificacion)) ?? vacio();
    return {
      ...resultado,
      cambio: {
        antes: integrantes(actual),
        despues: { operadorCdaId, asistenteCdaId, recintoId: cambiaRecinto ? (datos.recintoId as string) : actual.recintoId },
        aReserva: reservas.map((r) => (r.operadorCdaId ?? r.asistenteCdaId) as string),
      },
    };
  }

  /**
   * Botón "Asignar kit" de una fila: pasa a la app solo esa pareja (su kit, uno
   * libre del recinto o uno nuevo). Las reglas son las de "Aplicar a la app":
   * evento del día, congelamiento, 1 operador = 1 recinto; lo que falle vuelve en `errores`.
   */
  async asignarKit(id: string, justificacion?: string): Promise<AplicarParejasCdaResult> {
    const p = await this.leerPareja(id);
    if (!p.recintoId) throw new BadRequestException(MENSAJE_RESERVA_SIN_KIT);
    const fecha = diaDeFechaDb(p.fecha);
    const r = await this.aplicarDia(fecha, { ids: [id] }, justificacion);
    if (!r) throw new BadRequestException(`No hay un evento ACTIVO con jornada el ${fecha}: active ese evento para asignar el kit`);
    return r;
  }

  /**
   * Copia la lista de `desde` a `hacia` (mismo operador, asistente, recinto y
   * artículos), con sus parejas de reserva. Solo la registra: el kit y la app quedan para "Aplicar a la
   * app", así se puede revisar antes. Omite a quien ya tiene pareja ese día
   * o está oculto, y dice por qué.
   */
  async copiar(desde: string, hacia: string, usuarioId: string): Promise<CopiarParejasCdaResult> {
    if (desde === hacia) throw new BadRequestException('Elija un día distinto');
    const origen = await this.prisma.parejaCda.findMany({
      where: { fecha: fechaDb(desde) },
      include: {
        recinto: { select: { codigoRecinto: true } },
        operador: { select: { apellidosNombres: true } },
        asistente: { select: { apellidosNombres: true } },
      },
      orderBy: { creadoEn: 'asc' },
    });
    if (!origen.length) throw new BadRequestException(`El ${desde} no tiene parejas para copiar`);
    const destino = await this.prisma.parejaCda.findMany({
      where: { fecha: fechaDb(hacia) },
      select: { operadorCdaId: true, asistenteCdaId: true },
    });
    const ocupadas = new Set(destino.flatMap((d) => [d.operadorCdaId, d.asistenteCdaId]).filter((id): id is string => !!id));
    const personas = [...new Set(origen.flatMap((p) => [p.operadorCdaId, p.asistenteCdaId]).filter((id): id is string => !!id))];
    // Activas con su cargo: no se copia a nadie fuera del cargo de su columna.
    const activas = new Map(
      (
        await this.prisma.operadorCda.findMany({
          where: { id: { in: personas }, activo: true },
          select: { id: true, grupo: true },
        })
      ).map((o) => [o.id, o.grupo] as const),
    );
    const recintosOrigen = [...new Set(conRecinto(origen.map((p) => p.recintoId)))];
    const recintosActivos = new Set(
      (
        await this.prisma.recinto.findMany({ where: { id: { in: recintosOrigen }, activo: true, tipo: 'CDA' }, select: { id: true } })
      ).map((r) => r.id),
    );

    const omitidas: CopiarParejasCdaResult['omitidas'] = [];
    const data: Prisma.ParejaCdaCreateManyInput[] = [];
    // Mismo orden que el día de origen (decide qué pareja va a la app en un recinto con dos).
    const base = Date.now();
    for (const p of origen) {
      const motivo = p.recintoId && !recintosActivos.has(p.recintoId)
        ? 'El recinto ya no está activo'
        : p.operadorCdaId && activas.get(p.operadorCdaId) !== 'OPERADOR'
          ? 'El operador ya no está disponible (oculto o no es Operador CDA)'
          : p.operadorCdaId && ocupadas.has(p.operadorCdaId)
            ? 'El operador ya tiene pareja ese día'
            : p.asistenteCdaId && activas.get(p.asistenteCdaId) !== 'ASISTENTE'
              ? 'El asistente ya no está disponible (oculto o no es Asistente CDA)'
              : p.asistenteCdaId && ocupadas.has(p.asistenteCdaId)
                ? 'El asistente ya tiene pareja ese día'
                : null;
      if (motivo) {
        const quien = p.operador?.apellidosNombres ?? p.asistente?.apellidosNombres ?? '';
        omitidas.push({ pareja: `${quien} · ${p.recinto?.codigoRecinto ?? 'Reserva'}`, motivo });
        continue;
      }
      if (p.operadorCdaId) ocupadas.add(p.operadorCdaId);
      if (p.asistenteCdaId) ocupadas.add(p.asistenteCdaId);
      data.push({
        fecha: fechaDb(hacia),
        recintoId: p.recintoId,
        operadorCdaId: p.operadorCdaId,
        asistenteCdaId: p.asistenteCdaId,
        articulos: p.articulos,
        creadoPorId: usuarioId,
        creadoEn: new Date(base + data.length),
      });
    }
    if (data.length) await this.guardar(hacia, () => this.prisma.parejaCda.createMany({ data }));
    return { copiadas: data.length, omitidas };
  }

  /** Cambia la fecha de toda la lista. El día nuevo debe estar vacío y sin jornada real. */
  async moverDia(desde: string, hacia: string): Promise<MoverDiaParejasCdaResult> {
    if (desde === hacia) throw new BadRequestException('Elija un día distinto');
    // En un día pasado aparecerían como faltas de personas que nunca estuvieron convocadas.
    if (hacia < diaEcuador()) throw new BadRequestException('No se puede mover una lista a un día pasado');
    const movidas = await this.guardar(hacia, () =>
      this.prisma.$transaction(async (tx) => {
        const parejas = await this.listaEditable(tx, desde);
        await this.exigirSinJornada(tx, hacia);
        if (await tx.parejaCda.count({ where: { fecha: fechaDb(hacia) } })) {
          throw new ConflictException(`El ${hacia} ya tiene una lista: elija otro día o bórrela primero`);
        }
        const { count } = await tx.parejaCda.updateMany({ where: { fecha: fechaDb(desde), kitId: null }, data: { fecha: fechaDb(hacia) } });
        exigirMismaLista(count, parejas.length);
        return count;
      }),
    );
    return { movidas };
  }

  /** Borra la lista de un día. Devuelve cómo estaba, para la bitácora (la respuesta HTTP va vacía). */
  async borrarDia(fecha: string): Promise<{ fecha: string; eliminadas: number; parejas: IntegrantesParejaCda[] }> {
    return this.prisma.$transaction(async (tx) => {
      const parejas = await this.listaEditable(tx, fecha);
      const { count } = await tx.parejaCda.deleteMany({ where: { fecha: fechaDb(fecha), kitId: null } });
      exigirMismaLista(count, parejas.length);
      return { fecha, eliminadas: parejas.length, parejas: parejas.map(integrantes) };
    });
  }

  /** Una lista con kits, jornada real o asistencia es historial y cadena de custodia: no se mueve ni se borra. */
  private async listaEditable(tx: Prisma.TransactionClient, fecha: string) {
    const parejas = await tx.parejaCda.findMany({
      where: { fecha: fechaDb(fecha) },
      select: {
        operadorCdaId: true,
        asistenteCdaId: true,
        recintoId: true,
        kitId: true,
        operador: { select: { usuarioId: true } },
        asistente: { select: { usuarioId: true } },
      },
    });
    if (!parejas.length) throw new BadRequestException(`El ${fecha} no tiene parejas`);
    const conKit = `La lista del ${fecha} ya tiene kits asignados: no se puede mover ni borrar`;
    if (parejas.some((p) => p.kitId)) throw new ConflictException(conKit);
    const eventos = await this.exigirSinJornada(tx, fecha);

    // Un kit asignado a mano (página Kits) queda en la persona, sin kit_id en la pareja.
    const usuarios = parejas.flatMap((p) => [p.operador?.usuarioId, p.asistente?.usuarioId]).filter((id): id is string => !!id);
    if (eventos.length && usuarios.length) {
      const kit = await tx.kitElectoral.findFirst({ where: { eventoId: { in: eventos }, operadorId: { in: usuarios } }, select: { id: true } });
      if (kit) throw new ConflictException(conKit);
    }
    // Quien va en la lista está convocado: cambiarla reescribiría las faltas y atrasos de ese día.
    const personas = parejas.flatMap((p) => [p.operadorCdaId, p.asistenteCdaId]).filter((id): id is string => !!id);
    if (await tx.asistenciaCda.count({ where: { fecha: fechaDb(fecha), operadorId: { in: personas } } })) {
      throw new ConflictException(`La lista del ${fecha} ya tiene asistencia registrada: no se puede mover ni borrar`);
    }
    return parejas;
  }

  /** Rechaza el día con jornada iniciada o cerrada; devuelve los eventos de esa fecha. */
  private async exigirSinJornada(tx: Prisma.TransactionClient, fecha: string): Promise<string[]> {
    const eventos = await tx.eventoElectoral.findMany({
      where: { fechaJornada: fechaDb(fecha) },
      select: { id: true, estado: true, fechaJornada: true },
    });
    if (eventos.some((e) => e.estado === 'CERRADO' || this.kits.estaCongelado(e))) {
      throw new ConflictException(`El ${fecha} tiene una jornada iniciada o cerrada: esa lista es historial y no se puede cambiar`);
    }
    return eventos.map((e) => e.id);
  }

  /** Pasa a reserva, cada una por su cuenta, a personas sin pareja ese día; luego se unen con "Completar". */
  async crearReservas(datos: CrearReservasParejaCdaRequest, usuarioId: string): Promise<CrearReservasParejaCdaResult> {
    const ids = [...datos.operadores, ...datos.asistentes];
    const personas = new Map(
      (await this.prisma.operadorCda.findMany({ where: { id: { in: ids } }, select: { id: true, grupo: true, activo: true } })).map(
        (p) => [p.id, p] as const,
      ),
    );
    const vigente = (grupo: GrupoPareja) => (id: string) => personas.get(id)?.activo === true && personas.get(id)?.grupo === grupo;
    if (!datos.operadores.every(vigente('OPERADOR')) || !datos.asistentes.every(vigente('ASISTENTE'))) {
      throw new BadRequestException('Alguna persona elegida ya no está disponible o cambió de cargo: actualice la lista');
    }
    const fecha = fechaDb(datos.fecha);
    const ocupada = await this.prisma.parejaCda.findFirst({
      where: { fecha, OR: [{ operadorCdaId: { in: ids } }, { asistenteCdaId: { in: ids } }] },
      select: { id: true },
    });
    if (ocupada) throw new ConflictException(`Alguna persona elegida ya tiene pareja o reserva el ${datos.fecha}: actualice la lista`);

    // El orden de creación es el orden en que salen en la pestaña Reserva.
    const base = Date.now();
    const data: Prisma.ParejaCdaCreateManyInput[] = [
      ...datos.operadores.map((id) => ({ operadorCdaId: id, asistenteCdaId: null })),
      ...datos.asistentes.map((id) => ({ operadorCdaId: null, asistenteCdaId: id })),
    ].map((integrantes, i) => ({ ...integrantes, fecha, recintoId: null, creadoPorId: usuarioId, creadoEn: new Date(base + i) }));
    await this.guardar(datos.fecha, () => this.prisma.parejaCda.createMany({ data }));
    return { creadas: data.length };
  }

  /**
   * Intercambia el operador, el asistente o el recinto entre dos parejas del
   * mismo día. Si cambian operador o recinto, los kits de las dos se sueltan
   * y se vuelven a asignar según la nueva lista; si alguno ya salió de la
   * Delegación no se cambia nada (cadena de custodia).
   */
  async intercambiar(id: string, conId: string, campo: CampoParejaCda, justificacion?: string): Promise<AplicarParejasCdaResult> {
    if (id === conId) throw new BadRequestException('Elija otra pareja para intercambiar');
    const [a, b] = await Promise.all([this.leerPareja(id), this.leerPareja(conId)]);
    const fecha = diaDeFechaDb(a.fecha);
    if (fecha !== diaDeFechaDb(b.fecha)) throw new BadRequestException('Las dos parejas deben ser del mismo día');

    if (campo === 'ASISTENTE' && a.asistenteCdaId === b.asistenteCdaId) throw new BadRequestException('Las dos parejas ya tienen ese asistente');
    if (campo === 'RECINTO' && !a.recintoId && !b.recintoId) throw new BadRequestException('Las dos parejas son de reserva');
    if (campo === 'RECINTO' && a.recintoId === b.recintoId) throw new BadRequestException('Las dos parejas ya tienen ese recinto');
    // Una reserva sin operador solo cambia de asistente, y sin quedar vacía.
    if (campo !== 'ASISTENTE' && (!a.operadorCdaId || !b.operadorCdaId)) throw new BadRequestException(MENSAJE_RESERVA_SIN_OPERADOR);
    if (campo === 'ASISTENTE' && ((!a.operadorCdaId && !b.asistenteCdaId) || (!b.operadorCdaId && !a.asistenteCdaId))) {
      throw new BadRequestException(MENSAJE_RESERVA_VACIA);
    }
    // El intercambio libera un asistente por un instante: dos reservas sin operador quedarían vacías.
    if (campo === 'ASISTENTE' && !a.operadorCdaId && !b.operadorCdaId) {
      throw new BadRequestException('Las dos reservas no tienen operador: complete una antes de intercambiar sus asistentes');
    }
    // Una pareja anterior a la regla (dos operadores o dos asistentes) no pasa a nadie fuera de su cargo.
    if (campo !== 'RECINTO') {
      const grupo: GrupoPareja = campo;
      const personas = grupo === 'OPERADOR' ? [a.operador, b.operador] : [a.asistente, b.asistente];
      const fuera = personas.find((p) => p && p.grupo !== grupo);
      if (fuera) throw new BadRequestException(`${fuera.apellidosNombres} es de ${textosGrupo(fuera.grupo).titulo}: no puede ir como ${ROL_DE[grupo]} (cada pareja es un Operador y un Asistente CDA)`);
    }

    const evento = await this.eventoDeFecha(fecha);
    if (evento && this.kits.estaCongelado({ estado: 'ACTIVO', fechaJornada: fechaDb(fecha) }) && !justificacion?.trim()) {
      throw new BadRequestException(MENSAJE_CONGELADO);
    }
    // Al cambiar asistentes (u operadores), un kit que ya salió con el otro integrante se queda con él.
    const seMueven =
      campo === 'ASISTENTE'
        ? [a.asistente?.usuarioId, b.asistente?.usuarioId]
        : campo === 'OPERADOR'
          ? [a.operador?.usuarioId, b.operador?.usuarioId]
          : undefined;
    const kits = evento ? await this.kitsASoltar(evento.id, [a.kitId, b.kitId], seMueven) : [];
    for (const k of kits) await this.kits.quitarOperador(k, justificacion, true);
    // El kit es del recinto: cada pareja se lleva el vínculo con el kit de su
    // nuevo recinto (así, en un recinto con dos parejas, no se va a la otra).
    // Cambiar asistentes también se reaplica: puede cambiar quién tiene Android (y lleva el kit).
    if (campo === 'ASISTENTE') {
      // Se libera primero el asistente de la que tiene operador: así nunca queda una sin nadie (CHECK de la base).
      const [primera, segunda] = a.operadorCdaId ? [a, b] : [b, a];
      await this.intercambiarAsistentes(fecha, primera, segunda);
    } else if (campo === 'RECINTO') {
      await this.guardar(fecha, () =>
        this.prisma.$transaction(async (tx) => {
          await tx.parejaCda.update({ where: { id: a.id }, data: { recintoId: b.recintoId, kitId: b.kitId } });
          await tx.parejaCda.update({ where: { id: b.id }, data: { recintoId: a.recintoId, kitId: a.kitId } });
        }),
      );
    } else {
      // Cambiar los operadores equivale a cambiar todo lo demás: así ningún
      // operador queda dos veces en el día, ni por un instante.
      await this.intercambiarAsistentes(fecha, a, b, (p) => ({ recintoId: p.recintoId, articulos: p.articulos, kitId: p.kitId }));
    }
    for (const k of kits) await this.kits.quitarOperador(k, justificacion);
    return (await this.aplicarDia(fecha, { recintos: conRecinto([a.recintoId, b.recintoId]) }, justificacion)) ?? vacio();
  }

  /**
   * Cambia los asistentes de dos parejas (y `extra` de la otra). El asistente
   * es único por día: se libera primero el de `a`, todo en una transacción.
   */
  private intercambiarAsistentes<P extends { id: string; asistenteCdaId: string | null }>(
    fecha: string,
    a: P,
    b: P,
    extra: (de: P) => Prisma.ParejaCdaUncheckedUpdateInput = () => ({}),
  ) {
    return this.guardar(fecha, () =>
      this.prisma.$transaction(async (tx) => {
        await tx.parejaCda.update({ where: { id: a.id }, data: { asistenteCdaId: null } });
        await tx.parejaCda.update({ where: { id: b.id }, data: { asistenteCdaId: a.asistenteCdaId, ...extra(a) } });
        await tx.parejaCda.update({ where: { id: a.id }, data: { asistenteCdaId: b.asistenteCdaId, ...extra(b) } });
      }),
    );
  }

  /**
   * Kits del evento (el activo de ese día) que hay que soltar; si alguno ya
   * salió de la Delegación, 409 aunque no tenga operador (es conservador).
   * Con `seMueven` (usuarios que cambian de pareja), un kit que salió con
   * otra persona no impide el cambio: se queda con ella y no se suelta.
   */
  private async kitsASoltar(eventoId: string, ids: (string | null)[], seMueven?: (string | null | undefined)[]): Promise<string[]> {
    const conKit = ids.filter((k): k is string => !!k);
    if (!conKit.length) return [];
    const kits = await this.prisma.kitElectoral.findMany({
      where: { id: { in: conKit }, eventoId },
      select: { id: true, codigoUnico: true, estado: true, operadorId: true },
    });
    const salidos = kits.filter((k) => !EN_DELEGACION.has(k.estado));
    const bloquea = salidos.find((k) => !seMueven || !k.operadorId || seMueven.includes(k.operadorId));
    if (bloquea) throw new ConflictException(`El kit ${bloquea.codigoUnico} ya salió de la Delegación: no se puede cambiar su pareja`);
    return kits.filter((k) => k.operadorId && EN_DELEGACION.has(k.estado)).map((k) => k.id);
  }

  /**
   * Quien lleva un kit (del evento de ese día) que ya salió de la Delegación
   * sigue en la pareja: cadena de custodia. Al otro integrante sí se lo cambia.
   */
  private async quienLlevaKitSalidoSeQueda(
    actual: Awaited<ReturnType<ParejasCdaService['leerPareja']>>,
    operadorCdaId: string | null,
    asistenteCdaId: string | null,
    cambiaRecinto: boolean,
  ): Promise<void> {
    const kit = actual.kit;
    if (!kit?.estado || EN_DELEGACION.has(kit.estado)) return;
    const evento = await this.eventoDeFecha(diaDeFechaDb(actual.fecha));
    if (kit.eventoId !== evento?.id) return;
    if (cambiaRecinto) {
      throw new ConflictException(`El kit ${kit.codigoUnico} ya salió de la Delegación hacia su recinto: no se puede cambiar el recinto`);
    }
    if (!kit.operadorId) return;
    const sale =
      (actual.operador && kit.operadorId === actual.operador.usuarioId && operadorCdaId !== actual.operadorCdaId && actual.operador) ||
      (kit.operadorId === actual.asistente?.usuarioId && asistenteCdaId !== actual.asistenteCdaId && actual.asistente);
    if (sale) {
      throw new ConflictException(
        `${sale.apellidosNombres} lleva el kit ${kit.codigoUnico}, que ya salió de la Delegación: no se puede cambiar. Puede cambiar al otro integrante.`,
      );
    }
  }

  /**
   * Quita la pareja. Si su operador tenía el kit (evento activo), el kit queda
   * en su recinto sin operador; si eso no se puede (kit ya salió, jornada sin
   * justificación), la pareja no se borra. La siguiente pareja del mismo
   * recinto, si la hay, pasa a la app.
   */
  /** Devuelve cómo estaba la pareja, para la bitácora (la respuesta HTTP va vacía). */
  async eliminar(id: string, justificacion?: string): Promise<IntegrantesParejaCda> {
    const actual = await this.leerPareja(id);
    const kit = await this.kitDelOperador(actual);
    if (kit) await this.kits.quitarOperador(kit, justificacion);
    await this.prisma.parejaCda.delete({ where: { id } });
    await this.aplicarDia(diaDeFechaDb(actual.fecha), { recintos: conRecinto([actual.recintoId]) }, justificacion);
    return integrantes(actual);
  }

  /**
   * "Pasar a reserva": la pareja deja su recinto y queda registrada sin él.
   * Como al quitarla, su kit queda en el recinto sin operador (si ya salió de
   * la Delegación no se cambia nada) y otra pareja del recinto, si la hay,
   * pasa a la app.
   */
  async pasarAReserva(id: string, justificacion?: string): Promise<AplicarParejasCdaResult> {
    const actual = await this.leerPareja(id);
    const recintoId = actual.recintoId;
    if (!recintoId) throw new BadRequestException('Esta pareja ya es de reserva');
    await this.quienLlevaKitSalidoSeQueda(actual, actual.operadorCdaId, actual.asistenteCdaId, true);
    const kit = await this.kitDelOperador(actual);
    if (kit) await this.kits.quitarOperador(kit, justificacion, true);
    // Condicional: con doble clic o dos administradores a la vez, solo uno la pasa.
    const { count } = await this.prisma.parejaCda.updateMany({ where: { id, recintoId }, data: { recintoId: null, kitId: null } });
    if (count !== 1) throw new ConflictException('La pareja cambió mientras tanto: recargue la lista');
    if (kit) await this.kits.quitarOperador(kit, justificacion);
    return (await this.aplicarDia(diaDeFechaDb(actual.fecha), { recintos: [recintoId] }, justificacion)) ?? vacio();
  }

  /**
   * "Asignar a recinto" de una pareja de reserva. Si el recinto ya tiene la
   * pareja que va a la app, se intercambian: esa pasa a reserva y le cede su
   * kit. Si está libre, la pareja pasa a la app como al agregarla.
   */
  async asignarRecinto(id: string, recintoId: string, justificacion?: string): Promise<AplicarParejasCdaResult> {
    const p = await this.leerPareja(id);
    if (p.recintoId) throw new BadRequestException('Esta pareja ya tiene recinto: use "Cambiar" o "Pasar a reserva"');
    // En un recinto el kit va al operador.
    if (!p.operadorCdaId) throw new BadRequestException(MENSAJE_RESERVA_SIN_OPERADOR);
    await this.validarRecinto(recintoId);
    const fecha = diaDeFechaDb(p.fecha);
    // Cede su lugar (y su kit) la primera del recinto por nombre del operador: la que la web muestra como "ocupado por".
    const titular = (await this.parejasDelDia(fecha))
      .filter((x) => x.recintoId === recintoId)
      .sort((a, b) => a.operador.apellidosNombres.localeCompare(b.operador.apellidosNombres, 'es'))[0];
    if (titular) return this.intercambiar(id, titular.id, 'RECINTO', justificacion);
    // Condicional: con doble clic o dos administradores a la vez, solo uno la ubica.
    const { count } = await this.prisma.parejaCda.updateMany({ where: { id, recintoId: null }, data: { recintoId } });
    if (count !== 1) throw new ConflictException('Esta pareja ya recibió un recinto (otro pedido llegó primero): recargue la lista');
    return (await this.aplicarDia(fecha, { ids: [id] }, justificacion)) ?? vacio();
  }

  /**
   * Para "Nuevo kit" de la página Kits: operadores y asistentes sin pareja en
   * la jornada del evento ni kit en el evento, y recintos CDA sin kit real.
   */
  async disponiblesParaKit(eventoId: string): Promise<DisponiblesParejasCda> {
    const evento = await this.eventoPorId(eventoId);
    const [parejas, kitsEvento] = await Promise.all([
      this.prisma.parejaCda.findMany({ where: { fecha: evento.fechaJornada }, select: { operadorCdaId: true, asistenteCdaId: true } }),
      this.prisma.kitElectoral.findMany({ where: { eventoId, esPrueba: false }, select: { recintoId: true, operadorId: true } }),
    ]);
    const conPareja = [...new Set(parejas.flatMap((p) => [p.operadorCdaId, p.asistenteCdaId]).filter((id): id is string => !!id))];
    const usuariosConKit = [...new Set(kitsEvento.map((k) => k.operadorId).filter((id): id is string => !!id))];
    const recintosConKit = [...new Set(kitsEvento.map((k) => k.recintoId).filter((id): id is string => !!id))];
    const libre = {
      activo: true,
      ...(conPareja.length > 0 && { id: { notIn: conPareja } }),
      ...(usuariosConKit.length > 0 && { OR: [{ usuarioId: null }, { usuarioId: { notIn: usuariosConKit } }] }),
    };
    const [operadores, asistentes, recintos] = await Promise.all([
      this.prisma.operadorCda.findMany({ where: { grupo: 'OPERADOR', ...libre }, select: PERSONA, orderBy: { apellidosNombres: 'asc' } }),
      this.prisma.operadorCda.findMany({ where: { grupo: 'ASISTENTE', ...libre }, select: PERSONA, orderBy: { apellidosNombres: 'asc' } }),
      this.prisma.recinto.findMany({
        where: { tipo: 'CDA', activo: true, ...(recintosConKit.length > 0 && { id: { notIn: recintosConKit } }) },
        select: { id: true, codigoRecinto: true, nombre: true },
        orderBy: { nombre: 'asc' },
      }),
    ]);
    return { operadores: operadores.map(aPersona), asistentes: asistentes.map(aPersona), recintos: recintos.map(aRecinto) };
  }

  /**
   * "Nuevo kit" en un paso: crea el kit del recinto (sin artículos, los del
   * catálogo), lo asigna al operador y registra la pareja en la fecha de la
   * jornada del evento. Si algo falla después de crear el kit, se borra: es
   * nuevo y no tiene historial.
   */
  async crearKitConPareja(datos: CrearKitConParejaCdaRequest, usuarioId: string): Promise<Kit> {
    const evento = await this.eventoPorId(datos.eventoId);
    const dia = diaDeFechaDb(evento.fechaJornada);
    const asistenteCdaId = datos.asistenteCdaId ?? null;
    await this.validarIntegrantes(datos.operadorCdaId, asistenteCdaId);
    const recinto = await this.validarRecinto(datos.recintoId);
    await this.libresEseDia(evento.fechaJornada, dia, datos.operadorCdaId, asistenteCdaId);
    const justificacion = datos.justificacion?.trim() || undefined;
    if (this.kits.estaCongelado(evento) && !justificacion) {
      throw new BadRequestException({ message: MENSAJE_CONGELADO_KIT, frozen: true });
    }
    // El kit (la app y el nombre del QR) va a quien tiene Android: el operador, o el asistente si solo él lo tiene.
    const datosDe = (id: string) => this.prisma.operadorCda.findUnique({ where: { id }, select: { usuarioId: true, dispositivo: true } });
    const [operador, asistente] = await Promise.all([datosDe(datos.operadorCdaId), asistenteCdaId ? datosDe(asistenteCdaId) : null]);
    const alAsistente = !!asistenteCdaId && operador?.dispositivo !== 'ANDROID' && asistente?.dispositivo === 'ANDROID';
    const cuenta = alAsistente
      ? (asistente?.usuarioId ?? (await this.crearCuentaOperador(asistenteCdaId as string)))
      : (operador?.usuarioId ?? (await this.crearCuentaOperador(datos.operadorCdaId)));

    const nuevo = await this.kits.create({
      eventoId: evento.id,
      nombre: `${recinto.codigoRecinto} — ${recinto.nombre}`,
      recintoId: datos.recintoId,
      ...(datos.detalleItems && { detalleItems: datos.detalleItems }),
      ...(datos.otroDispositivo && { otroDispositivo: true }),
    });
    try {
      const kit = await this.kits.asignar(nuevo.id, justificacion ? { operadorId: cuenta, justificacion } : { operadorId: cuenta });
      await this.guardar(dia, () =>
        this.prisma.parejaCda.create({
          data: {
            fecha: evento.fechaJornada,
            operadorCdaId: datos.operadorCdaId,
            asistenteCdaId,
            recintoId: datos.recintoId,
            kitId: nuevo.id,
            creadoPorId: usuarioId,
          },
        }),
      );
      return kit;
    } catch (e) {
      await this.prisma.kitElectoral.delete({ where: { id: nuevo.id } }).catch((err: unknown) =>
        // Queda un kit sin pareja: el administrador lo ve en Kits y puede asignarlo o editarlo.
        this.log.error(`No se pudo borrar el kit ${nuevo.id} tras fallar su asignación: ${(err as Error)?.message}`),
      );
      throw e;
    }
  }

  /** Botón "Aplicar a la app": pasa toda la lista del día al evento activo de esa fecha. */
  async aplicar(fecha: string, justificacion?: string): Promise<AplicarParejasCdaResult> {
    const resultado = await this.aplicarDia(fecha, {}, justificacion);
    if (!resultado) {
      throw new BadRequestException(
        `No hay un evento ACTIVO con jornada el ${fecha}: active el evento de ese día para pasar la lista a la app`,
      );
    }
    return resultado;
  }

  /** PDF de QR de los kits de las parejas de ese día; si se indican `parejaIds`, solo de esas. */
  async qr(fecha: string, parejaIds?: string[]): Promise<Buffer> {
    const conKit = await this.prisma.parejaCda.findMany({
      where: { fecha: fechaDb(fecha), kitId: { not: null }, ...(parejaIds ? { id: { in: parejaIds } } : {}) },
      select: { kitId: true },
    });
    const kitIds = [...new Set(conKit.map((p) => p.kitId as string))];
    if (kitIds.length === 0) {
      throw new BadRequestException(
        parejaIds ? 'Ninguna de las parejas elegidas tiene kit todavía' : 'Ninguna pareja de esta lista tiene kit todavía',
      );
    }
    return this.kits.generatePdfQr({ kitIds });
  }

  /**
   * Reporte imprimible (Excel o PDF) de la lista del día, tal como la ve la
   * pestaña Parejas, con sus parejas de reserva.
   */
  async reporte(fecha: string, formato: FormatoReporteCda): Promise<ArchivoReporte> {
    return generarReporte(reporteParejas(await this.listar(fecha)), formato);
  }

  /** Plantilla: hoja de parejas, recintos CDA con su código e instrucciones. */
  async plantilla(): Promise<Buffer> {
    const recintos = await this.prisma.recinto.findMany({
      where: { tipo: 'CDA', activo: true },
      select: { codigoRecinto: true, nombre: true },
      orderBy: { nombre: 'asc' },
    });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Parejas');
    ws.columns = [
      { header: 'cedula_operador', key: 'cedula_operador', width: 16 },
      { header: 'nombre_operador', key: 'nombre_operador', width: 34 },
      { header: 'telefono_operador', key: 'telefono_operador', width: 16 },
      { header: 'cedula_asistente', key: 'cedula_asistente', width: 16 },
      { header: 'nombre_asistente', key: 'nombre_asistente', width: 34 },
      { header: 'telefono_asistente', key: 'telefono_asistente', width: 16 },
      { header: 'codigo_recinto', key: 'codigo_recinto', width: 14 },
      { header: 'articulos', key: 'articulos', width: 44 },
    ];
    ws.getRow(1).font = { bold: true };
    // Cédulas y códigos como texto: Excel le quita el 0 inicial a los números.
    for (const col of [1, 3, 4, 6, 7]) ws.getColumn(col).numFmt = '@';

    const hojaRecintos = wb.addWorksheet('Recintos CDA');
    hojaRecintos.columns = [
      { header: 'codigo_recinto', key: 'codigo', width: 14 },
      { header: 'nombre', key: 'nombre', width: 60 },
    ];
    hojaRecintos.getRow(1).font = { bold: true };
    for (const r of recintos) hojaRecintos.addRow({ codigo: r.codigoRecinto, nombre: r.nombre });

    const ayuda = wb.addWorksheet('Instrucciones');
    [
      'Una fila por pareja. Solo la hoja "Parejas" se carga.',
      'cedula_operador y codigo_recinto son obligatorios. El asistente es opcional.',
      'Cada pareja es un Operador CDA (cedula_operador) y un Asistente CDA (cedula_asistente): nunca dos operadores ni dos asistentes, tampoco la 2.ª pareja de un recinto.',
      'Si una cédula no está registrada se crea con el nombre y teléfono de la fila (nombre obligatorio).',
      'codigo_recinto: ver la hoja "Recintos CDA".',
      `Pareja de reserva: escriba ${CODIGO_RESERVA_PAREJAS_CDA} en codigo_recinto. Queda registrada sin recinto ni kit; en la web se le asigna un recinto cuando haga falta.`,
      'articulos: solo si el recinto aún no tiene kit en el evento. Códigos del catálogo separados por coma; serie opcional con dos puntos (ej. COMPUTADOR:5CD445577S, MOUSE).',
      'Normalmente una pareja por recinto; una segunda en el mismo recinto queda solo registrada.',
    ].forEach((t) => ayuda.addRow([t]));
    ayuda.getColumn(1).width = 120;

    return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  }

  /**
   * Carga la plantilla para un día. Sin `guardar` es la vista previa: valida
   * y muestra sin escribir. Al guardar se crean las personas nuevas (con su
   * cuenta de la app) y las parejas sin errores, y se pasan a la app.
   */
  async importar(
    file: Express.Multer.File,
    fecha: string,
    guardar: boolean,
    usuarioId: string,
    pasarAApp = true,
    justificacion?: string,
  ): Promise<ImportParejasCdaResult> {
    if (!file?.buffer) throw new BadRequestException('Archivo requerido');
    if (!/\.xlsx$/i.test(file.originalname ?? '')) throw new BadRequestException('Use la plantilla en .xlsx');
    const filas = (await parseUploadRows(file)).map(normalizarFila);
    if (filas.length === 0) throw new BadRequestException('La plantilla no tiene filas');
    if (filas.length > MAX_FILAS) throw new BadRequestException(`La plantilla tiene ${filas.length} filas: máximo ${MAX_FILAS}`);
    return this.cargarFilas(filas, fecha, guardar, usuarioId, pasarAApp, justificacion, 2);
  }

  /**
   * La propuesta automática ya editada en la web: pasa por las mismas
   * validaciones y el mismo guardado que la plantilla (sin crear personas:
   * no trae nombres, así que una cédula desconocida queda con error).
   */
  async cargarPropuesta(
    propuesta: CargarPropuestaParejasCdaRequest['filas'],
    fecha: string,
    guardar: boolean,
    usuarioId: string,
    pasarAApp = true,
    justificacion?: string,
  ): Promise<ImportParejasCdaResult> {
    const filas = propuesta.map((p) =>
      normalizarFila({ cedula_operador: p.cedulaOperador, cedula_asistente: p.cedulaAsistente ?? '', codigo_recinto: p.codigoRecinto }),
    );
    // Numeradas desde 1, como la tabla de la web.
    return this.cargarFilas(filas, fecha, guardar, usuarioId, pasarAApp, justificacion, 1);
  }

  /** `primeraFila`: número de la primera fila en los mensajes (2 en el Excel: la 1 es el encabezado). */
  private async cargarFilas(
    filas: ReturnType<typeof normalizarFila>[],
    fecha: string,
    guardar: boolean,
    usuarioId: string,
    pasarAApp: boolean,
    justificacion: string | undefined,
    primeraFila: number,
  ): Promise<ImportParejasCdaResult> {
    const cedulas = [...new Set(filas.flatMap((f) => [f.cedula_operador, f.cedula_asistente]).filter(Boolean))];
    const [personas, recintos, previas, catalogo] = await Promise.all([
      this.prisma.operadorCda.findMany({
        where: { cedula: { in: cedulas } },
        select: { id: true, cedula: true, grupo: true, activo: true, apellidosNombres: true },
      }),
      // Los códigos se comparan sin mayúsculas: se traen todos los activos (unos cientos).
      this.prisma.recinto.findMany({
        where: { activo: true },
        select: { id: true, codigoRecinto: true, nombre: true, tipo: true },
      }),
      this.prisma.parejaCda.findMany({ select: { fecha: true, operadorCdaId: true, asistenteCdaId: true, recintoId: true } }),
      this.catalogo(),
    ]);
    const personaPorCedula = new Map(personas.map((p) => [p.cedula, p]));
    const recintoPorCodigo = new Map(recintos.map((r) => [r.codigoRecinto.toLowerCase(), r]));
    const dia = fechaDb(fecha).getTime();
    const hoy = previas.filter((p) => p.fecha.getTime() === dia);
    const otroDia = new Map<string, string>();
    for (const p of previas.filter((x) => x.fecha.getTime() !== dia)) {
      for (const id of [p.operadorCdaId, p.asistenteCdaId, p.recintoId]) if (id) otroDia.set(id, diaDeFechaDb(p.fecha));
    }
    const personasHoy = new Set(hoy.flatMap((p) => [p.operadorCdaId, p.asistenteCdaId]));
    const recintosOcupados = new Set(conRecinto(hoy.map((p) => p.recintoId)));
    const filaDeCedula = new Map<string, number>();

    const resultado: FilaImportParejaCda[] = [];
    const validas: { fila: FilaImportParejaCda; datos: ReturnType<typeof normalizarFila>; recintoId: string | null }[] = [];
    filas.forEach((datos, i) => {
      const numero = i + primeraFila;
      const errores: string[] = [];
      const avisos: string[] = [];
      const parsed = filaParejaCdaSchema.safeParse(datos);
      if (!parsed.success) {
        for (const iss of parsed.error.issues) errores.push(`${iss.path.join('.') || 'fila'}: ${iss.message}`);
      }
      errores.push(...textosInvalidos(datos));

      const integrante = (cedula: string, nombre: string | undefined, grupo: GrupoPareja, columna: string) => {
        if (!cedula) return null;
        const repetida = filaDeCedula.get(cedula);
        if (repetida) errores.push(`La cédula ${cedula} está repetida (fila ${repetida})`);
        else filaDeCedula.set(cedula, numero);
        const p = personaPorCedula.get(cedula);
        if (!p) {
          if (!nombre) errores.push(`Cédula nueva ${cedula}: falta ${columna}`);
          return { cedula, nombre: nombre ?? null, nuevo: true };
        }
        if (p.grupo !== grupo) errores.push(`La cédula ${cedula} es de ${textosGrupo(p.grupo).titulo}, no de ${textosGrupo(grupo).titulo}`);
        else if (!p.activo) errores.push(`${p.apellidosNombres} está oculto en ${textosGrupo(p.grupo).titulo}`);
        if (personasHoy.has(p.id)) errores.push(`${p.apellidosNombres} ya tiene pareja el ${fecha}`);
        const otro = otroDia.get(p.id);
        if (otro) avisos.push(`${p.apellidosNombres} ya fue el ${otro}`);
        return { cedula, nombre: p.apellidosNombres, nuevo: false };
      };
      const operador = integrante(datos.cedula_operador, datos.nombre_operador, 'OPERADOR', 'nombre_operador');
      const asistente = integrante(datos.cedula_asistente, datos.nombre_asistente, 'ASISTENTE', 'nombre_asistente');

      const reserva = datos.codigo_recinto.toUpperCase() === CODIGO_RESERVA_PAREJAS_CDA;
      if (reserva && !operador && asistente) avisos.push('Reserva sin operador: complétela antes de asignarle un recinto');
      const r = datos.codigo_recinto && !reserva ? recintoPorCodigo.get(datos.codigo_recinto.toLowerCase()) : undefined;
      if (datos.codigo_recinto && !reserva && !r) errores.push(`Recinto no encontrado: ${datos.codigo_recinto}`);
      if (reserva && datos.articulos) avisos.push('Pareja de reserva: los artículos se usan cuando se le asigne un recinto');
      if (r && r.tipo !== 'CDA') errores.push(`El recinto ${r.codigoRecinto} no es CDA`);
      if (r && otroDia.has(r.id)) avisos.push(`El recinto ${r.codigoRecinto} ya se usó el ${otroDia.get(r.id)}`);

      if (datos.articulos) {
        try {
          detalleDe(datos.articulos, catalogo);
        } catch (e) {
          errores.push((e as Error).message);
        }
      }

      if (r && errores.length === 0) {
        if (recintosOcupados.has(r.id)) {
          avisos.push(`Segunda pareja en el recinto ${r.codigoRecinto}: solo queda registrada (el kit y la app son de la primera)`);
        }
        recintosOcupados.add(r.id);
      }
      const fila: FilaImportParejaCda = {
        fila: numero,
        operador,
        asistente,
        recinto: r ? aRecinto(r) : null,
        reserva,
        articulos: datos.articulos || null,
        errores: [...new Set(errores)],
        avisos,
      };
      resultado.push(fila);
      if ((r || reserva) && fila.errores.length === 0) validas.push({ fila, datos, recintoId: r?.id ?? null });
    });

    if (!guardar) return { fecha, guardado: false, filas: resultado, guardadas: 0, app: null };

    const ids: string[] = [];
    for (const { fila, datos, recintoId } of validas) {
      try {
        const operadorCdaId = fila.operador
          ? await this.personaDe(fila.operador, datos.telefono_operador, 'OPERADOR', personaPorCedula)
          : null;
        const asistenteCdaId = fila.asistente
          ? await this.personaDe(fila.asistente, datos.telefono_asistente, 'ASISTENTE', personaPorCedula)
          : null;
        const creada = await this.guardar(fecha, () =>
          this.prisma.parejaCda.create({
            data: {
              fecha: fechaDb(fecha),
              operadorCdaId,
              asistenteCdaId,
              recintoId,
              articulos: fila.articulos,
              creadoPorId: usuarioId,
            },
          }),
        );
        ids.push(creada.id);
      } catch (e) {
        const p2002 = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
        fila.errores.push(p2002 ? 'Otra carga registró a esta persona al mismo tiempo: vuelva a cargar la plantilla' : (e as Error).message);
      }
    }
    const app = ids.length && pasarAApp ? await this.aplicarDia(fecha, { ids }, justificacion) : null;
    return { fecha, guardado: true, filas: resultado, guardadas: ids.length, app };
  }

  // --- paso a la app ---

  /**
   * Pasa a la app las parejas del día (o solo `ids`). null = no hay evento
   * ACTIVO con jornada ese día (la lista queda registrada).
   */
  private async aplicarDia(fecha: string, filtro: Filtro = {}, justificacion?: string): Promise<AplicarParejasCdaResult | null> {
    const evento = await this.eventoDeFecha(fecha);
    if (!evento) return null;
    const congelado = this.kits.estaCongelado({ estado: 'ACTIVO', fechaJornada: fechaDb(fecha) });
    const parejas = await this.parejasDelDia(fecha);
    /** undefined = no congelado; null = congelado sin justificación. */
    const justificar = congelado ? justificacion?.trim() || null : undefined;
    const etiqueta = (p: ParejaConRelaciones) => `${p.operador.apellidosNombres} · ${p.recinto.codigoRecinto}`;
    const r = vacio();
    // Cada pareja lleva su propio kit: así cada una tiene a alguien rastreado en el recinto.
    for (const p of parejas) {
      if (filtro.ids && !filtro.ids.includes(p.id)) continue;
      if (filtro.recintos && !filtro.recintos.includes(p.recintoId)) continue;
      if (kitSalidoConLaPareja(p, evento)) {
        // Cadena de custodia: sigue con quien lo lleva; no se reasigna ni se crean cuentas.
        r.enApp++;
        continue;
      }
      try {
        // El kit (la app y el nombre del QR) va a quien tiene Android en la pareja.
        const portador = portadorDe(p);
        const usuarioId = portador.usuarioId ?? (await this.crearCuentaOperador(portador.id));
        const resultado = await this.aplicarPareja(p, evento, usuarioId, justificar);
        r.enApp++;
        if (resultado === 'KIT_CREADO') r.kitsCreados++;
      } catch (e) {
        r.errores.push({ pareja: etiqueta(p), error: (e as Error).message });
      }
    }
    return r;
  }

  /**
   * Kit de la pareja en el evento → a quien lo lleva. Sin kit, toma uno del
   * recinto que no sea de otra pareja o se crea (el 2.º, 3.º… es "otro
   * dispositivo", con el QR que ese recinto tuvo en ese orden) con los
   * artículos de la pareja o, sin ellos, con los del catálogo. La asignación pasa por
   * KitsService: respeta evento reabierto, congelamiento y 1 operador = 1 recinto.
   */
  private async aplicarPareja(
    p: ParejaConRelaciones,
    evento: Evento,
    usuarioId: string,
    /** undefined = no congelado; null = congelado sin justificación. */
    justificacion: string | null | undefined,
  ): Promise<'EN_APP' | 'KIT_CREADO'> {
    // La pareja con kit propio en este evento lo conserva; si no, toma uno del
    // recinto que no sea de otra pareja (cada pareja lleva el suyo).
    const campos = { id: true, operadorId: true, estado: true, codigoUnico: true } as const;
    let kit: { id: string; operadorId: string | null; estado?: string; codigoUnico?: string } | null = p.kitId
      ? await this.prisma.kitElectoral.findFirst({ where: { id: p.kitId, eventoId: evento.id }, select: campos })
      : null;
    // Kit libre = del recinto, sin pareja (también uno creado a mano en Kits) y aún en la Delegación.
    kit ??= await this.prisma.kitElectoral.findFirst({
      where: { eventoId: evento.id, recintoId: p.recintoId, esPrueba: false, parejasCda: { none: {} }, estado: { in: ['EN_BODEGA', 'ASIGNADO'] } },
      select: campos,
      orderBy: { creadoEn: 'asc' },
    });
    // Un kit que ya salió sigue con quien lo lleva si es de la pareja, aunque
    // ahora otro integrante tenga Android (cadena de custodia).
    const deLaPareja = [p.operador.usuarioId, p.asistente?.usuarioId];
    if (kit?.estado && !EN_DELEGACION.has(kit.estado) && kit.operadorId && deLaPareja.includes(kit.operadorId)) {
      if (p.kitId !== kit.id) await this.prisma.parejaCda.update({ where: { id: p.id }, data: { kitId: kit.id } });
      return 'EN_APP';
    }
    const cambia = !kit || kit.operadorId !== usuarioId;
    // Quien llevó un kit que ya salió queda en su historial: no se reescribe.
    if (cambia && kit?.estado && !EN_DELEGACION.has(kit.estado)) {
      throw new ConflictException(`El kit ${kit.codigoUnico} ya salió de la Delegación: no se puede cambiar su operador`);
    }
    if (cambia && justificacion === null) throw new BadRequestException(MENSAJE_CONGELADO);
    let creado = false;
    if (!kit) {
      // Sin artículos en la pareja: KitsService pone los activos del catálogo.
      const detalleItems = p.articulos ? await this.detalleDeArticulos(p.articulos) : undefined;
      const nuevo = await this.kits.create({
        eventoId: evento.id,
        // Mismo nombre que "Nuevo kit" de la página Kits: así se busca también por el recinto.
        nombre: `${p.recinto.codigoRecinto} — ${p.recinto.nombre}`.slice(0, 160), // VARCHAR(160)
        recintoId: p.recintoId,
        // Si el recinto ya tiene kit (de otra pareja), este es uno más.
        otroDispositivo: true,
        ...(detalleItems && { detalleItems }),
      });
      kit = { id: nuevo.id, operadorId: null };
      creado = true;
    }
    if (p.kitId !== kit.id) await this.reclamarKit(p, kit.id, creado);
    if (kit.operadorId !== usuarioId) {
      await this.kits.asignar(kit.id, justificacion ? { operadorId: usuarioId, justificacion } : { operadorId: usuarioId });
    }
    return creado ? 'KIT_CREADO' : 'EN_APP';
  }

  /**
   * Vincula el kit a la pareja ANTES de asignarlo: con doble clic o dos
   * administradores a la vez, solo un pedido se queda con él. Si la pareja ya
   * cambió de kit, u otra pareja tomó el mismo kit libre, se deshace (el kit
   * recién creado se borra) y se pide recargar.
   */
  private async reclamarKit(p: ParejaConRelaciones, kitId: string, creado: boolean): Promise<void> {
    const { count } = await this.prisma.parejaCda.updateMany({ where: { id: p.id, kitId: p.kitId }, data: { kitId } });
    const otra = count === 1 ? await this.prisma.parejaCda.count({ where: { kitId, id: { not: p.id } } }) : 0;
    if (count === 1 && otra === 0) {
      p.kitId = kitId;
      return;
    }
    if (count === 1) await this.prisma.parejaCda.update({ where: { id: p.id }, data: { kitId: p.kitId } });
    if (creado) await this.borrarKitNuevo(kitId);
    throw new ConflictException('Otro pedido asignó este kit al mismo tiempo: recargue la lista e intente de nuevo');
  }

  private borrarKitNuevo(kitId: string): Promise<boolean> {
    return this.prisma.kitElectoral
      .delete({ where: { id: kitId } })
      .then(() => true)
      .catch((err: unknown) => {
        this.log.error(`No se pudo borrar el kit ${kitId} tras perder la asignación: ${(err as Error)?.message}`);
        return false;
      });
  }

  /** Id del kit de la pareja si lo tiene su operador o su asistente en un evento ACTIVO (el que hay que soltar). */
  private async kitDelOperador(p: {
    operador: { usuarioId: string | null } | null;
    asistente?: { usuarioId: string | null } | null;
    kit: { id: string; operadorId: string | null; eventoId: string } | null;
  }): Promise<string | null> {
    const kit = p.kit;
    if (!kit?.operadorId || ![p.operador?.usuarioId, p.asistente?.usuarioId].includes(kit.operadorId)) return null;
    const activo = await this.prisma.eventoElectoral.findFirst({ where: { id: kit.eventoId, estado: 'ACTIVO' }, select: { id: true } });
    return activo ? kit.id : null;
  }

  // --- auxiliares ---

  private eventoDeFecha(fecha: string): Promise<Evento | null> {
    return this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO', fechaJornada: fechaDb(fecha) },
      select: { id: true, nombre: true },
    });
  }

  /** Parejas del día con recinto (las de reserva van aparte). */
  private async parejasDelDia(fecha: string): Promise<ParejaConRelaciones[]> {
    const parejas = await this.prisma.parejaCda.findMany({
      where: { fecha: fechaDb(fecha), recintoId: { not: null } },
      include: CON_RELACIONES,
      orderBy: { creadoEn: 'asc' },
    });
    return parejas as ParejaConRelaciones[];
  }

  private async reservaDelDia(fecha: string): Promise<ParejaReservaCda[]> {
    const parejas = await this.prisma.parejaCda.findMany({
      where: { fecha: fechaDb(fecha), recintoId: null },
      select: { id: true, fecha: true, operador: { select: PERSONA }, asistente: { select: PERSONA } },
      orderBy: { creadoEn: 'asc' },
    });
    return parejas.map((p) => ({
      id: p.id,
      fecha: diaDeFechaDb(p.fecha),
      operador: p.operador && aPersona(p.operador),
      asistente: p.asistente && aPersona(p.asistente),
    }));
  }

  private async leerPareja(id: string) {
    const p = await this.prisma.parejaCda.findUnique({
      where: { id },
      include: {
        operador: { select: { usuarioId: true, apellidosNombres: true, grupo: true } },
        asistente: { select: { usuarioId: true, apellidosNombres: true, grupo: true } },
        kit: { select: { id: true, operadorId: true, eventoId: true, estado: true, codigoUnico: true } },
      },
    });
    if (!p) throw new NotFoundException('Pareja no encontrada');
    return p;
  }

  /** Comprueba el cargo de cada integrante indicado (null = no se comprueba). */
  private async validarIntegrantes(operadorCdaId: string | null, asistenteCdaId: string | null) {
    if (operadorCdaId && operadorCdaId === asistenteCdaId) throw new BadRequestException('Elija dos personas distintas para la pareja');
    const comprobar = async (id: string, grupo: GrupoPareja) => {
      const rol = ROL_DE[grupo];
      const p = await this.prisma.operadorCda.findUnique({ where: { id }, select: { grupo: true, activo: true } });
      if (!p) throw new NotFoundException(`No se encontró al ${rol}`);
      if (p.grupo !== grupo) {
        throw new BadRequestException(
          `La persona elegida como ${rol} es de ${textosGrupo(p.grupo).titulo}, no de ${textosGrupo(grupo).titulo}: cada pareja es un Operador y un Asistente CDA`,
        );
      }
      if (!p.activo) throw new BadRequestException(`La persona elegida como ${rol} está oculta`);
    };
    if (operadorCdaId) await comprobar(operadorCdaId, 'OPERADOR');
    if (asistenteCdaId) await comprobar(asistenteCdaId, 'ASISTENTE');
  }

  private async validarRecinto(recintoId: string) {
    const r = await this.prisma.recinto.findUnique({
      where: { id: recintoId },
      select: { activo: true, tipo: true, codigoRecinto: true, nombre: true },
    });
    if (!r || !r.activo) throw new NotFoundException('Recinto no encontrado');
    if (r.tipo !== 'CDA') throw new BadRequestException('El recinto no es CDA');
    return r;
  }

  private async eventoPorId(id: string) {
    const evento = await this.prisma.eventoElectoral.findUnique({ where: { id }, select: { id: true, estado: true, fechaJornada: true } });
    if (!evento) throw new NotFoundException('Evento no encontrado');
    return evento;
  }

  /**
   * Ni el operador ni el asistente pueden tener ya otra pareja ese día (en
   * cualquier columna). Los únicos de la base solo cubren cada columna: dos
   * administradores guardando a la vez podrían cruzarse; se acepta (uso interno).
   */
  private async libresEseDia(fecha: Date, dia: string, operadorCdaId: string | null, asistenteCdaId: string | null, excepto?: string) {
    const personas = [operadorCdaId, asistenteCdaId].filter((x): x is string => !!x);
    const ocupada = await this.prisma.parejaCda.findFirst({
      where: {
        fecha,
        ...(excepto && { id: { not: excepto } }),
        OR: [{ operadorCdaId: { in: personas } }, { asistenteCdaId: { in: personas } }],
      },
      select: { operadorCdaId: true, asistenteCdaId: true },
    });
    if (!ocupada) return;
    const quien = operadorCdaId && [ocupada.operadorCdaId, ocupada.asistenteCdaId].includes(operadorCdaId) ? 'operador' : 'asistente';
    throw new ConflictException(`El ${quien} ya tiene pareja el ${dia}`);
  }

  /** Crea (o vincula) la cuenta de la app del operador y devuelve su usuario. */
  private async crearCuentaOperador(operadorCdaId: string): Promise<string> {
    await this.cuentas.crearOVincular(operadorCdaId);
    const op = await this.prisma.operadorCda.findUnique({ where: { id: operadorCdaId }, select: { usuarioId: true } });
    if (!op?.usuarioId) throw new BadRequestException('El operador está oculto: no tiene cuenta de la app');
    return op.usuarioId;
  }

  /** Traduce el choque de únicos (misma persona dos veces el mismo día) a un 409 legible. */
  private async guardar<T>(fecha: string, escribir: () => Promise<T>): Promise<T> {
    try {
      return await escribir();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const quien = JSON.stringify(e.meta?.target ?? '').includes('asistente') ? 'asistente' : 'operador';
        throw new ConflictException(`Ese ${quien} ya tiene pareja el ${fecha}`);
      }
      throw e;
    }
  }

  private async personaDe(
    p: { cedula: string; nombre: string | null; nuevo: boolean },
    telefono: string,
    grupo: 'OPERADOR' | 'ASISTENTE',
    existentes: Map<string, { id: string }>,
  ): Promise<string> {
    const ya = existentes.get(p.cedula);
    if (ya) return ya.id;
    const creada = await this.prisma.operadorCda.create({
      data: { cedula: p.cedula, apellidosNombres: (p.nombre ?? '').toUpperCase(), telefono: telefono || null, grupo, cargo: CARGO_NUEVO[grupo] },
      select: { id: true },
    });
    existentes.set(p.cedula, creada);
    // Su contraseña inicial es su cédula; el hash (argon2, lento) va antes de la transacción.
    const hash = await this.cuentas.hashInicial(p.cedula);
    await this.prisma.$transaction((tx) => this.cuentas.asegurarCuenta(tx, creada.id, hash));
    return creada.id;
  }

  private catalogo(): Promise<{ id: string; codigo: string }[]> {
    return this.prisma.itemKitCatalog.findMany({ where: { activo: true }, select: { id: true, codigo: true } });
  }

  private async detalleDeArticulos(texto: string) {
    try {
      return detalleDe(texto, await this.catalogo());
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }
}

/** "CODIGO" o "CODIGO:SERIE" separados por coma → ítems del catálogo (lanza si alguno no existe). */
function detalleDe(texto: string, catalogo: { id: string; codigo: string }[]): { itemId: string; serie: string | null }[] {
  const porCodigo = new Map(catalogo.map((c) => [c.codigo.toLowerCase().trim(), c.id]));
  const vistos = new Set<string>();
  return texto
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((entrada) => {
      const [codigo, ...resto] = entrada.split(':');
      const itemId = porCodigo.get(codigo.trim().toLowerCase());
      if (!itemId) throw new Error(`Artículo no encontrado en el catálogo: ${codigo.trim()}`);
      if (vistos.has(itemId)) throw new Error(`Artículo repetido: ${codigo.trim()}`);
      vistos.add(itemId);
      const serie = resto.join(':').trim();
      return { itemId, serie: serie || null };
    });
}

/**
 * Celdas con fórmula/enlace llegan como "[object Object]", y un texto que
 * empieza con =, +, - o @ se ejecutaría como fórmula al exportar a Excel.
 */
function textosInvalidos(datos: Record<string, string | undefined>): string[] {
  const errores: string[] = [];
  for (const [col, v] of Object.entries(datos)) {
    if (!v) continue;
    if (v.includes('[object Object]')) errores.push(`${col}: valor no válido (escriba solo texto)`);
    else if ((col === 'nombre_operador' || col === 'nombre_asistente') && /^[=+\-@]/.test(v)) {
      errores.push(`${col} no puede empezar con =, +, - o @`);
    }
  }
  return errores;
}

/** Excel guarda las cédulas como número y les quita el 0 inicial. */
function cedulaDe(v: string | undefined): string {
  const c = (v ?? '').trim();
  return /^\d{9}$/.test(c) ? `0${c}` : c;
}

function normalizarFila(raw: Record<string, string>) {
  const t = (k: string) => (raw[k] ?? '').trim();
  return {
    cedula_operador: cedulaDe(raw.cedula_operador),
    nombre_operador: t('nombre_operador') || undefined,
    telefono_operador: t('telefono_operador'),
    cedula_asistente: cedulaDe(raw.cedula_asistente),
    nombre_asistente: t('nombre_asistente') || undefined,
    telefono_asistente: t('telefono_asistente'),
    codigo_recinto: t('codigo_recinto'),
    articulos: t('articulos'),
  };
}

function aRecinto(r: { id: string; codigoRecinto: string; nombre: string; canton?: { nombre: string } }): RecintoParejaCda {
  return { id: r.id, codigo: r.codigoRecinto, nombre: r.nombre, ...(r.canton && { canton: r.canton.nombre }) };
}

/** La columna es VARCHAR con CHECK: solo puede traer ANDROID, IPHONE o null. */
function aPersona<P extends { dispositivo: string | null }>(p: P): Omit<P, 'dispositivo'> & { dispositivo: DispositivoCda | null } {
  return { ...p, dispositivo: p.dispositivo === 'ANDROID' || p.dispositivo === 'IPHONE' ? p.dispositivo : null };
}

const integrantesDe = (p: ParejaConRelaciones) => [p.operador, p.asistente].filter((x): x is PersonaDePareja => !!x);

/** Cuántas parejas van a cada recinto ese día. */
function parejasPorRecinto(parejas: ParejaConRelaciones[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of parejas) m.set(p.recintoId, (m.get(p.recintoId) ?? 0) + 1);
  return m;
}

/**
 * Quién de la pareja lleva su kit (la app y el nombre del QR): el primero con
 * Android y activo; si nadie lo tiene, el operador (y la web avisa que la APK
 * no se instala en iPhone y que esa pareja no se podrá rastrear).
 */
function portadorDe(p: ParejaConRelaciones): PersonaDePareja {
  return integrantesDe(p).find((x) => x.dispositivo === 'ANDROID' && x.activo) ?? p.operador;
}

/**
 * Quién tiene asignado en el sistema el kit (de este evento) de la pareja: uno de
 * los dos, alguien de otra pareja del recinto (la pareja no tiene Android), otra
 * persona o nadie. En una pareja sin kit, `lleva` es su integrante que lleva el
 * kit de otra pareja del recinto, si lo hay.
 */
function quienTieneElKit(
  p: ParejaConRelaciones | undefined,
  delRecinto: ParejaConRelaciones[],
  evento: Evento | null,
): { ingresa: QuienIngresa; lleva: PersonaParejaCda | null } {
  // Sin evento activo de ese día nadie ingresa todavía ("Pendiente" en el reporte).
  if (!p || !evento) return { ingresa: null, lleva: null };
  const titular = (x: ParejaConRelaciones) =>
    x.kit?.operadorId && x.kit.eventoId === evento.id ? x.kit.operadorId : null;
  const usuarioKit = titular(p);
  if (!p.kitId) {
    const titulares = new Set(delRecinto.map(titular).filter(Boolean));
    const lleva = integrantesDe(p).find((x) => x.usuarioId && titulares.has(x.usuarioId));
    return { ingresa: null, lleva: lleva ? sinCuenta(lleva) : null };
  }
  if (!usuarioKit) return { ingresa: null, lleva: null };
  if (usuarioKit === p.operador.usuarioId) return { ingresa: 'OPERADOR', lleva: sinCuenta(p.operador) };
  if (p.asistente && usuarioKit === p.asistente.usuarioId) return { ingresa: 'ASISTENTE', lleva: sinCuenta(p.asistente) };
  const otro = delRecinto.flatMap(integrantesDe).find((x) => x.usuarioId === usuarioKit);
  return otro ? { ingresa: 'RECINTO', lleva: sinCuenta(otro) } : { ingresa: 'OTRA', lleva: null };
}

/** Persona para la web: sin el id de su cuenta. */
function sinCuenta({ usuarioId: _usuarioId, activo: _activo, ...persona }: PersonaDePareja) {
  return aPersona(persona);
}

/** El kit de la pareja (de este evento) ya salió de la Delegación y lo tiene alguien de ella. */
function kitSalidoConLaPareja(p: ParejaConRelaciones, evento: Evento): boolean {
  const kit = p.kit;
  return (
    !!kit?.operadorId &&
    kit.eventoId === evento.id &&
    !EN_DELEGACION.has(kit.estado) &&
    [p.operador.usuarioId, p.asistente?.usuarioId].includes(kit.operadorId)
  );
}

function aFila(p: ParejaConRelaciones, evento: Evento | null, calculado: PersonaDePareja, parejasEnRecinto: number): ParejaCdaFila {
  const delEvento = !!evento && p.kit?.eventoId === evento.id;
  const titular = delEvento ? p.kit?.operadorId : null;
  const quienLleva =
    titular && titular === p.operador.usuarioId ? 'OPERADOR' : titular && titular === p.asistente?.usuarioId ? 'ASISTENTE' : null;
  const kitSalio = delEvento && !!p.kit && !EN_DELEGACION.has(p.kit.estado);
  // Un kit que ya salió sigue con quien lo lleva aunque otro de la pareja tenga Android.
  const portador = kitSalio && quienLleva ? (quienLleva === 'OPERADOR' ? p.operador : p.asistente) : calculado;
  let estado: EstadoParejaCda;
  if (!evento || !portador) estado = 'PENDIENTE_EVENTO';
  else if (p.kit && p.kit.eventoId === evento.id && !!portador.usuarioId && p.kit.operadorId === portador.usuarioId) estado = 'EN_APP';
  else estado = 'SIN_KIT';
  return {
    id: p.id,
    fecha: diaDeFechaDb(p.fecha),
    recinto: aRecinto(p.recinto),
    operador: sinCuenta(p.operador),
    asistente: p.asistente && sinCuenta(p.asistente),
    portador: portador ? sinCuenta(portador) : null,
    kitCodigo: p.kit?.codigoUnico ?? null,
    estado,
    parejasEnRecinto,
    articulos: p.articulos,
    kitSalio,
    quienLleva,
  };
}

