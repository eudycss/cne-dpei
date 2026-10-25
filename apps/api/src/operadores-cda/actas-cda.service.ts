import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ActaCdaFila,
  ActaEntregaCda,
  GenerarActasCdaRequest,
  EstadoActaCda,
  EstadoPrenda,
  GenerarActasCdaResult,
  GrupoCda,
  PersonaEntregaCda,
} from '@cne/shared-types';
import { TEXTOS_GRUPO } from './grupo-cda';

import { PrismaService } from '../db/prisma.service';
import { toOperadorCdaDto } from './operadores-cda.service';
import { diaDeFechaDb, fechaDb } from './dia-ecuador';
import {
  type DatosActaCda,
  generarPdfActasCda,
  generarWordActaCda,
  nombreArchivoActa,
  nombresUnicos,
  zipArchivos,
} from './acta-cda.documento';

/** Quienes pueden entregar (además de "otra persona" escrita a mano). */
const ROLES_ENTREGA = ['ADMINISTRADOR', 'ASISTENTE_TRANSVERSAL'];
const CARGO_ANALISTA = 'Analista Provincial de Seguridad Informática y Proyectos Tecnológicos Electorales 1';
const CARGO_TRANSVERSAL = 'Asistente Electoral Transversal';

export interface ArchivoActa {
  nombre: string;
  contenido: Buffer;
}

type OperadorBasico = { id: string; apellidosNombres: string; cedula: string; grupo: GrupoCda };

// Fila de actas_entrega_cda. Se declara aquí (no se importa de @prisma/client)
// porque el CI no genera el cliente de Prisma, como en el resto de la API.
interface ActaDb {
  id: string;
  operadorId: string;
  entregaPorId: string | null;
  entregaNombre: string;
  entregaCedula: string;
  entregaCargo: string;
  lugar: string;
  fecha: Date;
  estadoPeto: EstadoPrenda;
  estadoCredencial: EstadoPrenda;
  estadoCordon: EstadoPrenda;
  /** Cargo con el que se generó. */
  grupo: GrupoCda;
  estado: EstadoActaCda;
  firmadaEn: Date | null;
  actualizadoEn: Date;
}

/**
 * Actas de entrega de indumentaria y credencial: una vigente por operador (la
 * más reciente). Mientras está GENERADA se corrige generándola otra vez;
 * FIRMADA queda bloqueada hasta que un administrador la reabra.
 */
@Injectable()
export class ActasCdaService {
  /** Un ZIP a la vez: con 0.1 vCPU, dos en paralelo frenarían el GPS y las alertas. */
  private zipEnCurso = false;

  constructor(private readonly prisma: PrismaService) {}

  async lista(grupo: GrupoCda = 'OPERADOR'): Promise<ActaCdaFila[]> {
    const operadores = await this.prisma.operadorCda.findMany({
      where: { activo: true, grupo },
      orderBy: { apellidosNombres: 'asc' },
      include: { actas: { orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }], take: 1 } },
    });
    return operadores.map((o) => {
      const ultima = o.actas[0];
      // Si cambió de cargo, su acta dice el cargo anterior: aquí queda pendiente de una nueva.
      const delCargo = ultima && ultima.grupo === o.grupo;
      return {
        operador: toOperadorCdaDto(o),
        acta: delCargo ? toActaDto(ultima) : null,
        actaOtroCargo: ultima && !delCargo ? TEXTOS_GRUPO[ultima.grupo].cargo : null,
      };
    });
  }

  async personasEntrega(): Promise<PersonaEntregaCda[]> {
    const usuarios = await this.prisma.usuario.findMany({
      where: { activo: true, roles: { some: { rol: { nombre: { in: ROLES_ENTREGA } } } } },
      select: {
        id: true,
        nombres: true,
        apellidos: true,
        cedula: true,
        roles: { select: { rol: { select: { nombre: true } } } },
      },
      orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }],
    });
    return usuarios.map((u) => ({
      usuarioId: u.id,
      nombre: `${u.nombres.trim()} ${u.apellidos.trim()}`,
      cedula: u.cedula,
      // Edison Mafla y William Paspuel (administradores) son analistas; los técnicos de enlaces, transversales.
      cargoSugerido: u.roles.some((r) => r.rol.nombre === 'ADMINISTRADOR') ? CARGO_ANALISTA : CARGO_TRANSVERSAL,
    }));
  }

  async generar(body: GenerarActasCdaRequest, usuarioId: string): Promise<GenerarActasCdaResult> {
    if (body.entregaUsuarioId) await this.verificarQuienEntrega(body.entregaUsuarioId, body.entregaCedula);

    const ids = [...new Set<string>(body.operadorIds)];
    const datos = {
      entregaPorId: body.entregaUsuarioId ?? null,
      entregaNombre: body.entregaNombre,
      entregaCedula: body.entregaCedula,
      entregaCargo: body.entregaCargo,
      lugar: body.lugar,
      fecha: fechaDb(body.fecha),
      estadoPeto: body.estadoPeto,
      estadoCredencial: body.estadoCredencial,
      estadoCordon: body.estadoCordon,
    };

    const resultado: GenerarActasCdaResult = { generadas: 0, actualizadas: 0, omitidasFirmadas: 0, ignorados: 0 };
    await this.prisma.$transaction(async (tx) => {
      // Bloquea a estas personas hasta terminar: un cambio de cargo simultáneo espera, y el cargo
      // que se lee aquí abajo es el vigente (sin esto, el acta podía salir con el cargo anterior).
      // ORDER BY id: dos generaciones simultáneas bloquean en el mismo orden y no se traban.
      // NO KEY UPDATE choca con el UPDATE de grupo, pero no con las inserciones de asistencias o carnets.
      await tx.$queryRaw`SELECT id FROM operadores_cda WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR NO KEY UPDATE`;
      const operadores = await tx.operadorCda.findMany({
        where: { id: { in: ids }, activo: true },
        select: {
          id: true,
          grupo: true,
          actas: { orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, estado: true, grupo: true } },
        },
      });
      resultado.ignorados = ids.length - operadores.length;
      for (const o of operadores) {
        const vigente = o.actas[0];
        // Sin acta, o con la de un cargo anterior (que se conserva como documento): una nueva.
        if (!vigente || vigente.grupo !== o.grupo) {
          await tx.actaEntregaCda.create({ data: { ...datos, grupo: o.grupo, operadorId: o.id, creadoPorId: usuarioId } });
          resultado.generadas++;
          continue;
        }
        // Condicionado al estado: si otro técnico la firmó entretanto, no se pisa.
        const { count } = await tx.actaEntregaCda.updateMany({
          where: { id: vigente.id, estado: 'GENERADA' },
          data: datos,
        });
        if (count) resultado.actualizadas++;
        else resultado.omitidasFirmadas++;
      }
    }, { timeout: 20_000, maxWait: 5_000 }); // hasta 100 actas en un lote, más la espera del bloqueo
    return resultado;
  }

  async firmar(operadorId: string): Promise<ActaEntregaCda> {
    return this.cambiarEstado(operadorId, 'GENERADA', 'FIRMADA');
  }

  async reabrir(operadorId: string): Promise<ActaEntregaCda> {
    return this.cambiarEstado(operadorId, 'FIRMADA', 'GENERADA');
  }

  async word(operadorId: string): Promise<ArchivoActa> {
    const [d] = await this.datos([operadorId]);
    if (!d) throw new NotFoundException('El operador aún no tiene acta generada');
    return { nombre: `${d.archivo}.docx`, contenido: generarWordActaCda(d.datos) };
  }

  async pdf(operadorId: string): Promise<ArchivoActa> {
    const [d] = await this.datos([operadorId]);
    if (!d) throw new NotFoundException('El operador aún no tiene acta generada');
    return { nombre: `${d.archivo}.pdf`, contenido: await generarPdfActasCda([d.datos]) };
  }

  /** ZIP con el Word y el PDF de cada operador elegido que ya tiene acta. */
  async zip(operadorIds: string[]): Promise<ArchivoActa & { operadorIds: string[] }> {
    if (this.zipEnCurso) {
      throw new HttpException(
        'Se está preparando otro ZIP de actas: intente en unos segundos',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.zipEnCurso = true;
    try {
      const actas = await this.datos([...new Set<string>(operadorIds)]);
      if (actas.length === 0) throw new NotFoundException('Ninguno de los operadores elegidos tiene acta generada');
      const nombres = nombresUnicos(actas.map((a) => a.archivo));
      const archivos: ArchivoActa[] = [];
      for (const [i, a] of actas.entries()) {
        archivos.push({ nombre: `word/${nombres[i]}.docx`, contenido: generarWordActaCda(a.datos) });
        archivos.push({ nombre: `pdf/${nombres[i]}.pdf`, contenido: await generarPdfActasCda([a.datos]) });
        // Cede el turno entre actas: el resto de la API (GPS, alertas, login) sigue atendiendo.
        await new Promise<void>((r) => setImmediate(r));
      }
      return {
        nombre: 'actas-entrega-operadores-cda.zip',
        contenido: zipArchivos(archivos),
        operadorIds: actas.map((a) => a.operadorId),
      };
    } finally {
      this.zipEnCurso = false;
    }
  }

  private async verificarQuienEntrega(usuarioId: string, cedula: string): Promise<void> {
    const u = await this.prisma.usuario.findFirst({
      where: { id: usuarioId, activo: true, roles: { some: { rol: { nombre: { in: ROLES_ENTREGA } } } } },
      select: { cedula: true },
    });
    if (!u) throw new BadRequestException('Quien entrega no es un usuario activo habilitado');
    if (u.cedula !== cedula) throw new BadRequestException('La cédula no corresponde al usuario elegido');
  }

  private async cambiarEstado(
    operadorId: string,
    desde: 'GENERADA' | 'FIRMADA',
    hacia: 'GENERADA' | 'FIRMADA',
  ): Promise<ActaEntregaCda> {
    const vigente = await this.prisma.actaEntregaCda.findFirst({
      where: { operadorId, operador: { activo: true } },
      orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }],
      select: { id: true, grupo: true, operador: { select: { grupo: true } } },
    });
    if (!vigente) throw new NotFoundException('El operador aún no tiene acta generada');
    // Cambió de cargo: su acta anterior queda como documento; primero se genera la del cargo actual.
    if (vigente.grupo !== vigente.operador.grupo) {
      throw new NotFoundException('Aún no tiene acta en su cargo actual: genérela primero');
    }
    const { count } = await this.prisma.actaEntregaCda.updateMany({
      where: { id: vigente.id, estado: desde },
      data: { estado: hacia, firmadaEn: hacia === 'FIRMADA' ? new Date() : null },
    });
    if (!count) {
      throw new ConflictException(hacia === 'FIRMADA' ? 'El acta ya está firmada' : 'El acta no está firmada');
    }
    return toActaDto(await this.prisma.actaEntregaCda.findUniqueOrThrow({ where: { id: vigente.id } }));
  }

  /** Acta vigente de cada operador activo que la tenga, con lo que necesita el documento. */
  private async datos(
    operadorIds: string[],
  ): Promise<{ operadorId: string; archivo: string; datos: DatosActaCda }[]> {
    const operadores = await this.prisma.operadorCda.findMany({
      where: { id: { in: operadorIds }, activo: true },
      orderBy: { apellidosNombres: 'asc' },
      include: { actas: { orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }], take: 1 } },
    });
    return operadores
      .filter((o) => o.actas[0])
      .map((o) => ({ operadorId: o.id, archivo: nombreArchivoActa(o.apellidosNombres, o.cedula), datos: aDatos(o, o.actas[0]) }));
  }
}

export function aDatos(o: OperadorBasico, a: ActaDb): DatosActaCda {
  return {
    lugar: a.lugar,
    fecha: diaDeFechaDb(a.fecha),
    entregaNombre: a.entregaNombre,
    entregaCedula: a.entregaCedula,
    entregaCargo: a.entregaCargo,
    operadorNombre: o.apellidosNombres,
    operadorCedula: o.cedula,
    // El cargo con que se generó: un acta firmada no cambia si la persona cambia de cargo.
    operadorCargo: TEXTOS_GRUPO[a.grupo].cargo,
    estadoPeto: a.estadoPeto,
    estadoCredencial: a.estadoCredencial,
    estadoCordon: a.estadoCordon,
  };
}

export function toActaDto(a: ActaDb): ActaEntregaCda {
  return {
    id: a.id,
    operadorId: a.operadorId,
    entregaUsuarioId: a.entregaPorId,
    entregaNombre: a.entregaNombre,
    entregaCedula: a.entregaCedula,
    entregaCargo: a.entregaCargo,
    lugar: a.lugar,
    fecha: diaDeFechaDb(a.fecha),
    estadoPeto: a.estadoPeto,
    estadoCredencial: a.estadoCredencial,
    estadoCordon: a.estadoCordon,
    estado: a.estado,
    firmadaEn: a.firmadaEn?.toISOString() ?? null,
    actualizadoEn: a.actualizadoEn.toISOString(),
  };
}
