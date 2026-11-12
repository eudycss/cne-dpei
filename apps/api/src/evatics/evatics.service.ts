import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import {
  SIN_CANTON_EVATICS,
  SIN_TECNICO_EVATICS,
  coincideBusqueda,
  normalizarBusqueda,
  type FiltrosEvaticsInput,
} from '@cne/shared-validation';
import type {
  AnalisisCertificadoEvatics,
  CentroEvatics,
  ConfigEvatics,
  ConsultaEvaticsPublica,
  ConteoEvatics,
  DecisionEvatics,
  EstadoAnalisisEvatics,
  EstadoCertificadoEvatics,
  FilaEvatics,
  GrupoConteoEvatics,
  ListadoEvatics,
  RoleName,
  SubidaEvaticsResult,
} from '@cne/shared-types';

import { PrismaService } from '../db/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DistributivoTecnicosClient, tecnicosPorRecinto } from '../enlaces/distributivo-tecnicos.client';
import { limpiarJpeg } from '../operadores-cda/jpeg';
import { diaDeFechaDb, diaEcuador, fechaDb } from '../operadores-cda/dia-ecuador';
import { LectorNoConfigurado, LectorRespuestaInvalida, type LecturaCertificado } from './lector-certificado';
import { LectorCertificadoService } from './lector-certificado.service';
import { nombreCoincide, nombreCorto, nombreCortoDeApellidosNombres } from './nombre-evatics';

/** La página la reduce a ~1600 px (unos 400 KB): 2 MB deja margen sin aceptar fotos crudas. */
export const MAX_CERTIFICADO_BYTES = 2 * 1024 * 1024;
const CATEGORIA = 'certificados-evatics';
export const CEDULA_NO_REGISTRADA = 'Cédula no registrada en el personal CDA, CPE ni Asistentes Transversales';
const YA_APROBADO = 'Sus notas ya fueron recibidas: no hace falta subirlas de nuevo';
/**
 * Subidas por cédula y día (Ecuador). Con la cédula de otro se podría pisar su
 * foto: el límite y la foto anterior guardada lo frenan y lo dejan a la vista.
 */
export const MAX_SUBIDAS_POR_DIA = 5;
export const DEMASIADAS_SUBIDAS = `Ya se subieron ${MAX_SUBIDAS_POR_DIA} fotos con esta cédula hoy. Intente mañana o pida ayuda a la Delegación.`;
export const FOTO_CAMBIO = 'La foto cambió: revísela de nuevo';
const OTRA_SUBIDA = 'Se está subiendo otra foto con esta cédula: intente de nuevo';
/** Errores pasajeros (cuota gratuita, red): se reintenta con espera creciente hasta este número. */
export const MAX_INTENTOS_ANALISIS = 5;
/** Por vuelta del cron. */
const ANALISIS_POR_VUELTA = 4;
/** Días que se guardan fotos y datos tras la fecha límite: lo promete el aviso LOPDP de la página pública. */
export const DIAS_RETENCION_EVATICS = 90;
const LOTE_PURGA = 100;

/** "2026-11-20" + 90 → "2027-02-18". */
export function sumarDias(dia: string, dias: number): string {
  const d = fechaDb(dia);
  d.setUTCDate(d.getUTCDate() + dias);
  return diaDeFechaDb(d);
}
/**
 * Tope de lecturas por minuto entre subidas y cron (en memoria): la llave
 * gratuita la comparte el asistente del bot. Lo que pase el tope espera en cola.
 */
export const MAX_ANALISIS_POR_MINUTO = 10;
/** Mientras se analiza (al subir o en el cron), nadie más lo toma. */
const RESERVA_ANALISIS_MS = 3 * 60_000;
/**
 * Lo más que espera la persona al subir (con dos proveedores, cada uno con su
 * límite de 20 s, podría pasar de 40 s). Si se pasa, la lectura sigue sola y
 * guarda su resultado; la respuesta no espera.
 */
export const ESPERA_MAX_ANALISIS_AL_SUBIR_MS = 25_000;
const ROL_AT = 'ASISTENTE_TRANSVERSAL';

/** Quien consulta o revisa: su cuenta y sus roles (del token). */
export interface ActorEvatics {
  sub: string;
  roles: RoleName[];
}

/** Una persona que debe subir el certificado. */
export interface PersonaEvatics {
  cedula: string;
  apellidosNombres: string;
  nombreCorto: string;
  cargo: string;
  centro: CentroEvatics;
  operadorId: string | null;
  usuarioId: string | null;
}

type CertificadoGuardado = {
  id: string;
  cedula: string;
  subidoEn: Date;
  estado: string;
  motivoRechazo: string | null;
  revisadoEn: Date | null;
  revisadoPor?: { nombres: string; apellidos: string } | null;
  reemplazos: number;
  fotoAnteriorKey: string | null;
  fotoAnteriorSubidaEn: Date | null;
  analisisEstado: string;
  nombreLeido: string | null;
  nombreCoincide: boolean | null;
  esCertificado: boolean | null;
  legible: boolean | null;
  analizadoEn: Date | null;
  analisisProveedor: string | null;
};

interface SubidaGuardada {
  id: string;
  /** 0 = primera subida; 1, 2… = número de reemplazo (bitácora). */
  reemplazo: number;
  /** Foto que ya no se conserva y se borra de Storage. */
  borrar: string | null;
}

/** Cualquiera que no sea administrador (supervisor o Asistente Transversal con el permiso) no revisa su propio certificado. */
function aplicaReglaPropia(actor: ActorEvatics): boolean {
  return !actor.roles.includes('ADMINISTRADOR');
}

/** Espera antes del reintento n (1, 2, 3…): 2, 4, 8, 16 min. */
export function esperaReintento(intento: number): number {
  return 2 ** Math.min(intento, 5) * 60_000;
}

/** El valor de la promesa, o null si tarda más de `ms` (la promesa sigue). */
async function conTope<T>(promesa: Promise<T | null>, ms: number): Promise<T | null> {
  let reloj: NodeJS.Timeout | undefined;
  const tope = new Promise<null>((resolve) => {
    reloj = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([promesa, tope]);
  } finally {
    clearTimeout(reloj);
  }
}

/** Error de clave única de Prisma (dos primeras subidas a la vez con la misma cédula). */
const esClaveDuplicada = (e: unknown) => (e as { code?: unknown } | null)?.code === 'P2002';

/** Para los logs: solo el tipo o el código del error, nunca su mensaje (el de Prisma puede traer datos). */
const nombreError = (e: unknown) => {
  const x = e as { code?: unknown; name?: unknown } | null;
  return String(x?.code ?? x?.name ?? 'Error');
};

const vacio = (): ConteoEvatics => ({ total: 0, sinSubir: 0, pendientes: 0, aprobados: 0, rechazados: 0 });

function sumar(c: ConteoEvatics, estado: EstadoCertificadoEvatics): void {
  c.total++;
  if (estado === 'SIN_SUBIR') c.sinSubir++;
  else if (estado === 'PENDIENTE') c.pendientes++;
  else if (estado === 'APROBADO') c.aprobados++;
  else c.rechazados++;
}

/** Conteos por grupo, de más a menos personas (a igual cifra, por nombre). */
function agrupar(filas: FilaEvatics[], clave: (f: FilaEvatics) => string): GrupoConteoEvatics[] {
  const grupos = new Map<string, ConteoEvatics>();
  for (const f of filas) {
    const k = clave(f);
    const c = grupos.get(k) ?? vacio();
    sumar(c, f.estado);
    grupos.set(k, c);
  }
  return [...grupos]
    .map(([nombre, c]) => ({ nombre, ...c }))
    .sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, 'es'));
}

const mismo = (a: string, b: string) => normalizarBusqueda(a.trim()) === normalizarBusqueda(b.trim());

function analisisDto(c: CertificadoGuardado): AnalisisCertificadoEvatics {
  return {
    estado: c.analisisEstado as EstadoAnalisisEvatics,
    nombreLeido: c.nombreLeido,
    nombreCoincide: c.nombreCoincide,
    esCertificado: c.esCertificado,
    legible: c.legible,
    analizadoEn: c.analizadoEn?.toISOString() ?? null,
    proveedor: c.analisisProveedor,
  };
}

/** Qué decirle a la persona justo después de subir, según lo que leyó la IA (nunca el nombre leído). */
export function avisoParaLaPersona(lectura: LecturaCertificado | null): string | null {
  if (!lectura) return null;
  if (!lectura.esCertificadoEvatics) {
    return 'La imagen no parece una prueba de Evatics (certificado o captura del curso). Revise que sea la correcta y vuelva a subirla.';
  }
  if (!lectura.legible) {
    return 'No se lee bien la imagen. Súbala otra vez con buena luz, sin reflejos y completa.';
  }
  if (!lectura.nombreLeido) {
    return 'Recibida, pero no se ve su nombre en la imagen. Un supervisor la revisará; si puede, suba una captura donde aparezca su nombre.';
  }
  if (!lectura.cursoCompleto) {
    return 'Enviado a revisión.';
  }
  return null;
}

/**
 * Certificados Evatics: la persona sube la foto desde la página pública
 * validando su cédula; un modelo de visión (Gemini o Groq) lee el nombre (solo
 * sugiere) y el supervisor aprueba o rechaza. El listado se agrupa por cantón
 * (del último recinto asignado en Parejas) y por Asistente Transversal
 * (distributivo del Drive).
 */
@Injectable()
export class EvaticsService {
  private readonly log = new Logger(EvaticsService.name);
  private analizando = false;
  /** Momentos de las últimas lecturas (ventana de un minuto) para MAX_ANALISIS_POR_MINUTO. */
  private readonly lecturasRecientes: number[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly lector: LectorCertificadoService,
    private readonly distributivo: DistributivoTecnicosClient,
  ) {}

  // ---------- Página pública ----------

  async consultar(cedula: string): Promise<ConsultaEvaticsPublica> {
    const persona = await this.personaPorCedula(cedula);
    if (!persona) throw new NotFoundException(CEDULA_NO_REGISTRADA);
    const [certificado, plazo] = await Promise.all([
      this.prisma.certificadoEvatics.findUnique({ where: { cedula }, select: { estado: true, motivoRechazo: true } }),
      this.plazo(),
    ]);
    const estado = (certificado?.estado ?? 'SIN_SUBIR') as EstadoCertificadoEvatics;
    return {
      nombreCorto: persona.nombreCorto,
      cargo: persona.cargo,
      estado,
      // Solo el motivo de un rechazo vigente: lo necesita para subir otra foto.
      motivoRechazo: estado === 'RECHAZADO' ? (certificado?.motivoRechazo ?? null) : null,
      fechaLimite: plazo.fechaLimite,
      plazoVencido: plazo.vencido,
      puedeSubir: !plazo.vencido && estado !== 'APROBADO',
    };
  }

  /**
   * Guarda la foto (sin metadatos y cifrada) y la deja PENDIENTE. Reemplaza la
   * anterior mientras no esté aprobada, pero la conserva como "foto anterior"
   * para que el supervisor vea el cambio (ver guardarSubida). Hasta
   * MAX_SUBIDAS_POR_DIA por cédula y día. Con un lector configurado, la
   * analiza en el momento para avisar si no se lee; si no, queda en cola.
   */
  async subir(
    cedula: string,
    file: Express.Multer.File | undefined,
    version: string,
  ): Promise<{ certificadoId: string; reemplazo: number; resultado: SubidaEvaticsResult }> {
    const persona = await this.personaPorCedula(cedula);
    if (!persona) throw new NotFoundException(CEDULA_NO_REGISTRADA);
    const plazo = await this.plazo();
    if (plazo.vencido) {
      throw new ForbiddenException(
        `El plazo para subir el certificado terminó el ${plazo.fechaLimite!.split('-').reverse().join('/')}`,
      );
    }
    const hoy = diaEcuador();
    const previo = await this.prisma.certificadoEvatics.findUnique({
      where: { cedula },
      select: { estado: true, subidasDia: true, subidasHoy: true },
    });
    if (previo?.estado === 'APROBADO') throw new ConflictException(YA_APROBADO);
    if (previo && previo.subidasDia === hoy && previo.subidasHoy >= MAX_SUBIDAS_POR_DIA) {
      throw new HttpException(DEMASIADAS_SUBIDAS, HttpStatus.TOO_MANY_REQUESTS);
    }

    const jpeg = file?.buffer && file.size <= MAX_CERTIFICADO_BYTES ? limpiarJpeg(file.buffer) : null;
    if (!jpeg) throw new BadRequestException('La foto debe ser una imagen JPG válida de hasta 2 MB. Intente de nuevo.');

    const fotoKey = await this.storage.saveEncrypted({
      categoria: CATEGORIA,
      buffer: jpeg.limpio,
      maxBytes: MAX_CERTIFICADO_BYTES,
    });
    const ahora = new Date();
    const reinicio = {
      fotoKey,
      subidoEn: ahora,
      consentimientoVersion: version,
      estado: 'PENDIENTE',
      motivoRechazo: null,
      revisadoPorId: null,
      revisadoEn: null,
      analisisEstado: 'EN_COLA',
      analisisIntentos: 0,
      // Reservado para el análisis de ahora mismo: el cron no lo toma a la vez.
      analisisSiguiente: new Date(ahora.getTime() + RESERVA_ANALISIS_MS),
      nombreLeido: null,
      nombreCoincide: null,
      esCertificado: null,
      legible: null,
      analizadoEn: null,
      analisisProveedor: null,
    };
    let guardado: SubidaGuardada | null = null;
    try {
      // Bloqueo optimista: si otra subida cambió la fila entre la lectura y la escritura, se relee y se decide una vez más.
      for (let vuelta = 0; vuelta < 2 && !guardado; vuelta++) {
        guardado = await this.prisma.$transaction((tx) => this.guardarSubida(tx, cedula, hoy, reinicio));
      }
      if (!guardado) throw new ConflictException(OTRA_SUBIDA);
    } catch (e) {
      // La foto nueva ya está en Storage: si no quedó guardada en la fila, se borra (sin huérfanos).
      await this.borrarArchivo(fotoKey);
      if (esClaveDuplicada(e)) throw new ConflictException(OTRA_SUBIDA);
      throw e;
    }
    if (guardado.borrar) await this.borrarArchivo(guardado.borrar);

    // La foto ya quedó guardada: un fallo al leerla no cambia la respuesta (queda en cola).
    const lectura = this.lector.disponible()
      ? await conTope(
          this.analizar(guardado.id, fotoKey, jpeg.limpio, persona.apellidosNombres).catch((e) => {
            this.log.warn(`Análisis Evatics al subir no disponible: ${nombreError(e)}`);
            return null;
          }),
          ESPERA_MAX_ANALISIS_AL_SUBIR_MS,
        )
      : null;
    return {
      certificadoId: guardado.id,
      reemplazo: guardado.reemplazo,
      resultado: { ok: true, estado: 'PENDIENTE', aviso: avisoParaLaPersona(lectura) },
    };
  }

  /**
   * Escribe la subida sobre la fila tal como se leyó (instantánea en el where).
   * Devuelve null si otra subida la cambió entretanto (se reintenta).
   *
   * Foto anterior: si la actual ya la revisó alguien (RECHAZADO), pasa a ser la
   * anterior y se borra la anterior vieja. Si seguía PENDIENTE, la anterior se
   * conserva tal cual y se borra la actual (una intermedia que nadie revisó): así
   * la primera foto pendiente sobrevive a cualquier cantidad de reemplazos hasta
   * que alguien revise. Si no había anterior, la actual pasa a serlo.
   */
  private async guardarSubida(
    tx: Pick<PrismaService, 'certificadoEvatics'>,
    cedula: string,
    hoy: string,
    reinicio: Omit<Prisma.CertificadoEvaticsUncheckedCreateInput, 'cedula'>,
  ): Promise<SubidaGuardada | null> {
    const actual = await tx.certificadoEvatics.findUnique({
      where: { cedula },
      select: {
        id: true,
        estado: true,
        fotoKey: true,
        subidoEn: true,
        fotoAnteriorKey: true,
        reemplazos: true,
        subidasDia: true,
        subidasHoy: true,
      },
    });
    if (!actual) {
      const nuevo = await tx.certificadoEvatics.create({
        data: { cedula, ...reinicio, subidasDia: hoy, subidasHoy: 1 },
        select: { id: true },
      });
      return { id: nuevo.id, reemplazo: 0, borrar: null };
    }
    if (actual.estado === 'APROBADO') throw new ConflictException(YA_APROBADO);
    if (actual.subidasDia === hoy && actual.subidasHoy >= MAX_SUBIDAS_POR_DIA) {
      throw new HttpException(DEMASIADAS_SUBIDAS, HttpStatus.TOO_MANY_REQUESTS);
    }
    const rotar = actual.estado === 'RECHAZADO' || !actual.fotoAnteriorKey;
    const reemplazo = actual.reemplazos + 1;
    const r = await tx.certificadoEvatics.updateMany({
      where: {
        id: actual.id,
        estado: actual.estado,
        fotoKey: actual.fotoKey,
        reemplazos: actual.reemplazos,
        subidasDia: actual.subidasDia,
        subidasHoy: actual.subidasHoy,
      },
      data: {
        ...reinicio,
        ...(rotar ? { fotoAnteriorKey: actual.fotoKey, fotoAnteriorSubidaEn: actual.subidoEn } : {}),
        reemplazos: reemplazo,
        subidasDia: hoy,
        subidasHoy: actual.subidasDia === hoy ? actual.subidasHoy + 1 : 1,
      },
    });
    if (r.count === 0) return null;
    return { id: actual.id, reemplazo, borrar: rotar ? actual.fotoAnteriorKey : actual.fotoKey };
  }

  // ---------- Supervisores ----------

  async listado(filtros: FiltrosEvaticsInput, actor: ActorEvatics): Promise<ListadoEvatics> {
    const [personas, certificados, plazo, propia, tecnicos] = await Promise.all([
      this.personas(),
      this.prisma.certificadoEvatics.findMany({ include: { revisadoPor: { select: { nombres: true, apellidos: true } } } }),
      this.plazo(),
      this.cedulasPropias(actor),
      this.tecnicosPorRecinto(),
    ]);
    const ubicaciones = await this.ubicaciones(personas.flatMap((p) => (p.operadorId ? [p.operadorId] : [])));
    const porCedula = new Map(certificados.map((c) => [c.cedula, c]));

    const todas: FilaEvatics[] = personas.map((p) => {
      const c = porCedula.get(p.cedula);
      const lugar = p.operadorId ? ubicaciones.get(p.operadorId) : undefined;
      const tecnico = lugar && tecnicos ? tecnicos.get(lugar.codigoRecinto) : undefined;
      return {
        certificadoId: c?.id ?? null,
        cedula: p.cedula,
        apellidosNombres: p.apellidosNombres,
        cargo: p.cargo,
        centro: p.centro,
        canton: lugar?.canton ?? SIN_CANTON_EVATICS,
        tecnico: tecnico || SIN_TECNICO_EVATICS,
        estado: (c?.estado ?? 'SIN_SUBIR') as EstadoCertificadoEvatics,
        subidoEn: c?.subidoEn.toISOString() ?? null,
        reemplazos: c?.reemplazos ?? 0,
        tieneFotoAnterior: !!c?.fotoAnteriorKey,
        fotoAnteriorSubidaEn: c?.fotoAnteriorKey ? (c.fotoAnteriorSubidaEn?.toISOString() ?? null) : null,
        revisadoPor: c?.revisadoPor ? `${c.revisadoPor.nombres} ${c.revisadoPor.apellidos}` : null,
        revisadoEn: c?.revisadoEn?.toISOString() ?? null,
        motivoRechazo: c?.motivoRechazo ?? null,
        analisis: c ? analisisDto(c) : null,
        esPropio: propia.has(p.cedula),
      };
    });
    todas.sort(
      (a, b) => a.canton.localeCompare(b.canton, 'es') || a.apellidosNombres.localeCompare(b.apellidosNombres, 'es'),
    );

    const totales = vacio();
    for (const f of todas) sumar(totales, f.estado);
    const filas = todas.filter(
      (f) =>
        (!filtros.canton || mismo(f.canton, filtros.canton)) &&
        (!filtros.cargo || mismo(f.cargo, filtros.cargo)) &&
        (!filtros.tecnico || mismo(f.tecnico, filtros.tecnico)) &&
        (!filtros.estado || f.estado === filtros.estado) &&
        coincideBusqueda([f.apellidosNombres, f.cedula], filtros.q ?? ''),
    );
    return {
      fechaLimite: plazo.fechaLimite,
      plazoVencido: plazo.vencido,
      analisisDisponible: this.lector.disponible(),
      distributivoDisponible: tecnicos !== null,
      totales,
      porCanton: agrupar(todas, (f) => f.canton),
      porTecnico: agrupar(todas, (f) => f.tecnico),
      cargos: [...new Set(todas.map((f) => f.cargo))].sort((a, b) => a.localeCompare(b, 'es')),
      filas,
    };
  }

  /**
   * La foto descifrada (la actual o la anterior, para comparar un reemplazo).
   * Con `version` (subidoEn de la foto que muestra la web), 409 si ya no es esa.
   */
  async foto(id: string, anterior = false, version?: Date): Promise<Buffer> {
    const c = await this.prisma.certificadoEvatics.findUnique({
      where: { id },
      select: { fotoKey: true, subidoEn: true, fotoAnteriorKey: true, fotoAnteriorSubidaEn: true },
    });
    if (!c) throw new NotFoundException('Certificado no encontrado');
    const clave = anterior ? c.fotoAnteriorKey : c.fotoKey;
    if (!clave) throw new NotFoundException('Este certificado no tiene foto anterior');
    const subidaEn = anterior ? c.fotoAnteriorSubidaEn : c.subidoEn;
    if (version && subidaEn?.getTime() !== version.getTime()) throw new ConflictException(FOTO_CAMBIO);
    return this.storage.readDecrypted(clave);
  }

  /**
   * Aprueba o rechaza (con motivo). Se puede cambiar la decisión; nunca sobre
   * el propio certificado. `subidoEn` es la foto que vio quien revisa: si la
   * persona subió otra entretanto, no se decide sobre una foto que no vio.
   */
  async revisar(
    id: string,
    decision: DecisionEvatics,
    motivo: string | undefined,
    subidoEn: string,
    actor: ActorEvatics,
  ): Promise<{ id: string; estado: DecisionEvatics; revisadoEn: string }> {
    const c = await this.prisma.certificadoEvatics.findUnique({ where: { id }, select: { cedula: true } });
    if (!c) throw new NotFoundException('Certificado no encontrado');
    if ((await this.cedulasPropias(actor)).has(c.cedula)) {
      throw new ForbiddenException('No puede revisar su propio certificado: lo revisa otro supervisor');
    }
    const revisadoEn = new Date();
    const r = await this.prisma.certificadoEvatics.updateMany({
      where: { id, subidoEn: new Date(subidoEn) },
      data: {
        estado: decision,
        motivoRechazo: decision === 'RECHAZADO' ? (motivo?.trim() ?? null) : null,
        revisadoPorId: actor.sub,
        revisadoEn,
        // Rechazado: puede corregir hoy mismo aunque alguien haya gastado sus subidas del día.
        ...(decision === 'RECHAZADO' ? { subidasHoy: 0 } : {}),
      },
    });
    if (r.count === 0) throw new ConflictException(FOTO_CAMBIO);
    return { id, estado: decision, revisadoEn: revisadoEn.toISOString() };
  }

  async config(): Promise<ConfigEvatics> {
    return { fechaLimite: (await this.plazo()).fechaLimite };
  }

  /** Una fecha tan vieja que la purga de la madrugada lo borraría todo se rechaza (borrado irreversible). */
  async guardarConfig(fechaLimite: string | null): Promise<ConfigEvatics> {
    if (fechaLimite && diaEcuador() > sumarDias(fechaLimite, DIAS_RETENCION_EVATICS)) {
      throw new BadRequestException(
        `Con esa fecha se borrarían esta madrugada todos los certificados (se guardan ${DIAS_RETENCION_EVATICS} días después de la fecha límite). Elija el ${sumarDias(diaEcuador(), -DIAS_RETENCION_EVATICS)} o una fecha posterior.`,
      );
    }
    const valor = fechaLimite ? fechaDb(fechaLimite) : null;
    await this.prisma.configEvatics.upsert({
      where: { id: 1 },
      create: { id: 1, fechaLimite: valor },
      update: { fechaLimite: valor },
    });
    return { fechaLimite };
  }

  // ---------- Análisis con el modelo de visión ----------

  /**
   * Reintenta los análisis en cola (subidos sin llave, o que fallaron por la
   * cuota o la red). Cada uno se reclama antes de leerlo (otra instancia o la
   * subida no lo toman a la vez) y un fallo en uno no frena a los demás; ante
   * un fallo general de los proveedores se detiene para no gastar la cuota.
   */
  @Cron('*/2 * * * *', { name: 'analizar-certificados-evatics', timeZone: 'America/Guayaquil' })
  async analizarPendientes(ahora = new Date()): Promise<number> {
    if (!this.lector.disponible() || this.analizando) return 0;
    this.analizando = true;
    let analizados = 0;
    try {
      const pendientes = await this.prisma.certificadoEvatics.findMany({
        where: { analisisEstado: 'EN_COLA', OR: [{ analisisSiguiente: null }, { analisisSiguiente: { lte: ahora } }] },
        orderBy: { subidoEn: 'asc' },
        take: ANALISIS_POR_VUELTA,
        select: { id: true, cedula: true, fotoKey: true },
      });
      for (const p of pendientes) {
        const reclamado = await this.prisma.certificadoEvatics.updateMany({
          where: {
            id: p.id,
            fotoKey: p.fotoKey,
            analisisEstado: 'EN_COLA',
            OR: [{ analisisSiguiente: null }, { analisisSiguiente: { lte: ahora } }],
          },
          data: { analisisSiguiente: new Date(ahora.getTime() + RESERVA_ANALISIS_MS) },
        });
        if (reclamado.count !== 1) continue;
        try {
          const persona = await this.personaPorCedula(p.cedula);
          if (!persona) {
            await this.marcarNoDisponible(p.id, p.fotoKey);
            continue;
          }
          const jpeg = await this.storage.readDecrypted(p.fotoKey);
          const lectura = await this.analizar(p.id, p.fotoKey, jpeg, persona.apellidosNombres);
          if (!lectura) break; // proveedores sin respuesta o tope por minuto: la próxima vuelta
          analizados++;
        } catch (e) {
          // P. ej. la foto no se pudo leer del Storage: cuenta como intento y se sigue con el siguiente.
          this.log.warn(`Certificado Evatics ${p.id} no se pudo analizar: ${nombreError(e)}`);
          await this.registrarFallo(p.id, p.fotoKey, true).catch(() => undefined);
        }
      }
    } catch (e) {
      this.log.error(`No se pudieron revisar los certificados Evatics en cola: ${nombreError(e)}`);
    } finally {
      this.analizando = false;
    }
    return analizados;
  }

  /**
   * Analiza una foto y guarda lo leído (solo si sigue siendo la misma foto).
   * Devuelve la lectura, o null si quedó en cola o sin análisis.
   */
  private async analizar(id: string, fotoKey: string, jpeg: Buffer, esperado: string): Promise<LecturaCertificado | null> {
    if (!this.tomarCupo()) {
      // Tope por minuto: espera en cola sin llamar a la IA y sin gastar un intento.
      await this.prisma.certificadoEvatics.updateMany({
        where: { id, fotoKey },
        data: { analisisEstado: 'EN_COLA', analisisSiguiente: new Date(Date.now() + 60_000) },
      });
      return null;
    }
    try {
      const { lectura, proveedor } = await this.lector.leer(jpeg, 'image/jpeg');
      await this.prisma.certificadoEvatics.updateMany({
        where: { id, fotoKey },
        data: {
          analisisEstado: 'LISTO',
          analisisSiguiente: null,
          nombreLeido: lectura.nombreLeido,
          nombreCoincide: lectura.nombreLeido ? nombreCoincide(lectura.nombreLeido, esperado) : null,
          esCertificado: lectura.esCertificadoEvatics,
          legible: lectura.legible,
          analizadoEn: new Date(),
          analisisProveedor: proveedor,
        },
      });
      return lectura;
    } catch (e) {
      // Sin remedio solo si los proveedores lo dicen (400, 401, formato) o no hay llaves; lo demás
      // (cuota, red, base de datos…) se reintenta en cola.
      const pasajero = !(e instanceof LectorRespuestaInvalida || e instanceof LectorNoConfigurado);
      this.log.warn(`Análisis Evatics ${pasajero ? 'en cola' : 'no disponible'}: ${nombreError(e)}`);
      await this.registrarFallo(id, fotoKey, pasajero);
      return null;
    }
  }

  /** Suma un intento: vuelve a la cola con espera creciente, o queda NO_DISPONIBLE. */
  private async registrarFallo(id: string, fotoKey: string, pasajero: boolean): Promise<void> {
    // Atómico: dos fallos a la vez suman dos intentos. Si la foto cambió, no se toca.
    const r = await this.prisma.certificadoEvatics.updateMany({
      where: { id, fotoKey },
      data: { analisisIntentos: { increment: 1 } },
    });
    if (r.count === 0) return;
    const actual = await this.prisma.certificadoEvatics.findUnique({ where: { id }, select: { analisisIntentos: true } });
    const intentos = actual?.analisisIntentos ?? MAX_INTENTOS_ANALISIS;
    if (!pasajero || intentos >= MAX_INTENTOS_ANALISIS) {
      await this.marcarNoDisponible(id, fotoKey);
      return;
    }
    await this.prisma.certificadoEvatics.updateMany({
      where: { id, fotoKey },
      data: { analisisEstado: 'EN_COLA', analisisSiguiente: new Date(Date.now() + esperaReintento(intentos)) },
    });
  }

  private async marcarNoDisponible(id: string, fotoKey: string): Promise<void> {
    await this.prisma.certificadoEvatics.updateMany({
      where: { id, fotoKey },
      data: { analisisEstado: 'NO_DISPONIBLE', analisisSiguiente: null },
    });
  }

  /** true y cuenta la lectura si no se pasó MAX_ANALISIS_POR_MINUTO en el último minuto. */
  private tomarCupo(ahora = Date.now()): boolean {
    while (this.lecturasRecientes.length && this.lecturasRecientes[0] <= ahora - 60_000) this.lecturasRecientes.shift();
    if (this.lecturasRecientes.length >= MAX_ANALISIS_POR_MINUTO) return false;
    this.lecturasRecientes.push(ahora);
    return true;
  }

  // ---------- Personas ----------

  /** Todo el personal activo (CDA y CPE) más los usuarios Asistente Transversal; uno por cédula. */
  async personas(): Promise<PersonaEvatics[]> {
    const [operadores, usuarios] = await Promise.all([
      this.prisma.operadorCda.findMany({
        where: { activo: true },
        select: {
          id: true,
          cedula: true,
          apellidosNombres: true,
          usuarioId: true,
          cargoCda: { select: { nombre: true, centro: true } },
        },
      }),
      this.prisma.usuario.findMany({
        where: { activo: true, roles: { some: { rol: { nombre: ROL_AT } } } },
        select: { id: true, cedula: true, nombres: true, apellidos: true },
      }),
    ]);
    const porCedula = new Map<string, PersonaEvatics>();
    for (const o of operadores) porCedula.set(o.cedula, this.deOperador(o));
    for (const u of usuarios) if (!porCedula.has(u.cedula)) porCedula.set(u.cedula, this.deUsuario(u));
    return [...porCedula.values()];
  }

  async personaPorCedula(cedula: string): Promise<PersonaEvatics | null> {
    const o = await this.prisma.operadorCda.findUnique({
      where: { cedula },
      select: {
        id: true,
        cedula: true,
        apellidosNombres: true,
        usuarioId: true,
        activo: true,
        cargoCda: { select: { nombre: true, centro: true } },
      },
    });
    if (o?.activo) return this.deOperador(o);
    const u = await this.prisma.usuario.findFirst({
      where: { cedula, activo: true, roles: { some: { rol: { nombre: ROL_AT } } } },
      select: { id: true, cedula: true, nombres: true, apellidos: true },
    });
    return u ? this.deUsuario(u) : null;
  }

  private deOperador(o: {
    id: string;
    cedula: string;
    apellidosNombres: string;
    usuarioId: string | null;
    cargoCda: { nombre: string; centro: string };
  }): PersonaEvatics {
    return {
      cedula: o.cedula,
      apellidosNombres: o.apellidosNombres,
      nombreCorto: nombreCortoDeApellidosNombres(o.apellidosNombres),
      cargo: o.cargoCda.nombre,
      centro: o.cargoCda.centro === 'CPE' ? 'CPE' : 'CDA',
      operadorId: o.id,
      usuarioId: o.usuarioId,
    };
  }

  private deUsuario(u: { id: string; cedula: string; nombres: string; apellidos: string }): PersonaEvatics {
    return {
      cedula: u.cedula,
      apellidosNombres: `${u.apellidos} ${u.nombres}`.trim().toUpperCase(),
      nombreCorto: nombreCorto(u.nombres, u.apellidos),
      cargo: 'Asistente Transversal',
      centro: 'AT',
      operadorId: null,
      usuarioId: u.id,
    };
  }

  /**
   * Cédulas que quien revisa no puede revisar: la de su cuenta y la de la fila
   * del personal vinculada a su cuenta. Vacío para el administrador.
   */
  private async cedulasPropias(actor: ActorEvatics): Promise<Set<string>> {
    if (!aplicaReglaPropia(actor)) return new Set();
    const [usuario, vinculada] = await Promise.all([
      this.prisma.usuario.findUnique({ where: { id: actor.sub }, select: { cedula: true } }),
      this.prisma.operadorCda.findFirst({ where: { usuarioId: actor.sub }, select: { cedula: true } }),
    ]);
    return new Set([usuario?.cedula, vinculada?.cedula].filter((c): c is string => !!c));
  }

  /** Cantón y código del último recinto al que fue asignada cada persona en Parejas. */
  private async ubicaciones(operadorIds: string[]): Promise<Map<string, { canton: string; codigoRecinto: string }>> {
    const resultado = new Map<string, { canton: string; codigoRecinto: string }>();
    if (operadorIds.length === 0) return resultado;
    const parejas = await this.prisma.parejaCda.findMany({
      where: {
        recintoId: { not: null },
        OR: [{ operadorCdaId: { in: operadorIds } }, { asistenteCdaId: { in: operadorIds } }],
      },
      orderBy: { fecha: 'desc' },
      select: {
        operadorCdaId: true,
        asistenteCdaId: true,
        recinto: { select: { codigoRecinto: true, canton: { select: { nombre: true } } } },
      },
    });
    for (const p of parejas) {
      if (!p.recinto) continue;
      const lugar = { canton: p.recinto.canton.nombre, codigoRecinto: p.recinto.codigoRecinto };
      for (const id of [p.operadorCdaId, p.asistenteCdaId]) {
        if (id && !resultado.has(id)) resultado.set(id, lugar);
      }
    }
    return resultado;
  }

  /** Técnico (Asistente Transversal) de cada recinto, o null si el Drive no responde: el listado sigue. */
  private async tecnicosPorRecinto(): Promise<Map<string, string> | null> {
    try {
      return tecnicosPorRecinto(await this.distributivo.asignaciones());
    } catch (e) {
      this.log.warn(`Evatics sin distributivo de técnicos: ${nombreError(e)}`);
      return null;
    }
  }

  /**
   * Qué certificados ya cumplieron la retención que promete el aviso LOPDP:
   * todos, pasados DIAS_RETENCION_EVATICS días de la fecha límite; sin fecha
   * límite, los subidos hace más de esos días. null = ninguno todavía.
   */
  private async vencidosPorRetencion(ahora: Date): Promise<Prisma.CertificadoEvaticsWhereInput | null> {
    const { fechaLimite } = await this.plazo();
    if (fechaLimite) return diaEcuador(ahora) > sumarDias(fechaLimite, DIAS_RETENCION_EVATICS) ? {} : null;
    return { subidoEn: { lt: new Date(ahora.getTime() - DIAS_RETENCION_EVATICS * 24 * 60 * 60 * 1000) } };
  }

  /**
   * Retención (cron diario): borra las fotos cifradas (actual y anterior) y
   * luego la fila. Si una foto no se pudo borrar, la fila se conserva para que
   * la próxima vuelta lo reintente (borrar un archivo que ya no está no falla);
   * así nunca queda una foto sin fila que la apunte. Se recorre con cursor
   * para no releer las que fallaron. La bitácora de auditoría (sin cédula ni
   * foto) se conserva.
   */
  @Cron('30 3 * * *', { name: 'purgar-certificados-evatics', timeZone: 'America/Guayaquil' })
  async purgarVencidos(ahora = new Date()): Promise<number> {
    const vencidos = await this.vencidosPorRetencion(ahora);
    if (!vencidos) return 0;
    let borrados = 0;
    let fallidos = 0;
    let ultimoId: string | undefined;
    for (;;) {
      const lote = await this.prisma.certificadoEvatics.findMany({
        where: ultimoId ? { AND: [vencidos, { id: { gt: ultimoId } }] } : vencidos,
        orderBy: { id: 'asc' },
        take: LOTE_PURGA,
        select: { id: true, fotoKey: true, fotoAnteriorKey: true },
      });
      if (lote.length === 0) break;
      ultimoId = lote[lote.length - 1].id;
      const listos: string[] = [];
      for (const c of lote) {
        const actual = await this.borrarArchivo(c.fotoKey);
        const anterior = c.fotoAnteriorKey ? await this.borrarArchivo(c.fotoAnteriorKey) : true;
        if (actual && anterior) listos.push(c.id);
        else fallidos++;
      }
      if (listos.length > 0) {
        borrados += (await this.prisma.certificadoEvatics.deleteMany({ where: { id: { in: listos } } })).count;
      }
      if (lote.length < LOTE_PURGA) break;
    }
    if (borrados > 0) {
      this.log.log(`Retención: ${borrados} certificado(s) Evatics borrados (fotos y datos) tras ${DIAS_RETENCION_EVATICS} días`);
    }
    if (fallidos > 0) {
      this.log.warn(`Retención: ${fallidos} certificado(s) Evatics con fotos sin borrar; se reintenta mañana`);
    }
    return borrados;
  }

  private async plazo(): Promise<{ fechaLimite: string | null; vencido: boolean }> {
    const config = await this.prisma.configEvatics.findUnique({ where: { id: 1 }, select: { fechaLimite: true } });
    const fechaLimite = config?.fechaLimite ? diaDeFechaDb(config.fechaLimite) : null;
    return { fechaLimite, vencido: !!fechaLimite && diaEcuador() > fechaLimite };
  }

  /** Un archivo huérfano no debe tumbar la respuesta: se registra y se sigue. true si se borró. */
  private async borrarArchivo(fileId: string): Promise<boolean> {
    try {
      await this.storage.remove(fileId);
      return true;
    } catch (e) {
      this.log.warn(`No se pudo borrar una foto de certificado: ${nombreError(e)}`);
      return false;
    }
  }
}
