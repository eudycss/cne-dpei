import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { FilaInformeCustodia, ItemChecklist } from '@cne/shared-types';
import { MAX_ACTAS_MILITARES, type OpcionesActaMilitar } from '@cne/shared-validation';
import { PrismaService } from '../db/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DatosActa, generarActasPdf, Persona } from './acta-custodia.pdf';
import {
  DatosActaMilitar,
  generarWordActaMilitar,
  nombreArchivoActaMilitar,
  zipActasMilitares,
} from './acta-militar.documento';
import { generarPdfActasMilitares } from './acta-militar.pdf';
import { cargoDeQuienEntrega } from '../operadores-cda/actas-cda.service';

export interface FiltrosInforme {
  cantonId?: number;
  recintoId?: string;
}

// Cada acta lleva una foto: en el plan gratuito de Render (512 MB) un PDF
// enorme puede agotar la memoria. Por encima del tope se pide filtrar.
export const MAX_ACTAS_POR_PDF = 100;

/** Archivo listo para enviar (Word, PDF o .zip de Words). */
export interface ArchivoActa {
  nombre: string;
  tipo: string;
  contenido: Buffer;
}

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const OPCIONES_POR_DEFECTO: OpcionesActaMilitar = { formato: 'docx' };

/** "2026-11-28" → mediodía de ese día en Ecuador (la fecha impresa no se corre de día). */
function fechaDeActa(dia: string): Date {
  return new Date(`${dia}T12:00:00-05:00`);
}
// Las actas militares no llevan foto: caben las 137 de la provincia (+ kits
// extra). El tope (MAX_ACTAS_MILITARES) está en shared-validation: lo usa la web.
const NO_DISPONIBLE: Persona = { nombre: '(usuario no disponible)', cedula: '—' };

type Usuario = { id: string; nombres: string; apellidos: string; cedula: string };

function nombre(p: { nombres: string; apellidos: string }): string {
  return `${p.apellidos} ${p.nombres}`.trim();
}

/** "Jairo Leal": nombres y luego apellidos, como en el acta militar. */
function nombreDirecto(p: { nombres: string; apellidos: string }): string {
  return `${p.nombres.trim()} ${p.apellidos.trim()}`.trim();
}

type MilitarActa = { nombres: string; apellidos: string; cedula: string; grado: string | null };
type MilitarRecinto = MilitarActa & { recintoId: string };

/**
 * El militar del recinto para un acta sin entrega: el único con grado (los
 * del cronograma lo traen) o, si no, el único registrado. Si hay duda, en blanco.
 */
export function militarDelRecinto(militares: MilitarActa[]): MilitarActa | null {
  const conGrado = militares.filter((m) => m.grado);
  if (conGrado.length === 1) return conGrado[0];
  if (conGrado.length === 0 && militares.length === 1) return militares[0];
  return null;
}

function persona(p: { nombres: string; apellidos: string; cedula: string } | null | undefined): Persona | null {
  return p ? { nombre: nombre(p), cedula: p.cedula } : null;
}

/**
 * Informe de cadena de custodia de los kits del evento activo: la tabla
 * consolidada (una fila por kit) y las actas en PDF. Solo lectura.
 */
@Injectable()
export class InformeCustodiaService {
  private readonly logger = new Logger(InformeCustodiaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async informe(filtros: FiltrosInforme): Promise<FilaInformeCustodia[]> {
    const datos = await this.cargar(filtros);
    const militaresPorRecinto = await this.militaresPorRecinto(datos.kits);
    return datos.kits.map((k) => {
      const entrega = datos.entregas.get(k.id);
      const militarActa = entrega?.militar ?? militarDelRecinto(militaresPorRecinto.get(k.recintoId ?? '') ?? []);
      const recepcion = datos.recepciones.get(k.id);
      const devolucion = datos.devoluciones.get(k.id);
      const items = (devolucion?.items as ItemChecklist[] | null) ?? [];
      return {
        kitId: k.id,
        codigoUnico: k.codigoUnico,
        recintoId: k.recintoId ?? null,
        recintoCodigo: k.recinto?.codigoRecinto ?? null,
        recintoNombre: k.recinto?.nombre ?? null,
        cantonId: k.recinto?.cantonId ?? null,
        cantonNombre: k.recinto?.canton?.nombre ?? null,
        operadorNombre: k.operador ? nombre(k.operador) : null,
        operadorCedula: k.operador?.cedula ?? null,
        militarActa: militarActa
          ? { nombre: nombre(militarActa), cedula: militarActa.cedula, grado: militarActa.grado ?? null }
          : null,
        entrega: entrega
          ? {
              militarNombre: nombre(entrega.militar),
              militarCedula: entrega.militar.cedula,
              entregadoEn: entrega.entregadoEn.toISOString(),
              entregadoPorNombre: datos.nombreUsuario(entrega.entregadoPorId),
              militarDeOtroRecinto: entrega.militarDeOtroRecinto,
            }
          : null,
        recepcion: recepcion
          ? { confirmadoEn: recepcion.confirmadoEn.toISOString(), tieneFoto: !!recepcion.fotoMilitarUrl }
          : null,
        devolucion: devolucion
          ? {
              confirmadoEn: devolucion.confirmadoEn.toISOString(),
              verificadoPorNombre: datos.nombreUsuario(devolucion.supervisorId),
              completo: items.length > 0 && items.every((i) => i.marcado),
              observaciones: devolucion.observaciones,
            }
          : null,
        correcciones: datos.correcciones.get(k.id)?.length ?? 0,
      };
    });
  }

  /** Acta de un kit (PDF de una página). */
  async actaKit(kitId: string): Promise<Buffer> {
    const evento = await this.eventoActivo();
    const kit = await this.prisma.kitElectoral.findFirst({
      where: { id: kitId, eventoId: evento.id },
      select: { id: true },
    });
    if (!kit) throw new NotFoundException('Kit no encontrado en el evento activo');
    const datos = await this.cargar({}, [kitId]);
    return generarActasPdf(this.armarActas(datos, await this.militaresPorRecinto(datos.kits)));
  }

  /** Todas las actas de los filtros en un solo PDF (para imprimir). */
  async actas(filtros: FiltrosInforme): Promise<Buffer> {
    const datos = await this.cargar(filtros);
    if (datos.kits.length > MAX_ACTAS_POR_PDF) {
      throw new BadRequestException(
        `Son ${datos.kits.length} actas; el máximo por archivo es ${MAX_ACTAS_POR_PDF}. Filtra por cantón o recinto.`,
      );
    }
    return generarActasPdf(this.armarActas(datos, await this.militaresPorRecinto(datos.kits)));
  }

  /** Acta de Constancia y Custodia (militar) de un kit, en Word. */
  async actaMilitarKit(kitId: string, usuarioId: string, opciones: OpcionesActaMilitar = OPCIONES_POR_DEFECTO): Promise<ArchivoActa> {
    const evento = await this.eventoActivo();
    const kit = await this.prisma.kitElectoral.findFirst({
      where: { id: kitId, eventoId: evento.id },
      select: { id: true },
    });
    if (!kit) throw new NotFoundException('Kit no encontrado en el evento activo');
    const cargados = await this.cargar({}, [kitId]);
    if (cargados.kits.some((k) => k.esPrueba)) throw new NotFoundException('Kit no encontrado en el evento activo');
    const [acta] = await this.armarActasMilitares(cargados, usuarioId, opciones);
    if (opciones.formato === 'pdf') {
      return { nombre: acta.archivo.replace(/\.docx$/, '.pdf'), tipo: 'application/pdf', contenido: await generarPdfActasMilitares([acta.datos]) };
    }
    return { nombre: acta.archivo, tipo: DOCX, contenido: generarWordActaMilitar(acta.datos) };
  }

  /** Actas militares de los filtros: un Word por kit dentro de un .zip. */
  async actasMilitares(filtros: FiltrosInforme, usuarioId: string, opciones: OpcionesActaMilitar = OPCIONES_POR_DEFECTO): Promise<ArchivoActa> {
    // Se cuenta antes de cargar todo: un pedido enorme no llega a la memoria.
    const evento = await this.eventoActivo();
    const total = await this.prisma.kitElectoral.count({
      where: {
        eventoId: evento.id,
        esPrueba: false,
        recintoId: filtros.recintoId,
        recinto: filtros.cantonId ? { cantonId: filtros.cantonId } : undefined,
      },
    });
    if (total === 0) throw new NotFoundException('No hay kits con esos filtros');
    if (total > MAX_ACTAS_MILITARES) {
      throw new BadRequestException(
        `Son ${total} actas; el máximo por archivo es ${MAX_ACTAS_MILITARES}. Filtra por cantón.`,
      );
    }
    const datos = await this.cargar(filtros);
    return this.archivoActasMilitares(await this.armarActasMilitares(datos, usuarioId, opciones), opciones);
  }

  /**
   * Actas militares de los kits que el usuario eligió en la tabla (filtró por
   * recinto, operador, militar…). Solo kits del evento activo; el tope lo
   * valida el esquema (máx. MAX_ACTAS_MILITARES).
   */
  async actasMilitaresSeleccion(
    kitIds: string[],
    usuarioId: string,
    opciones: OpcionesActaMilitar = OPCIONES_POR_DEFECTO,
  ): Promise<ArchivoActa> {
    const cargados = await this.cargar({}, [...new Set(kitIds)]);
    // Como en la tabla: los kits de prueba no tienen acta aunque se pida su id.
    const datos = { ...cargados, kits: cargados.kits.filter((k) => !k.esPrueba) };
    if (!datos.kits.length) throw new NotFoundException('No hay kits del evento activo en la selección');
    return this.archivoActasMilitares(await this.armarActasMilitares(datos, usuarioId, opciones), opciones);
  }

  /** Asistentes Transversales activos: los que pueden firmar como responsable del acta militar. */
  async responsablesActa(): Promise<{ id: string; nombre: string }[]> {
    const usuarios = await this.prisma.usuario.findMany({
      where: { activo: true, roles: { some: { rol: { nombre: 'ASISTENTE_TRANSVERSAL' } } } },
      select: { id: true, nombres: true, apellidos: true },
      orderBy: [{ nombres: 'asc' }, { apellidos: 'asc' }],
    });
    // Sin cédula: la lista solo sirve para elegir (minimización de datos personales).
    return usuarios.map((u) => ({ id: u.id, nombre: nombreDirecto(u) }));
  }

  /** Varias actas: un solo PDF (una página por kit) o un .zip con un Word por kit. */
  private async archivoActasMilitares(
    actas: { archivo: string; datos: DatosActaMilitar }[],
    opciones: OpcionesActaMilitar,
  ): Promise<ArchivoActa> {
    if (opciones.formato === 'pdf') {
      return { nombre: 'actas_militares.pdf', tipo: 'application/pdf', contenido: await generarPdfActasMilitares(actas.map((a) => a.datos)) };
    }
    return { nombre: 'actas_militares.zip', tipo: 'application/zip', contenido: await zipActasMilitares(actas) };
  }

  // ─── internos ─────────────────────────────────────────────────────────────

  /** Militares visibles de los recintos de los kits, agrupados por recinto. */
  private async militaresPorRecinto(kits: { recintoId: string | null }[]): Promise<Map<string, MilitarRecinto[]>> {
    const recintoIds = [...new Set(kits.map((k) => k.recintoId).filter((x): x is string => !!x))];
    const militares = recintoIds.length
      ? await this.prisma.militar.findMany({
          where: { recintoId: { in: recintoIds }, activo: true },
          select: { recintoId: true, nombres: true, apellidos: true, cedula: true, grado: true },
        })
      : [];
    const porRecinto = new Map<string, MilitarRecinto[]>();
    for (const m of militares) porRecinto.set(m.recintoId, [...(porRecinto.get(m.recintoId) ?? []), m]);
    return porRecinto;
  }

  /**
   * Datos del acta militar de cada kit. Con la entrega registrada salen el
   * militar, quien entregó y la fecha reales; si aún no se entrega (acta que
   * se imprime antes), el militar asignado al recinto, quien descarga y hoy.
   */
  private async armarActasMilitares(
    datos: Awaited<ReturnType<InformeCustodiaService['cargar']>>,
    usuarioId: string,
    opciones: OpcionesActaMilitar = OPCIONES_POR_DEFECTO,
  ): Promise<{ archivo: string; datos: DatosActaMilitar }[]> {
    // Responsable elegido: tiene que ser un Asistente Transversal activo y firma todas las actas.
    if (opciones.responsableId) {
      const elegido = await this.prisma.usuario.findFirst({
        where: { id: opciones.responsableId, activo: true, roles: { some: { rol: { nombre: 'ASISTENTE_TRANSVERSAL' } } } },
        select: { id: true },
      });
      if (!elegido) throw new BadRequestException('El responsable debe ser un Asistente Transversal activo');
    }
    const idsResponsable = new Set<string>(
      opciones.responsableId ? [opciones.responsableId] : [usuarioId, ...[...datos.entregas.values()].map((e) => e.entregadoPorId)],
    );
    const [mochilas, militaresPorRecinto, responsables] = await Promise.all([
      this.prisma.mochilaKit.findMany({
        where: { codigoUnico: { in: datos.kits.map((k) => k.codigoUnico) } },
        select: { codigoUnico: true, numero: true },
      }),
      this.militaresPorRecinto(datos.kits),
      this.prisma.usuario.findMany({
        where: { id: { in: [...idsResponsable] } },
        select: { id: true, nombres: true, apellidos: true, cedula: true, roles: { select: { rol: { select: { nombre: true } } } } },
      }),
    ]);
    const numeroPorCodigo = new Map<string, number>(mochilas.map((m) => [m.codigoUnico, m.numero]));
    const responsablePorId = new Map<string, (typeof responsables)[number]>(responsables.map((u) => [u.id, u]));

    const hoy = new Date();
    const fechaElegida = opciones.fecha ? fechaDeActa(opciones.fecha) : null;
    return datos.kits.map((k) => {
      const entrega = datos.entregas.get(k.id);
      const militar = entrega?.militar ?? militarDelRecinto(militaresPorRecinto.get(k.recintoId ?? '') ?? []);
      const resp = responsablePorId.get(opciones.responsableId ?? entrega?.entregadoPorId ?? usuarioId);
      const kitNumero = String(numeroPorCodigo.get(k.codigoUnico) ?? k.codigoUnico);
      return {
        archivo: nombreArchivoActaMilitar(kitNumero, k.recinto?.codigoRecinto ?? null),
        datos: {
          // La fecha elegida vale para todas, aunque el kit ya tenga su entrega registrada.
          fecha: fechaElegida ?? entrega?.entregadoEn ?? hoy,
          responsable: resp
            ? { nombre: nombreDirecto(resp), cedula: resp.cedula, cargo: cargoDeQuienEntrega(resp.roles.map((r) => r.rol.nombre)) }
            : null,
          militar: militar ? { nombre: nombre(militar), cedula: militar.cedula, grado: militar.grado } : null,
          kitNumero,
          // El nombre del kit ya es "1359 — Recinto (kit 2)"; la plantilla usa la raya corta.
          recintoTexto: k.nombre.replace(' — ', ' – '),
          operador: k.operador ? { nombre: nombreDirecto(k.operador), cedula: k.operador.cedula } : null,
        },
      };
    });
  }


  private async eventoActivo() {
    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
      select: { id: true, nombre: true },
    });
    if (!evento) throw new NotFoundException('No hay un evento electoral activo');
    return evento;
  }

  /** Carga en lote todo lo necesario para N kits (sin consultas por kit). */
  private async cargar(filtros: FiltrosInforme, kitIds?: string[]) {
    const evento = await this.eventoActivo();
    const kits = await this.prisma.kitElectoral.findMany({
      where: {
        eventoId: evento.id,
        esPrueba: kitIds ? undefined : false,
        id: kitIds ? { in: kitIds } : undefined,
        recintoId: filtros.recintoId,
        recinto: filtros.cantonId ? { cantonId: filtros.cantonId } : undefined,
      },
      include: {
        recinto: { include: { canton: true } },
        operador: true,
        itemsContenido: { include: { item: true } },
        entregaCustodio: { include: { militar: true } },
      },
      orderBy: [{ recinto: { codigoRecinto: 'asc' } }, { codigoUnico: 'asc' }],
    });
    const ids = kits.map((k) => k.id);

    const [recepcionesKit, devolucionesKit, correccionesKit] = await Promise.all([
      this.prisma.recepcionKit.findMany({ where: { kitId: { in: ids } }, orderBy: { confirmadoEn: 'desc' } }),
      this.prisma.recepcionDpiKit.findMany({ where: { kitId: { in: ids } } }),
      this.prisma.correccionCustodiaKit.findMany({ where: { kitId: { in: ids } }, orderBy: { corregidoEn: 'asc' } }),
    ]);

    // La última recepción de cada kit (por si hubo un reintento).
    const recepciones = new Map<string, (typeof recepcionesKit)[number]>();
    for (const r of recepcionesKit) if (!recepciones.has(r.kitId)) recepciones.set(r.kitId, r);
    // Genéricos explícitos: sin ellos la CI (sin `prisma generate`) infiere Map<unknown, unknown>.
    const devoluciones = new Map<string, (typeof devolucionesKit)[number]>(devolucionesKit.map((d) => [d.kitId, d]));
    const correcciones = new Map<string, typeof correccionesKit>();
    for (const c of correccionesKit) correcciones.set(c.kitId, [...(correcciones.get(c.kitId) ?? []), c]);
    // Una entrega a un militar oculto (de prueba) no cuenta: el kit sale como
    // pendiente y el acta militar lleva al militar del cronograma del recinto.
    const entregas = new Map<string, NonNullable<(typeof kits)[number]['entregaCustodio']>>(
      kits.filter((k) => k.entregaCustodio?.militar.activo).map((k) => [k.id, k.entregaCustodio!]),
    );

    // Usuarios y militares referidos por id (quién registró, quién verificó,
    // valores del historial de correcciones).
    const idsUsuario = new Set<string>();
    const idsMilitar = new Set<string>();
    for (const e of entregas.values()) idsUsuario.add(e.entregadoPorId);
    for (const d of devolucionesKit) idsUsuario.add(d.supervisorId);
    for (const r of recepcionesKit) idsUsuario.add(r.operadorId);
    for (const c of correccionesKit) {
      const ids = [c.valorAnterior, c.valorNuevo].filter((x): x is string => !!x);
      for (const id of ids) (c.campo === 'MILITAR' ? idsMilitar : idsUsuario).add(id);
    }
    const [usuarios, militares, asistentes] = await Promise.all([
      this.prisma.usuario.findMany({
        where: { id: { in: [...idsUsuario] } },
        select: { id: true, nombres: true, apellidos: true, cedula: true },
      }),
      // Los ocultos no salen ni en el historial de correcciones (quedan "—").
      this.prisma.militar.findMany({
        where: { id: { in: [...idsMilitar] }, activo: true },
        select: { id: true, nombres: true, apellidos: true, cedula: true },
      }),
      // Para kits sin entrega ni devolución registradas: si hay un solo
      // asistente transversal activo, es quien firma (como en la plantilla en Word).
      this.prisma.usuario.findMany({
        where: { activo: true, roles: { some: { rol: { nombre: 'ASISTENTE_TRANSVERSAL' } } } },
        select: { id: true, nombres: true, apellidos: true, cedula: true },
        take: 2,
      }),
    ]);
    const usuarioPorId = new Map<string, Usuario>(usuarios.map((u) => [u.id, u]));
    const militarPorId = new Map<string, Usuario>(militares.map((m) => [m.id, m]));

    return {
      evento,
      kits,
      entregas,
      recepciones,
      devoluciones,
      correcciones,
      usuarioPorId,
      militarPorId,
      asistenteUnico: asistentes.length === 1 ? asistentes[0] : null,
      nombreUsuario: (id: string) => {
        const u = usuarioPorId.get(id);
        return u ? nombre(u) : '—';
      },
    };
  }

  private armarActas(
    datos: Awaited<ReturnType<InformeCustodiaService['cargar']>>,
    militaresPorRecinto: Map<string, MilitarRecinto[]>,
  ): DatosActa[] {
    const actas: DatosActa[] = [];
    for (const k of datos.kits) {
      const entrega = datos.entregas.get(k.id);
      const recepcion = datos.recepciones.get(k.id);
      const devolucion = datos.devoluciones.get(k.id);
      const retorno = new Map<string, ItemChecklist>(
        ((devolucion?.items as ItemChecklist[] | null) ?? [])
          .filter((i) => i.itemId)
          .map((i) => [i.itemId as string, i]),
      );
      const operadorRecepcion = recepcion ? datos.usuarioPorId.get(recepcion.operadorId) : null;
      const asistenteDevolucion = devolucion ? datos.usuarioPorId.get(devolucion.supervisorId) : null;
      const asistenteEntrega = entrega ? datos.usuarioPorId.get(entrega.entregadoPorId) : null;

      actas.push({
        eventoNombre: datos.evento.nombre,
        codigoUnico: k.codigoUnico,
        recinto: k.recinto ? `${k.recinto.nombre}, cod: ${k.recinto.codigoRecinto}` : 'Sin recinto',
        canton: k.recinto?.canton?.nombre ?? '—',
        articulos: k.itemsContenido.map((ic) => {
          const r = retorno.get(ic.itemId);
          return {
            articulo: ic.item.etiqueta,
            serie: ic.serie,
            estadoSalida: ic.estado,
            estadoRetorno: r ? (r.marcado ? r.estado ?? ic.estado : 'NO RETORNÓ') : null,
          };
        }),
        // Un paso registrado nunca sale como "No registrada" aunque falte el usuario.
        entrega: entrega
          ? {
              militar: persona(entrega.militar)!,
              fecha: entrega.entregadoEn,
              asistente: persona(asistenteEntrega) ?? NO_DISPONIBLE,
            }
          : null,
        recepcion: recepcion
          ? {
              fecha: recepcion.confirmadoEn,
              operador: persona(operadorRecepcion) ?? NO_DISPONIBLE,
              foto: () => this.foto(recepcion.fotoMilitarUrl),
            }
          : null,
        devolucion: devolucion
          ? {
              fecha: devolucion.confirmadoEn,
              asistente: persona(asistenteDevolucion) ?? NO_DISPONIBLE,
              observaciones: devolucion.observaciones,
            }
          : null,
        correcciones: (datos.correcciones.get(k.id) ?? []).map((c) => {
          const nombrePor = (id: string | null) => {
            if (!id) return '—';
            const p = c.campo === 'MILITAR' ? datos.militarPorId.get(id) : datos.usuarioPorId.get(id);
            return p ? nombre(p) : '—';
          };
          return {
            campo: c.campo === 'MILITAR' ? 'Militar' : 'Operador CDA',
            anterior: nombrePor(c.valorAnterior),
            nuevo: nombrePor(c.valorNuevo),
            motivo: c.motivo,
            fecha: c.corregidoEn,
          };
        }),
        operador: persona(operadorRecepcion ?? k.operador),
        // Sin entrega registrada (o la de prueba, que no cuenta): el militar
        // del cronograma del recinto, como en el acta militar en Word.
        militar: persona(entrega?.militar ?? militarDelRecinto(militaresPorRecinto.get(k.recintoId ?? '') ?? [])),
        // Firma quien recibe al retorno; si aún no hay retorno, quien entregó;
        // si no hay ninguno, el único asistente transversal activo.
        asistente: persona(asistenteDevolucion ?? asistenteEntrega ?? datos.asistenteUnico),
      });
    }
    return actas;
  }

  /** Foto del militar descifrada; si falla, el acta sale sin foto. */
  private async foto(url: string | null): Promise<Buffer | null> {
    if (!url) return null;
    try {
      return await this.storage.readDecrypted(url);
    } catch (e) {
      this.logger.warn(`No se pudo leer la foto del militar para el acta: ${(e as Error).message}`);
      return null;
    }
  }
}
