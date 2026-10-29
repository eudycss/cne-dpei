import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { filaParejaCdaSchema } from '@cne/shared-validation';
import type {
  AplicarParejasCdaResult,
  CrearParejaCdaRequest,
  DisponiblesParejasCda,
  EditarParejaCdaRequest,
  EstadoParejaCda,
  FilaImportParejaCda,
  ImportParejasCdaResult,
  ParejaCdaFila,
  ParejasCdaDia,
  RecintoParejaCda,
} from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { KitsService } from '../kits/kits.service';
import { parseUploadRows } from '../common/parse-upload-rows';
import { CuentasCdaService } from './cuentas-cda.service';
import { TEXTOS_GRUPO } from './grupo-cda';
import { diaDeFechaDb, fechaDb } from './dia-ecuador';

/** Cargo con el que se registra a quien llega nuevo en la plantilla. */
const CARGO_NUEVO: Record<'OPERADOR' | 'ASISTENTE', string> = {
  OPERADOR: 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - OPERADORES CDA',
  ASISTENTE: 'ASISTENTE ADMINISTRATIVO ELECTORAL PROVINCIAL - ASISTENTES CDA',
};

const PERSONA = { id: true, apellidosNombres: true, cedula: true, telefono: true } as const;

const CON_RELACIONES = {
  recinto: { select: { id: true, codigoRecinto: true, nombre: true } },
  operador: { select: { ...PERSONA, usuarioId: true } },
  asistente: { select: PERSONA },
  kit: { select: { codigoUnico: true, eventoId: true, operadorId: true } },
} satisfies Prisma.ParejaCdaInclude;

type ParejaConRelaciones = Prisma.ParejaCdaGetPayload<{ include: typeof CON_RELACIONES }>;
type Evento = { id: string; nombre: string };
/** Qué parejas del día pasar a la app: por id o por recinto (todas si no se indica). */
type Filtro = { ids?: string[]; recintos?: string[] };

/** La plantilla es pequeña (~60 parejas): un tope protege a la API de archivos enormes. */
const MAX_FILAS = 300;
const MENSAJE_CONGELADO =
  'Las asignaciones están congeladas: ya inició la jornada. Escriba una justificación para pasar esta pareja a la app.';

const vacio = (): AplicarParejasCdaResult => ({ enApp: 0, kitsCreados: 0, sinKit: 0, soloRegistradas: 0, errores: [] });

/**
 * Parejas Operador CDA + Asistente CDA por día. Cada día tiene su lista; la
 * lista del día D pasa a la app (kit del recinto asignado al operador) solo
 * si el evento ACTIVO tiene su jornada el día D. La segunda pareja de un
 * mismo recinto y día solo queda registrada.
 */
@Injectable()
export class ParejasCdaService {
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
    const [evento, parejas] = await Promise.all([this.eventoDeFecha(fecha), this.parejasDelDia(fecha)]);
    const primeras = primerasPorRecinto(parejas);
    const porRecinto = contarPorRecinto(parejas);
    return {
      fecha,
      evento,
      congelado: !!evento && this.kits.estaCongelado({ estado: 'ACTIVO', fechaJornada: fechaDb(fecha) }),
      parejas: parejas
        .map((p) => aFila(p, evento, primeras.has(p.id), (porRecinto.get(p.recintoId) ?? 0) > 1))
        .sort((a, b) => a.recinto.nombre.localeCompare(b.recinto.nombre, 'es') || a.operador.apellidosNombres.localeCompare(b.operador.apellidosNombres, 'es')),
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
    const recintos = todos ? [] : [...new Set(usadas.map((u) => u.recintoId))];
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
    return { operadores, asistentes, recintos: listaRecintos.map(aRecinto) };
  }

  async crear(datos: CrearParejaCdaRequest, usuarioId: string): Promise<AplicarParejasCdaResult> {
    await this.validarIntegrantes(datos.operadorCdaId, datos.asistenteCdaId ?? null);
    await this.validarRecinto(datos.recintoId);
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
   */
  async editar(id: string, datos: EditarParejaCdaRequest, justificacion?: string): Promise<AplicarParejasCdaResult> {
    const actual = await this.leerPareja(id);
    const operadorCdaId = datos.operadorCdaId ?? actual.operadorCdaId;
    const asistenteCdaId = datos.asistenteCdaId === undefined ? actual.asistenteCdaId : datos.asistenteCdaId;
    await this.validarIntegrantes(operadorCdaId, asistenteCdaId);
    const cambiaRecinto = !!datos.recintoId && datos.recintoId !== actual.recintoId;
    if (cambiaRecinto) await this.validarRecinto(datos.recintoId as string);

    const kitAnterior = cambiaRecinto ? await this.kitDelOperador(actual) : null;
    if (kitAnterior) await this.kits.quitarOperador(kitAnterior, justificacion, true);

    const fecha = diaDeFechaDb(actual.fecha);
    await this.guardar(fecha, () =>
      this.prisma.parejaCda.update({
        where: { id },
        data: {
          operadorCdaId,
          asistenteCdaId,
          ...(cambiaRecinto && { recintoId: datos.recintoId, kitId: null }),
        },
      }),
    );
    if (kitAnterior) await this.kits.quitarOperador(kitAnterior, justificacion);
    const recintos = [actual.recintoId, ...(cambiaRecinto ? [datos.recintoId as string] : [])];
    return (await this.aplicarDia(fecha, { recintos }, justificacion)) ?? vacio();
  }

  /**
   * Quita la pareja. Si su operador tenía el kit (evento activo), el kit queda
   * en su recinto sin operador; si eso no se puede (kit ya salió, jornada sin
   * justificación), la pareja no se borra. La siguiente pareja del mismo
   * recinto, si la hay, pasa a la app.
   */
  async eliminar(id: string, justificacion?: string): Promise<void> {
    const actual = await this.leerPareja(id);
    const kit = await this.kitDelOperador(actual);
    if (kit) await this.kits.quitarOperador(kit, justificacion);
    await this.prisma.parejaCda.delete({ where: { id } });
    await this.aplicarDia(diaDeFechaDb(actual.fecha), { recintos: [actual.recintoId] }, justificacion);
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

  /** PDF de QR solo de los kits de las parejas de ese día. */
  async qr(fecha: string): Promise<Buffer> {
    const conKit = await this.prisma.parejaCda.findMany({
      where: { fecha: fechaDb(fecha), kitId: { not: null } },
      select: { kitId: true },
    });
    const kitIds = [...new Set(conKit.map((p) => p.kitId as string))];
    if (kitIds.length === 0) throw new BadRequestException('Ninguna pareja de esta lista tiene kit todavía');
    return this.kits.generatePdfQr({ kitIds });
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
      'Si una cédula no está registrada se crea con el nombre y teléfono de la fila (nombre obligatorio).',
      'codigo_recinto: ver la hoja "Recintos CDA".',
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
    const recintosOcupados = new Set(hoy.map((p) => p.recintoId));
    const filaDeCedula = new Map<string, number>();

    const resultado: FilaImportParejaCda[] = [];
    const validas: { fila: FilaImportParejaCda; datos: ReturnType<typeof normalizarFila>; recintoId: string }[] = [];
    filas.forEach((datos, i) => {
      const numero = i + 2;
      const errores: string[] = [];
      const avisos: string[] = [];
      const parsed = filaParejaCdaSchema.safeParse(datos);
      if (!parsed.success) {
        for (const iss of parsed.error.issues) errores.push(`${iss.path.join('.') || 'fila'}: ${iss.message}`);
      }
      errores.push(...textosInvalidos(datos));

      const integrante = (cedula: string, nombre: string | undefined, grupo: 'OPERADOR' | 'ASISTENTE', columna: string) => {
        if (!cedula) return null;
        const repetida = filaDeCedula.get(cedula);
        if (repetida) errores.push(`La cédula ${cedula} está repetida (fila ${repetida})`);
        else filaDeCedula.set(cedula, numero);
        const p = personaPorCedula.get(cedula);
        if (!p) {
          if (!nombre) errores.push(`Cédula nueva ${cedula}: falta ${columna}`);
          return { cedula, nombre: nombre ?? null, nuevo: true };
        }
        if (p.grupo !== grupo) errores.push(`La cédula ${cedula} es de ${TEXTOS_GRUPO[p.grupo].titulo}, no de ${TEXTOS_GRUPO[grupo].titulo}`);
        else if (!p.activo) errores.push(`${p.apellidosNombres} está oculto en ${TEXTOS_GRUPO[grupo].titulo}`);
        if (personasHoy.has(p.id)) errores.push(`${p.apellidosNombres} ya tiene pareja el ${fecha}`);
        const otro = otroDia.get(p.id);
        if (otro) avisos.push(`${p.apellidosNombres} ya fue el ${otro}`);
        return { cedula, nombre: p.apellidosNombres, nuevo: false };
      };
      const operador = integrante(datos.cedula_operador, datos.nombre_operador, 'OPERADOR', 'nombre_operador') ?? {
        cedula: datos.cedula_operador,
        nombre: null,
        nuevo: false,
      };
      const asistente = integrante(datos.cedula_asistente, datos.nombre_asistente, 'ASISTENTE', 'nombre_asistente');

      const r = datos.codigo_recinto ? recintoPorCodigo.get(datos.codigo_recinto.toLowerCase()) : undefined;
      if (datos.codigo_recinto && !r) errores.push(`Recinto no encontrado: ${datos.codigo_recinto}`);
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
        articulos: datos.articulos || null,
        errores: [...new Set(errores)],
        avisos,
      };
      resultado.push(fila);
      if (r && fila.errores.length === 0) validas.push({ fila, datos, recintoId: r.id });
    });

    if (!guardar) return { fecha, guardado: false, filas: resultado, guardadas: 0, app: null };

    const hash = validas.some((v) => v.fila.operador.nuevo || v.fila.asistente?.nuevo) ? await this.cuentas.hashInicial() : '';
    const ids: string[] = [];
    for (const { fila, datos, recintoId } of validas) {
      try {
        const operadorCdaId = await this.personaDe(fila.operador, datos.telefono_operador, 'OPERADOR', personaPorCedula, hash);
        const asistenteCdaId = fila.asistente
          ? await this.personaDe(fila.asistente, datos.telefono_asistente, 'ASISTENTE', personaPorCedula, hash)
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
    const primeras = primerasPorRecinto(parejas);
    const r = vacio();
    let hash: string | undefined;
    for (const p of parejas) {
      if (filtro.ids && !filtro.ids.includes(p.id)) continue;
      if (filtro.recintos && !filtro.recintos.includes(p.recintoId)) continue;
      if (!primeras.has(p.id)) {
        r.soloRegistradas++;
        continue;
      }
      try {
        let usuarioId = p.operador.usuarioId;
        if (!usuarioId) {
          hash ??= await this.cuentas.hashInicial();
          const h = hash;
          await this.prisma.$transaction((tx) => this.cuentas.asegurarCuenta(tx, p.operadorCdaId, h));
          usuarioId = (await this.prisma.operadorCda.findUnique({ where: { id: p.operadorCdaId }, select: { usuarioId: true } }))?.usuarioId ?? null;
          if (!usuarioId) throw new BadRequestException('El operador está oculto: no tiene cuenta de la app');
        }
        const resultado = await this.aplicarPareja(p, evento, usuarioId, congelado ? justificacion?.trim() || null : undefined);
        if (resultado === 'SIN_KIT') r.sinKit++;
        else {
          r.enApp++;
          if (resultado === 'KIT_CREADO') r.kitsCreados++;
        }
      } catch (e) {
        r.errores.push({ pareja: `${p.operador.apellidosNombres} · ${p.recinto.codigoRecinto}`, error: (e as Error).message });
      }
    }
    return r;
  }

  /**
   * Kit real del recinto en el evento → al operador. Si el recinto no tiene
   * kit y la pareja trae artículos, se crea. La asignación pasa por
   * KitsService: respeta evento reabierto, congelamiento y 1 operador = 1 recinto.
   */
  private async aplicarPareja(
    p: ParejaConRelaciones,
    evento: Evento,
    usuarioId: string,
    /** undefined = no congelado; null = congelado sin justificación. */
    justificacion: string | null | undefined,
  ): Promise<'EN_APP' | 'KIT_CREADO' | 'SIN_KIT'> {
    let kit = await this.prisma.kitElectoral.findFirst({
      where: { eventoId: evento.id, recintoId: p.recintoId, esPrueba: false },
      select: { id: true, operadorId: true },
    });
    const cambia = !kit || kit.operadorId !== usuarioId;
    if (cambia && justificacion === null) throw new BadRequestException(MENSAJE_CONGELADO);
    let creado = false;
    if (!kit) {
      if (!p.articulos) return 'SIN_KIT';
      const detalleItems = await this.detalleDeArticulos(p.articulos);
      const nuevo = await this.kits.create({
        eventoId: evento.id,
        nombre: `Kit Recinto ${p.recinto.codigoRecinto}`,
        recintoId: p.recintoId,
        detalleItems,
      });
      kit = { id: nuevo.id, operadorId: null };
      creado = true;
    }
    if (kit.operadorId !== usuarioId) {
      await this.kits.asignar(kit.id, justificacion ? { operadorId: usuarioId, justificacion } : { operadorId: usuarioId });
    }
    if (p.kitId !== kit.id) await this.prisma.parejaCda.update({ where: { id: p.id }, data: { kitId: kit.id } });
    return creado ? 'KIT_CREADO' : 'EN_APP';
  }

  /** Id del kit de la pareja si lo tiene su operador en un evento ACTIVO (el que hay que soltar). */
  private async kitDelOperador(p: {
    operador: { usuarioId: string | null };
    kit: { id: string; operadorId: string | null; eventoId: string } | null;
  }): Promise<string | null> {
    const kit = p.kit;
    if (!kit?.operadorId || kit.operadorId !== p.operador.usuarioId) return null;
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

  private parejasDelDia(fecha: string): Promise<ParejaConRelaciones[]> {
    return this.prisma.parejaCda.findMany({ where: { fecha: fechaDb(fecha) }, include: CON_RELACIONES, orderBy: { creadoEn: 'asc' } });
  }

  private async leerPareja(id: string) {
    const p = await this.prisma.parejaCda.findUnique({
      where: { id },
      include: {
        operador: { select: { usuarioId: true } },
        kit: { select: { id: true, operadorId: true, eventoId: true } },
      },
    });
    if (!p) throw new NotFoundException('Pareja no encontrada');
    return p;
  }

  private async validarIntegrantes(operadorCdaId: string, asistenteCdaId: string | null) {
    const comprobar = async (id: string, grupo: 'OPERADOR' | 'ASISTENTE', rol: string) => {
      const p = await this.prisma.operadorCda.findUnique({ where: { id }, select: { grupo: true, activo: true } });
      if (!p) throw new NotFoundException(`No se encontró al ${rol}`);
      if (p.grupo !== grupo) throw new BadRequestException(`La persona elegida como ${rol} no es de ${TEXTOS_GRUPO[grupo].titulo}`);
      if (!p.activo) throw new BadRequestException(`La persona elegida como ${rol} está oculta`);
    };
    await comprobar(operadorCdaId, 'OPERADOR', 'operador');
    if (asistenteCdaId) await comprobar(asistenteCdaId, 'ASISTENTE', 'asistente');
  }

  private async validarRecinto(recintoId: string) {
    const r = await this.prisma.recinto.findUnique({ where: { id: recintoId }, select: { activo: true, tipo: true } });
    if (!r || !r.activo) throw new NotFoundException('Recinto no encontrado');
    if (r.tipo !== 'CDA') throw new BadRequestException('El recinto no es CDA');
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
    hash: string,
  ): Promise<string> {
    const ya = existentes.get(p.cedula);
    if (ya) return ya.id;
    const creada = await this.prisma.operadorCda.create({
      data: { cedula: p.cedula, apellidosNombres: (p.nombre ?? '').toUpperCase(), telefono: telefono || null, grupo, cargo: CARGO_NUEVO[grupo] },
      select: { id: true },
    });
    existentes.set(p.cedula, creada);
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

/** La primera pareja (por orden de registro) de cada recinto es la que va a la app. */
function primerasPorRecinto(parejas: { id: string; recintoId: string }[]): Set<string> {
  const vistos = new Set<string>();
  const primeras = new Set<string>();
  for (const p of parejas) {
    if (vistos.has(p.recintoId)) continue;
    vistos.add(p.recintoId);
    primeras.add(p.id);
  }
  return primeras;
}

function contarPorRecinto(parejas: { recintoId: string }[]): Map<string, number> {
  const n = new Map<string, number>();
  for (const p of parejas) n.set(p.recintoId, (n.get(p.recintoId) ?? 0) + 1);
  return n;
}

function aRecinto(r: { id: string; codigoRecinto: string; nombre: string }): RecintoParejaCda {
  return { id: r.id, codigo: r.codigoRecinto, nombre: r.nombre };
}

function aFila(p: ParejaConRelaciones, evento: Evento | null, primera: boolean, compartido: boolean): ParejaCdaFila {
  const { usuarioId, ...operador } = p.operador;
  let estado: EstadoParejaCda;
  if (!primera) estado = 'SOLO_REGISTRADA';
  else if (!evento) estado = 'PENDIENTE_EVENTO';
  else if (p.kit && p.kit.eventoId === evento.id && p.kit.operadorId === usuarioId) estado = 'EN_APP';
  else estado = 'SIN_KIT';
  return {
    id: p.id,
    fecha: diaDeFechaDb(p.fecha),
    recinto: aRecinto(p.recinto),
    operador,
    asistente: p.asistente,
    kitCodigo: p.kit?.codigoUnico ?? null,
    estado,
    recintoCompartido: compartido,
    articulos: p.articulos,
  };
}

