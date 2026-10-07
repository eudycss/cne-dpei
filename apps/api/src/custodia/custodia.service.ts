import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  cambiarOperadorSchema,
  corregirMilitarSchema,
  registrarEntregaSchema,
} from '@cne/shared-validation';
import type {
  CambiarOperadorRequest,
  CorregirMilitarRequest,
  EntregaCustodio,
  KitCustodiaResponse,
  MilitarResumen,
  OperadorResumen,
  RegistrarEntregaRequest,
  RoleName,
} from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { KitsService } from '../kits/kits.service';

const MILITAR_SELECT = {
  id: true,
  cedula: true,
  nombres: true,
  apellidos: true,
  recintoId: true,
  recinto: { select: { nombre: true } },
} as const;

const MAX_RESULTADOS_BUSQUEDA = 20;

const SOLO_ADMIN_CORRIGE =
  'El operador CDA ya recibió este kit: solo un administrador puede corregir el militar';
const CAMBIO_CONCURRENTE =
  'El kit cambió mientras lo editabas (otra corrección o ya lo recibió el CDA). Vuelve a escanearlo.';

function esViolacionDeUnicidad(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === 'P2002';
}

/**
 * Cadena de custodia del kit en el DPEI (rol ASISTENTE_TRANSVERSAL):
 * entrega del kit a un militar y correcciones de último minuto (militar de la
 * entrega u operador CDA del kit). Todo cambio queda en el historial con
 * motivo, y solo se permite hasta que el CDA recibe el kit (estado ASIGNADO);
 * después, solo el administrador corrige el militar.
 */
@Injectable()
export class CustodiaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kits: KitsService,
  ) {}

  async validarKit(codigo: string): Promise<KitCustodiaResponse> {
    const evento = await this.prisma.eventoElectoral.findFirst({
      where: { estado: 'ACTIVO' },
      select: { id: true },
    });
    if (!evento) throw new NotFoundException('No hay un evento electoral activo');

    const kit = await this.prisma.kitElectoral.findUnique({
      where: { eventoId_codigoUnico: { eventoId: evento.id, codigoUnico: codigo.trim().toUpperCase() } },
      include: { recinto: true, operador: true },
    });
    if (!kit) throw new NotFoundException('Kit no encontrado en el evento activo');

    const [militaresRecinto, entrega] = await Promise.all([
      kit.recintoId
        ? this.prisma.militar.findMany({
            where: { recintoId: kit.recintoId },
            select: MILITAR_SELECT,
            orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
          })
        : Promise.resolve([]),
      this.entregaDto(kit.id),
    ]);

    return {
      kitId: kit.id,
      codigoUnico: kit.codigoUnico,
      nombre: kit.nombre,
      estado: kit.estado,
      recinto: kit.recinto
        ? { id: kit.recinto.id, codigo: kit.recinto.codigoRecinto, nombre: kit.recinto.nombre }
        : null,
      operador: kit.operador ? toOperador(kit.operador) : null,
      militaresRecinto: militaresRecinto.map(toMilitar),
      entrega,
      editable: kit.estado === 'ASIGNADO',
    };
  }

  async registrarEntrega(usuarioId: string, input: RegistrarEntregaRequest): Promise<EntregaCustodio> {
    const parsed = registrarEntregaSchema.parse(input);
    const kit = await this.kitDelEventoActivo(parsed.kitId);
    if (kit.estado !== 'ASIGNADO') {
      throw new BadRequestException(
        kit.estado === 'EN_BODEGA'
          ? 'El kit no tiene un operador CDA asignado'
          : 'El operador CDA ya recibió este kit: la entrega al militar ya no se puede registrar',
      );
    }
    const militar = await this.militarOrThrow(parsed.militarId);

    const existente = await this.prisma.entregaCustodioKit.findUnique({ where: { kitId: kit.id } });
    if (existente) return this.entregaExistente(kit.id, existente.militarId, militar.id);

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.entregaCustodioKit.create({
          data: {
            kitId: kit.id,
            eventoId: kit.eventoId,
            militarId: militar.id,
            entregadoPorId: usuarioId,
            militarDeOtroRecinto: militar.recintoId !== kit.recintoId,
          },
        });
        // El CDA pudo recibir el kit mientras tanto: entonces no se registra.
        const sigueAsignado = await tx.kitElectoral.count({ where: { id: kit.id, estado: 'ASIGNADO' } });
        if (!sigueAsignado) {
          throw new ConflictException('El operador CDA acaba de recibir este kit: vuelve a escanearlo');
        }
      });
    } catch (e) {
      // Dos registros a la vez (doble toque, dos asistentes): el índice único
      // por kit deja pasar solo uno; el otro se resuelve como si ya existiera.
      if (!esViolacionDeUnicidad(e)) throw e;
      const ganadora = await this.prisma.entregaCustodioKit.findUnique({ where: { kitId: kit.id } });
      if (!ganadora) throw e;
      return this.entregaExistente(kit.id, ganadora.militarId, militar.id);
    }
    return this.entregaDtoOrThrow(kit.id);
  }

  /** Reintento del mismo registro: idempotente; con otro militar, 409. */
  private async entregaExistente(kitId: string, militarRegistrado: string, militarPedido: string) {
    if (militarRegistrado === militarPedido) return this.entregaDtoOrThrow(kitId);
    throw new ConflictException('Este kit ya fue entregado a otro militar. Usa "Cambiar militar".');
  }

  async corregirMilitar(
    usuarioId: string,
    roles: RoleName[],
    kitId: string,
    input: CorregirMilitarRequest,
  ): Promise<EntregaCustodio> {
    const parsed = corregirMilitarSchema.parse(input);
    const kit = await this.kitDelEventoActivo(kitId);
    const esAdmin = roles.includes('ADMINISTRADOR');
    if (kit.estado !== 'ASIGNADO' && !esAdmin) {
      throw new BadRequestException(SOLO_ADMIN_CORRIGE);
    }
    const entrega = await this.prisma.entregaCustodioKit.findUnique({ where: { kitId: kit.id } });
    if (!entrega) throw new BadRequestException('Este kit aún no tiene una entrega registrada');
    const militar = await this.militarOrThrow(parsed.militarId);
    if (militar.id === entrega.militarId) {
      throw new BadRequestException('Ese militar ya es el registrado en la entrega');
    }

    await this.prisma.$transaction(async (tx) => {
      // Se vuelve a comprobar dentro de la transacción: el CDA pudo recibir el
      // kit, u otra corrección cambiar el militar, después de leerlos.
      if (!esAdmin) {
        const sigueAsignado = await tx.kitElectoral.count({ where: { id: kit.id, estado: 'ASIGNADO' } });
        if (!sigueAsignado) throw new BadRequestException(SOLO_ADMIN_CORRIGE);
      }
      const { count } = await tx.entregaCustodioKit.updateMany({
        where: { kitId: kit.id, militarId: entrega.militarId },
        data: { militarId: militar.id, militarDeOtroRecinto: militar.recintoId !== kit.recintoId },
      });
      if (count === 0) throw new ConflictException(CAMBIO_CONCURRENTE);
      await tx.correccionCustodiaKit.create({
        data: {
          kitId: kit.id,
          campo: 'MILITAR',
          valorAnterior: entrega.militarId,
          valorNuevo: militar.id,
          motivo: parsed.motivo,
          corregidoPorId: usuarioId,
        },
      });
    });
    return this.entregaDtoOrThrow(kit.id);
  }

  async cambiarOperador(
    usuarioId: string,
    kitId: string,
    input: CambiarOperadorRequest,
  ): Promise<OperadorResumen> {
    const parsed = cambiarOperadorSchema.parse(input);
    const kit = await this.kitDelEventoActivo(kitId);
    if (kit.estado !== 'ASIGNADO') {
      throw new BadRequestException(
        'El operador CDA ya recibió este kit: el operador ya no se puede cambiar',
      );
    }
    if (kit.operadorId === parsed.operadorId) {
      throw new BadRequestException('Ese operador ya es el asignado a este kit');
    }

    // Mismas reglas que la asignación desde la web: OPERADOR_CDA activo, un
    // recinto por operador y, con la jornada iniciada, el motivo sirve de
    // justificación (queda en el historial).
    await this.kits.validarAsignacion(kit.id, parsed.operadorId, parsed.motivo);

    await this.prisma.$transaction(async (tx) => {
      // Solo si nadie lo cambió y el CDA no lo recibió desde que se leyó.
      const { count } = await tx.kitElectoral.updateMany({
        where: { id: kit.id, estado: 'ASIGNADO', operadorId: kit.operadorId },
        data: { operadorId: parsed.operadorId },
      });
      if (count === 0) throw new ConflictException(CAMBIO_CONCURRENTE);
      await tx.correccionCustodiaKit.create({
        data: {
          kitId: kit.id,
          campo: 'OPERADOR',
          valorAnterior: kit.operadorId,
          valorNuevo: parsed.operadorId,
          motivo: parsed.motivo,
          corregidoPorId: usuarioId,
        },
      });
    });
    const operador = await this.prisma.usuario.findUniqueOrThrow({ where: { id: parsed.operadorId } });
    return toOperador(operador);
  }

  async buscarMilitares(texto: string): Promise<MilitarResumen[]> {
    const q = texto.trim();
    if (q.length < 2) return [];
    const militares = await this.prisma.militar.findMany({
      where: {
        OR: [
          { cedula: { startsWith: q } },
          { nombres: { contains: q, mode: 'insensitive' } },
          { apellidos: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: MILITAR_SELECT,
      orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
      take: MAX_RESULTADOS_BUSQUEDA,
    });
    return militares.map(toMilitar);
  }

  async buscarOperadores(texto: string): Promise<OperadorResumen[]> {
    const q = texto.trim();
    if (q.length < 2) return [];
    const usuarios = await this.prisma.usuario.findMany({
      where: {
        activo: true,
        roles: { some: { rol: { nombre: 'OPERADOR_CDA' } } },
        OR: [
          { cedula: { startsWith: q } },
          { nombres: { contains: q, mode: 'insensitive' } },
          { apellidos: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
      take: MAX_RESULTADOS_BUSQUEDA,
    });
    return usuarios.map(toOperador);
  }

  // ─── internos ─────────────────────────────────────────────────────────────

  private async kitDelEventoActivo(kitId: string) {
    const kit = await this.prisma.kitElectoral.findUnique({ where: { id: kitId } });
    if (!kit) throw new NotFoundException('Kit no encontrado');
    const evento = await this.prisma.eventoElectoral.findUnique({
      where: { id: kit.eventoId },
      select: { estado: true },
    });
    if (evento?.estado !== 'ACTIVO') {
      throw new BadRequestException('El kit no pertenece al evento electoral activo');
    }
    return kit;
  }

  private async militarOrThrow(id: string) {
    const militar = await this.prisma.militar.findUnique({ where: { id } });
    if (!militar) throw new NotFoundException('Militar no encontrado');
    return militar;
  }

  private async entregaDtoOrThrow(kitId: string): Promise<EntregaCustodio> {
    const dto = await this.entregaDto(kitId);
    if (!dto) throw new NotFoundException('Entrega no encontrada');
    return dto;
  }

  private async entregaDto(kitId: string): Promise<EntregaCustodio | null> {
    const entrega = await this.prisma.entregaCustodioKit.findUnique({
      where: { kitId },
      include: { militar: { select: MILITAR_SELECT } },
    });
    if (!entrega) return null;
    const por = await this.prisma.usuario.findUnique({
      where: { id: entrega.entregadoPorId },
      select: { nombres: true, apellidos: true },
    });
    return {
      militar: toMilitar(entrega.militar),
      entregadoEn: entrega.entregadoEn.toISOString(),
      entregadoPorNombre: por ? `${por.nombres} ${por.apellidos}`.trim() : '—',
      militarDeOtroRecinto: entrega.militarDeOtroRecinto,
    };
  }
}

function toMilitar(m: {
  id: string;
  cedula: string;
  nombres: string;
  apellidos: string;
  recintoId: string;
  recinto: { nombre: string } | null;
}): MilitarResumen {
  return {
    id: m.id,
    cedula: m.cedula,
    nombres: m.nombres,
    apellidos: m.apellidos,
    recintoId: m.recintoId,
    recintoNombre: m.recinto?.nombre ?? '',
  };
}

function toOperador(u: { id: string; cedula: string; nombres: string; apellidos: string }): OperadorResumen {
  return { id: u.id, cedula: u.cedula, nombres: u.nombres, apellidos: u.apellidos };
}
