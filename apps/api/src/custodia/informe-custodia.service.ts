import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { FilaInformeCustodia, ItemChecklist } from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DatosActa, generarActasPdf, Persona } from './acta-custodia.pdf';

export interface FiltrosInforme {
  cantonId?: number;
  recintoId?: string;
}

// Cada acta lleva una foto: en el plan gratuito de Render (512 MB) un PDF
// enorme puede agotar la memoria. Por encima del tope se pide filtrar.
export const MAX_ACTAS_POR_PDF = 100;
const NO_DISPONIBLE: Persona = { nombre: '(usuario no disponible)', cedula: '—' };

type Usuario = { id: string; nombres: string; apellidos: string; cedula: string };

function nombre(p: { nombres: string; apellidos: string }): string {
  return `${p.apellidos} ${p.nombres}`.trim();
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
    return datos.kits.map((k) => {
      const entrega = datos.entregas.get(k.id);
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
    return generarActasPdf(this.armarActas(datos));
  }

  /** Todas las actas de los filtros en un solo PDF (para imprimir). */
  async actas(filtros: FiltrosInforme): Promise<Buffer> {
    const datos = await this.cargar(filtros);
    if (datos.kits.length > MAX_ACTAS_POR_PDF) {
      throw new BadRequestException(
        `Son ${datos.kits.length} actas; el máximo por archivo es ${MAX_ACTAS_POR_PDF}. Filtra por cantón o recinto.`,
      );
    }
    return generarActasPdf(this.armarActas(datos));
  }

  // ─── internos ─────────────────────────────────────────────────────────────

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
    const devoluciones = new Map(devolucionesKit.map((d) => [d.kitId, d]));
    const correcciones = new Map<string, typeof correccionesKit>();
    for (const c of correccionesKit) correcciones.set(c.kitId, [...(correcciones.get(c.kitId) ?? []), c]);
    const entregas = new Map(kits.filter((k) => k.entregaCustodio).map((k) => [k.id, k.entregaCustodio!]));

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
    const [usuarios, militares] = await Promise.all([
      this.prisma.usuario.findMany({
        where: { id: { in: [...idsUsuario] } },
        select: { id: true, nombres: true, apellidos: true, cedula: true },
      }),
      this.prisma.militar.findMany({
        where: { id: { in: [...idsMilitar] } },
        select: { id: true, nombres: true, apellidos: true, cedula: true },
      }),
    ]);
    const usuarioPorId = new Map<string, Usuario>(usuarios.map((u) => [u.id, u]));
    const militarPorId = new Map(militares.map((m) => [m.id, m]));

    return {
      evento,
      kits,
      entregas,
      recepciones,
      devoluciones,
      correcciones,
      usuarioPorId,
      militarPorId,
      nombreUsuario: (id: string) => {
        const u = usuarioPorId.get(id);
        return u ? nombre(u) : '—';
      },
    };
  }

  private armarActas(datos: Awaited<ReturnType<InformeCustodiaService['cargar']>>): DatosActa[] {
    const actas: DatosActa[] = [];
    for (const k of datos.kits) {
      const entrega = datos.entregas.get(k.id);
      const recepcion = datos.recepciones.get(k.id);
      const devolucion = datos.devoluciones.get(k.id);
      const retorno = new Map(
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
        recinto: k.recinto ? `${k.recinto.codigoRecinto} — ${k.recinto.nombre}` : 'Sin recinto',
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
        militar: persona(entrega?.militar),
        // Firma quien recibe al retorno; si aún no hay retorno, quien entregó.
        asistente: persona(asistenteDevolucion ?? asistenteEntrega),
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
