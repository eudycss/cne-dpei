import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
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
import { LectorTransitorio, type LecturaCertificado } from './lector-certificado';
import { LectorCertificadoService } from './lector-certificado.service';
import { nombreCoincide, nombreCorto, nombreCortoDeApellidosNombres } from './nombre-evatics';

/** La página la reduce a ~1600 px (unos 400 KB): 2 MB deja margen sin aceptar fotos crudas. */
export const MAX_CERTIFICADO_BYTES = 2 * 1024 * 1024;
const CATEGORIA = 'certificados-evatics';
export const CEDULA_NO_REGISTRADA = 'Cédula no registrada en el personal CDA, CPE ni Asistentes Transversales';
const YA_APROBADO = 'Su certificado ya fue aprobado: no hace falta subirlo de nuevo';
/** Errores pasajeros (cuota gratuita, red): se reintenta con espera creciente hasta este número. */
export const MAX_INTENTOS_ANALISIS = 5;
/** Por vuelta del cron: la versión gratuita admite pocas peticiones por minuto. */
const ANALISIS_POR_VUELTA = 4;
/** Mientras se analiza al subir, el cron no lo toma. */
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
  fotoKey: string;
  subidoEn: Date;
  estado: string;
  motivoRechazo: string | null;
  revisadoEn: Date | null;
  revisadoPor?: { nombres: string; apellidos: string } | null;
  analisisEstado: string;
  nombreLeido: string | null;
  nombreCoincide: boolean | null;
  esCertificado: boolean | null;
  legible: boolean | null;
  analizadoEn: Date | null;
  analisisProveedor: string | null;
};

/** El técnico supervisor (salvo que también sea admin) no aprueba su propio certificado. */
function aplicaReglaPropia(actor: ActorEvatics): boolean {
  return actor.roles.includes('TECNICO_SUPERVISOR') && !actor.roles.includes('ADMINISTRADOR');
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

const vacio = (): ConteoEvatics => ({
  total: 0,
  sinSubir: 0,
  pendientes: 0,
  aprobados: 0,
  rechazados: 0,
});

function sumar(c: ConteoEvatics, estado: EstadoCertificadoEvatics): void {
  c.total++;
  if (estado === 'SIN_SUBIR') c.sinSubir++;
  else if (estado === 'PENDIENTE') c.pendientes++;
  else if (estado === 'APROBADO') c.aprobados++;
  else c.rechazados++;
}

/** Conteos por grupo, de más a menos personas; "Sin …" al final. */
function agrupar(filas: FilaEvatics[], clave: (f: FilaEvatics) => string, sinGrupo: string): GrupoConteoEvatics[] {
  const grupos = new Map<string, ConteoEvatics>();
  for (const f of filas) {
    const k = clave(f);
    const c = grupos.get(k) ?? vacio();
    sumar(c, f.estado);
    grupos.set(k, c);
  }
  return [...grupos]
    .map(([nombre, c]) => ({ nombre, ...c }))
    .sort(
      (a, b) =>
        Number(a.nombre === sinGrupo) - Number(b.nombre === sinGrupo) ||
        b.total - a.total ||
        a.nombre.localeCompare(b.nombre, 'es'),
    );
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
    return 'La foto no parece un certificado Evatics. Revise que sea el documento correcto y vuelva a subirla.';
  }
  if (!lectura.legible || !lectura.nombreLeido) {
    return 'No se lee bien el certificado. Tome otra foto con buena luz, sin reflejos y con el documento completo.';
  }
  return null;
}

/**
 * Certificados Evatics: la persona sube la foto desde la página pública
 * validando su cédula; un modelo de visión (Gemini o Groq) lee el nombre (solo sugiere) y el técnico
 * supervisor aprueba o rechaza. El listado se agrupa por cantón (del último
 * recinto asignado en Parejas) y por Asistente Transversal (distributivo).
 */
@Injectable()
export class EvaticsService {
  private readonly log = new Logger(EvaticsService.name);
  private analizando = false;

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
      this.prisma.certificadoEvatics.findUnique({
        where: { cedula },
        select: { estado: true, motivoRechazo: true },
      }),
      this.plazo(),
    ]);
    const estado = (certificado?.estado ?? 'SIN_SUBIR') as EstadoCertificadoEvatics;
    return {
      nombreCorto: persona.nombreCorto,
      cargo: persona.cargo,
      estado,
      motivoRechazo: estado === 'RECHAZADO' ? (certificado?.motivoRechazo ?? null) : null,
      fechaLimite: plazo.fechaLimite,
      plazoVencido: plazo.vencido,
      puedeSubir: !plazo.vencido && estado !== 'APROBADO',
    };
  }

  /**
   * Guarda la foto (sin metadatos y cifrada) y la deja PENDIENTE. Reemplaza la
   * anterior mientras no esté aprobada. Con el lector configurado, la analiza en
   * el momento para avisar si no se lee; si falla, queda en cola.
   */
  async subir(
    cedula: string,
    file: Express.Multer.File | undefined,
    version: string,
  ): Promise<{ certificadoId: string; resultado: SubidaEvaticsResult }> {
    const persona = await this.personaPorCedula(cedula);
    if (!persona) throw new NotFoundException(CEDULA_NO_REGISTRADA);
    const plazo = await this.plazo();
    if (plazo.vencido) {
      throw new ForbiddenException(
        `El plazo para subir el certificado terminó el ${plazo.fechaLimite!.split('-').reverse().join('/')}`,
      );
    }
    const previo = await this.prisma.certificadoEvatics.findUnique({
      where: { cedula },
      select: { estado: true },
    });
    if (previo?.estado === 'APROBADO') throw new ConflictException(YA_APROBADO);

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
    let guardado: { id: string; anterior: string | null };
    try {
      guardado = await this.prisma.$transaction(async (tx) => {
        const actual = await tx.certificadoEvatics.findUnique({
          where: { cedula },
          select: { id: true, fotoKey: true },
        });
        if (!actual) {
          const nuevo = await tx.certificadoEvatics.create({
            data: { cedula, ...reinicio },
            select: { id: true },
          });
          return { id: nuevo.id, anterior: null };
        }
        // Condicionado: si un supervisor lo aprobó entretanto, no se reemplaza.
        const r = await tx.certificadoEvatics.updateMany({
          where: { id: actual.id, estado: { not: 'APROBADO' } },
          data: reinicio,
        });
        if (r.count === 0) throw new ConflictException(YA_APROBADO);
        return { id: actual.id, anterior: actual.fotoKey };
      });
    } catch (e) {
      await this.borrarArchivo(fotoKey);
      throw e;
    }
    if (guardado.anterior) await this.borrarArchivo(guardado.anterior);

    const lectura = this.lector.disponible()
      ? await conTope(
          this.analizar(guardado.id, fotoKey, jpeg.limpio, persona.apellidosNombres),
          ESPERA_MAX_ANALISIS_AL_SUBIR_MS,
        )
      : null;
    return {
      certificadoId: guardado.id,
      resultado: {
        ok: true,
        estado: 'PENDIENTE',
        aviso: avisoParaLaPersona(lectura),
      },
    };
  }

  // ---------- Supervisores ----------

  async listado(filtros: FiltrosEvaticsInput, actor: ActorEvatics): Promise<ListadoEvatics> {
    const [personas, certificados, plazo, propia, tecnicos] = await Promise.all([
      this.personas(),
      this.prisma.certificadoEvatics.findMany({
        include: {
          revisadoPor: { select: { nombres: true, apellidos: true } },
        },
      }),
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
      porCanton: agrupar(todas, (f) => f.canton, SIN_CANTON_EVATICS),
      porTecnico: agrupar(todas, (f) => f.tecnico, SIN_TECNICO_EVATICS),
      cargos: [...new Set(todas.map((f) => f.cargo))].sort((a, b) => a.localeCompare(b, 'es')),
      filas,
    };
  }

  /** La foto descifrada (no se guarda en caché). */
  async foto(id: string): Promise<Buffer> {
    const c = await this.prisma.certificadoEvatics.findUnique({
      where: { id },
      select: { fotoKey: true },
    });
    if (!c) throw new NotFoundException('Certificado no encontrado');
    return this.storage.readDecrypted(c.fotoKey);
  }

  /** Aprueba o rechaza (con motivo). Se puede cambiar la decisión; nunca sobre el propio certificado. */
  async revisar(
    id: string,
    decision: DecisionEvatics,
    motivo: string | undefined,
    actor: ActorEvatics,
  ): Promise<{ id: string; estado: DecisionEvatics; revisadoEn: string }> {
    const c = await this.prisma.certificadoEvatics.findUnique({
      where: { id },
      select: { cedula: true },
    });
    if (!c) throw new NotFoundException('Certificado no encontrado');
    if ((await this.cedulasPropias(actor)).has(c.cedula)) {
      throw new ForbiddenException('No puede revisar su propio certificado: lo revisa otro supervisor');
    }
    const revisadoEn = new Date();
    await this.prisma.certificadoEvatics.update({
      where: { id },
      data: {
        estado: decision,
        motivoRechazo: decision === 'RECHAZADO' ? (motivo?.trim() ?? null) : null,
        revisadoPorId: actor.sub,
        revisadoEn,
      },
    });
    return { id, estado: decision, revisadoEn: revisadoEn.toISOString() };
  }

  async config(): Promise<ConfigEvatics> {
    return { fechaLimite: (await this.plazo()).fechaLimite };
  }

  async guardarConfig(fechaLimite: string | null): Promise<ConfigEvatics> {
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
   * cuota gratuita o la red). Pocos por vuelta; ante un error pasajero se
   * detiene para no gastar la cuota.
   */
  @Cron('*/2 * * * *', {
    name: 'analizar-certificados-evatics',
    timeZone: 'America/Guayaquil',
  })
  async analizarPendientes(ahora = new Date()): Promise<number> {
    if (!this.lector.disponible() || this.analizando) return 0;
    this.analizando = true;
    let analizados = 0;
    try {
      const pendientes = await this.prisma.certificadoEvatics.findMany({
        where: {
          analisisEstado: 'EN_COLA',
          OR: [{ analisisSiguiente: null }, { analisisSiguiente: { lte: ahora } }],
        },
        orderBy: { subidoEn: 'asc' },
        take: ANALISIS_POR_VUELTA,
        select: { id: true, cedula: true, fotoKey: true },
      });
      for (const p of pendientes) {
        const persona = await this.personaPorCedula(p.cedula);
        if (!persona) {
          await this.prisma.certificadoEvatics.updateMany({
            where: { id: p.id, fotoKey: p.fotoKey },
            data: { analisisEstado: 'NO_DISPONIBLE', analisisSiguiente: null },
          });
          continue;
        }
        const jpeg = await this.storage.readDecrypted(p.fotoKey);
        const lectura = await this.analizar(p.id, p.fotoKey, jpeg, persona.apellidosNombres);
        if (!lectura) break; // cuota o red: la próxima vuelta
        analizados++;
      }
    } catch (e) {
      this.log.error(`No se pudieron analizar los certificados Evatics: ${(e as Error).message}`);
    } finally {
      this.analizando = false;
    }
    return analizados;
  }

  /**
   * Analiza una foto y guarda lo leído (solo si sigue siendo la misma foto).
   * Devuelve la lectura, o null si quedó en cola o sin análisis.
   */
  private async analizar(
    id: string,
    fotoKey: string,
    jpeg: Buffer,
    esperado: string,
  ): Promise<LecturaCertificado | null> {
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
      const actual = await this.prisma.certificadoEvatics.findUnique({
        where: { id },
        select: { analisisIntentos: true },
      });
      const intentos = (actual?.analisisIntentos ?? 0) + 1;
      const reintentar = e instanceof LectorTransitorio && intentos < MAX_INTENTOS_ANALISIS;
      this.log.warn(`Análisis Evatics ${reintentar ? 'en cola' : 'no disponible'}: ${(e as Error).message}`);
      await this.prisma.certificadoEvatics.updateMany({
        where: { id, fotoKey },
        data: reintentar
          ? {
              analisisEstado: 'EN_COLA',
              analisisIntentos: intentos,
              analisisSiguiente: new Date(Date.now() + esperaReintento(intentos)),
            }
          : {
              analisisEstado: 'NO_DISPONIBLE',
              analisisIntentos: intentos,
              analisisSiguiente: null,
            },
      });
      return null;
    }
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
      where: {
        cedula,
        activo: true,
        roles: { some: { rol: { nombre: ROL_AT } } },
      },
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
   * Cédulas que el supervisor no puede revisar: la de su cuenta y la de la
   * fila del personal vinculada a su cuenta. Vacío si la regla no le aplica.
   */
  private async cedulasPropias(actor: ActorEvatics): Promise<Set<string>> {
    if (!aplicaReglaPropia(actor)) return new Set();
    const [usuario, vinculada] = await Promise.all([
      this.prisma.usuario.findUnique({
        where: { id: actor.sub },
        select: { cedula: true },
      }),
      this.prisma.operadorCda.findFirst({
        where: { usuarioId: actor.sub },
        select: { cedula: true },
      }),
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
        recinto: {
          select: { codigoRecinto: true, canton: { select: { nombre: true } } },
        },
      },
    });
    for (const p of parejas) {
      if (!p.recinto) continue;
      const lugar = {
        canton: p.recinto.canton.nombre,
        codigoRecinto: p.recinto.codigoRecinto,
      };
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
      this.log.warn(`Evatics sin distributivo de técnicos: ${(e as Error).message}`);
      return null;
    }
  }

  private async plazo(): Promise<{
    fechaLimite: string | null;
    vencido: boolean;
  }> {
    const config = await this.prisma.configEvatics.findUnique({
      where: { id: 1 },
      select: { fechaLimite: true },
    });
    const fechaLimite = config?.fechaLimite ? diaDeFechaDb(config.fechaLimite) : null;
    return {
      fechaLimite,
      vencido: !!fechaLimite && diaEcuador() > fechaLimite,
    };
  }

  /** Un archivo huérfano no debe tumbar la respuesta: se registra y se sigue. */
  private async borrarArchivo(fileId: string): Promise<void> {
    try {
      await this.storage.remove(fileId);
    } catch (e) {
      this.log.warn(`No se pudo borrar ${fileId}: ${(e as Error).message}`);
    }
  }
}
