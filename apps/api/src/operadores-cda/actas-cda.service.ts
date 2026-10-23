import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ActaEntregaCda as ActaDb } from '@prisma/client';
import type {
  ActaCdaFila,
  ActaEntregaCda,
  GenerarActasCdaRequest,
  GenerarActasCdaResult,
  PersonaEntregaCda,
} from '@cne/shared-types';

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

type OperadorBasico = { id: string; apellidosNombres: string; cedula: string };

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

  async lista(): Promise<ActaCdaFila[]> {
    const operadores = await this.prisma.operadorCda.findMany({
      where: { activo: true },
      orderBy: { apellidosNombres: 'asc' },
      include: { actas: { orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }], take: 1 } },
    });
    return operadores.map(({ actas, ...o }) => ({
      operador: toOperadorCdaDto(o),
      acta: actas[0] ? toActaDto(actas[0]) : null,
    }));
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
    const operadores = await this.prisma.operadorCda.findMany({
      where: { id: { in: ids }, activo: true },
      select: { id: true, actas: { orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, estado: true } } },
    });
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

    const resultado: GenerarActasCdaResult = {
      generadas: 0,
      actualizadas: 0,
      omitidasFirmadas: 0,
      ignorados: ids.length - operadores.length,
    };
    await this.prisma.$transaction(async (tx) => {
      for (const o of operadores) {
        const vigente = o.actas[0];
        if (!vigente) {
          await tx.actaEntregaCda.create({ data: { ...datos, operadorId: o.id, creadoPorId: usuarioId } });
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
    });
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
      select: { id: true },
    });
    if (!vigente) throw new NotFoundException('El operador aún no tiene acta generada');
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

function aDatos(o: OperadorBasico, a: ActaDb): DatosActaCda {
  return {
    lugar: a.lugar,
    fecha: diaDeFechaDb(a.fecha),
    entregaNombre: a.entregaNombre,
    entregaCedula: a.entregaCedula,
    entregaCargo: a.entregaCargo,
    operadorNombre: o.apellidosNombres,
    operadorCedula: o.cedula,
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
