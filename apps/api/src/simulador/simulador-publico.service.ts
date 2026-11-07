import { BadRequestException, ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as crypto from 'node:crypto';
import type {
  ActaSimulador,
  EstadoIntentoSimulador,
  GuardarActaSimuladorResponse,
  IngresoSimuladorResponse,
  IniciarSimuladorResponse,
  NuevaActaSimuladorResponse,
  PracticaDisponibleSimulador,
} from '@cne/shared-types';
import { AVISO_CADA_ACTAS, MARGEN_BORRADOR_MS } from '@cne/shared-validation';

import { PrismaService } from '../db/prisma.service';
import { azarSeguro, comoGuardado, conteoFilas, filasIncorrectas, generarActa, type Azar } from './acta-digitacion';
import { enCasilleros, numeroEnLetras } from './numero-en-letras';
import { aplicaA, enmascararNombre, estadoIntento, motivoCierre, type Parcial } from './reglas-simulador';
import { LimitePorClave } from './limite-por-clave';

export const hashTokenSimulador = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const nuevoToken = () => crypto.randomBytes(32).toString('base64url');

/** Mismo mensaje exista o no la cédula: la página no sirve para averiguar quién es personal. */
const SIN_PRACTICAS = 'No hay prácticas disponibles para esta cédula';

/**
 * Mientras la sesión se use (o haya pasado menos que esto desde su último uso),
 * nadie puede retomar el intento desde otro equipo con solo la cédula.
 */
export const RETOME_BLOQUEADO_MS = 2 * 60_000;
export const ABIERTA_EN_OTRO_EQUIPO =
  'Su práctica está abierta en otro equipo. Siga allí, o espere 2 minutos sin usarla para continuar en este.';

const DEMASIADOS = 'Demasiados intentos con esta cédula; espere un minuto';

export const INTENTO_ANULADO =
  'El monitor anuló este intento. Vuelva a entrar con su cédula para empezar uno nuevo (no se le descuenta).';

const PERSONA = { select: { id: true, grupo: true, activo: true, apellidosNombres: true, cargoCda: { select: { nombre: true } } } };

const INTENTO = {
  include: {
    practica: true,
    operador: { select: { apellidosNombres: true } },
  },
};
type IntentoConPractica = Prisma.IntentoDigitacionGetPayload<typeof INTENTO>;

function esUnico(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

function aActa(a: { id: string; numero: number; valores: number[]; digitos: number[] }): ActaSimulador {
  return {
    id: a.id,
    numero: a.numero,
    filas: a.valores.map((v, i) => ({ letras: numeroEnLetras(v), digitos: enCasilleros(a.digitos[i]) })),
  };
}

@Injectable()
export class SimuladorPublicoService {
  /** Reloj y azar inyectables para las pruebas. */
  ahora: () => Date = () => new Date();
  azar: Azar = azarSeguro;
  /** Por cédula: frena a quien prueba cédulas ajenas aunque cambie de IP. */
  private readonly limiteIngreso = new LimitePorClave(10, 60_000, DEMASIADOS);
  private readonly limiteInicio = new LimitePorClave(5, 60_000, DEMASIADOS);

  constructor(private readonly prisma: PrismaService) {}

  async ingresar(cedula: string): Promise<IngresoSimuladorResponse> {
    this.limiteIngreso.registrar(cedula, this.ahora().getTime());
    const persona = await this.persona(cedula);
    const practicas = await this.practicasDe(persona);
    if (practicas.length === 0) throw new NotFoundException(SIN_PRACTICAS);
    return { nombre: enmascararNombre(persona.apellidosNombres), cargo: persona.cargoCda.nombre, practicas };
  }

  /**
   * Empieza un intento, o retoma el que sigue con tiempo (con un token nuevo:
   * el de otra pestaña o equipo deja de servir). `equipo`: identificador del
   * navegador; desde el mismo equipo se retoma sin esperar (cerró por error).
   */
  async iniciar(
    cedula: string,
    practicaId: string,
    equipo?: string,
  ): Promise<IniciarSimuladorResponse & { operadorId: string; retomado: boolean }> {
    this.limiteInicio.registrar(cedula, this.ahora().getTime());
    const persona = await this.persona(cedula);
    const practica = await this.prisma.practicaDigitacion.findUnique({
      where: { id: practicaId },
      include: { cargos: { select: { cargo: true } }, personas: { where: { operadorId: persona.id } } },
    });
    if (!practica || !practica.activa || !aplicaA(practica, persona)) throw new NotFoundException(SIN_PRACTICAS);

    const ahora = this.ahora();
    await this.cerrarVencidos(persona.id, practica.id, ahora);
    const token = nuevoToken();
    const tokenHash = hashTokenSimulador(token);
    const equipoHash = equipo ? hashTokenSimulador(equipo) : null;
    const enCurso = await this.prisma.intentoDigitacion.findFirst({
      where: { practicaId, operadorId: persona.id, terminadoEn: null, anuladoEn: null, venceEn: { gt: ahora } },
    });

    let intento;
    if (enCurso) {
      const mismoEquipo = equipoHash !== null && equipoHash === enCurso.equipoHash;
      if (!mismoEquipo && ahora.getTime() - enCurso.ultimaActividadEn.getTime() < RETOME_BLOQUEADO_MS) {
        throw new ConflictException(ABIERTA_EN_OTRO_EQUIPO);
      }
      intento = await this.prisma.intentoDigitacion.update({
        where: { id: enCurso.id },
        data: { tokenHash, ultimaActividadEn: ahora, equipoHash },
      });
    } else {
      if (ahora < practica.inicio || ahora > practica.fin) {
        throw new ConflictException('La práctica no está abierta en este momento');
      }
      // Los anulados no cuentan para el límite, pero conservan su número.
      const [usados, total] = await Promise.all([
        this.prisma.intentoDigitacion.count({ where: { practicaId, operadorId: persona.id, anuladoEn: null } }),
        this.prisma.intentoDigitacion.count({ where: { practicaId, operadorId: persona.id } }),
      ]);
      if (usados >= practica.intentosMax) {
        throw new ConflictException(`Ya usó sus ${practica.intentosMax} intento(s) de esta práctica`);
      }
      try {
        intento = await this.prisma.intentoDigitacion.create({
          data: {
            practicaId,
            operadorId: persona.id,
            numero: total + 1,
            cargo: persona.cargoCda.nombre,
            tokenHash,
            equipoHash,
            iniciadoEn: ahora,
            venceEn: new Date(ahora.getTime() + practica.plazoMinutos * 60_000),
            ultimaActividadEn: ahora,
          },
        });
      } catch (e) {
        // Dos clics a la vez en "Empezar": el segundo choca con el número de intento.
        if (esUnico(e)) throw new ConflictException('El intento ya se está iniciando; vuelva a entrar');
        throw e;
      }
    }
    const estado = estadoIntento(intento, practica, this.datosPersona(persona.apellidosNombres, intento.cargo), ahora);
    return { token, estado, operadorId: persona.id, retomado: Boolean(enCurso) };
  }

  async estado(token: string): Promise<EstadoIntentoSimulador> {
    const intento = await this.intentoPorToken(token);
    const ahora = this.ahora();
    await this.tocar(intento.id, ahora);
    return this.estadoDe(intento, ahora);
  }

  /** "Nueva acta": la pendiente si hay una (no se puede saltar un acta), si no una nueva. */
  async nuevaActa(token: string): Promise<NuevaActaSimuladorResponse> {
    const intento = await this.intentoPorToken(token);
    const ahora = this.ahora();
    await this.tocar(intento.id, ahora);
    const estado = await this.estadoDe(intento, ahora);
    if (estado.terminado) return { estado, acta: null };

    const pendiente = await this.prisma.actaDigitacion.findFirst({
      where: { intentoId: intento.id, completadaEn: null },
      orderBy: { numero: 'desc' },
    });
    if (pendiente) return { estado, acta: aActa(pendiente) };

    const ultima = await this.prisma.actaDigitacion.findFirst({
      where: { intentoId: intento.id },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    });
    const { valores, digitos } = generarActa(intento.practica, this.azar);
    try {
      const acta = await this.prisma.actaDigitacion.create({
        data: { intentoId: intento.id, numero: (ultima?.numero ?? 0) + 1, valores, digitos, primerGuardado: [], entregadaEn: ahora },
      });
      return { estado, acta: aActa(acta) };
    } catch (e) {
      // Otra pestaña la creó al mismo tiempo: devolver esa.
      if (!esUnico(e)) throw e;
      const otra = await this.prisma.actaDigitacion.findFirst({
        where: { intentoId: intento.id, completadaEn: null },
        orderBy: { numero: 'desc' },
      });
      if (!otra) throw e;
      return { estado, acta: aActa(otra) };
    }
  }

  /**
   * Califica en el servidor. Si hay filas mal, se avisa cuáles y puede
   * corregir, pero lo que cuenta es el primer guardado.
   */
  async guardar(token: string, actaId: string, valores: (number | null)[]): Promise<GuardarActaSimuladorResponse> {
    const intento = await this.intentoPorToken(token);
    const ahora = this.ahora();
    if (motivoCierre(intento, intento.practica.metaActas, ahora)) {
      await this.estadoDe(intento, ahora);
      throw new ConflictException('La práctica ya terminó');
    }
    const acta = await this.prisma.actaDigitacion.findFirst({ where: { id: actaId, intentoId: intento.id } });
    if (!acta) throw new NotFoundException('Acta no encontrada');
    if (acta.completadaEn) throw new ConflictException('Esta acta ya se guardó; pida una nueva');
    if (valores.length !== acta.valores.length) throw new BadRequestException('El acta no tiene esa cantidad de filas');

    const incorrectas = filasIncorrectas(acta.valores, valores);
    const primera = acta.guardados === 0;
    const registros = conteoFilas(acta.valores, valores);
    const completa = incorrectas.length === 0;
    // Si ya hubo un guardado, ese primero tuvo errores: el acta no puede salir perfecta.
    const perfecta = completa && primera;

    const actualizado = await this.prisma.$transaction(async (tx) => {
      // Si otra pestaña guardó en medio, "guardados" ya no coincide y no se cuenta dos veces.
      const { count } = await tx.actaDigitacion.updateMany({
        where: { id: acta.id, guardados: acta.guardados, completadaEn: null },
        data: {
          guardados: { increment: 1 },
          ...(primera ? { primerGuardado: comoGuardado(acta.valores.length, valores), filasFallidas: incorrectas.length } : {}),
          ...(completa ? { completadaEn: ahora } : {}),
        },
      });
      if (count === 0) throw new ConflictException('El acta se guardó desde otra pestaña; pida una nueva');
      const nuevo = await tx.intentoDigitacion.update({
        where: { id: intento.id },
        data: {
          ultimaActividadEn: ahora,
          ...(primera
            ? {
                filasFallidas: { increment: incorrectas.length },
                filasDigitadas: { increment: registros.digitadas },
                filasCorrectas: { increment: registros.correctas },
              }
            : {}),
          ...(completa ? { actasCompletadas: { increment: 1 } } : {}),
          ...(perfecta ? { actasPerfectas: { increment: 1 } } : {}),
        },
        include: INTENTO.include,
      });
      // Con el conteo real (no el leído antes): cierra al llegar a la meta.
      if (nuevo.actasCompletadas >= intento.practica.metaActas && !nuevo.terminadoEn) {
        await tx.intentoDigitacion.updateMany({ where: { id: intento.id, terminadoEn: null }, data: { terminadoEn: ahora } });
        return { ...nuevo, terminadoEn: ahora };
      }
      return nuevo;
    });

    const aviso =
      completa && actualizado.actasCompletadas % AVISO_CADA_ACTAS === 0 ? await this.aviso(intento.id) : null;
    return {
      guardada: completa,
      filasIncorrectas: incorrectas,
      estado: this.estadoSinCerrar(actualizado, ahora),
      aviso,
    };
  }

  /**
   * Lo escrito en el acta abierta, sin calificar: si el tiempo se acaba con el
   * acta a medias, esas filas cuentan como registros. Se acepta hasta
   * MARGEN_BORRADOR_MS después del fin (el último envío puede llegar tarde).
   * Un acta ya guardada no cambia: cuenta su primer guardado.
   */
  async borrador(token: string, actaId: string, valores: (number | null)[]): Promise<{ guardado: boolean }> {
    const intento = await this.intentoPorToken(token);
    const ahora = this.ahora();
    const motivo = motivoCierre(intento, intento.practica.metaActas, ahora);
    const enMargen = motivo === 'TIEMPO' && ahora.getTime() <= intento.venceEn.getTime() + MARGEN_BORRADOR_MS;
    if (motivo && !enMargen) return { guardado: false };
    const acta = await this.prisma.actaDigitacion.findFirst({ where: { id: actaId, intentoId: intento.id }, select: { valores: true } });
    if (!acta) throw new NotFoundException('Acta no encontrada');
    if (valores.length !== acta.valores.length) throw new BadRequestException('El acta no tiene esa cantidad de filas');
    const { count } = await this.prisma.actaDigitacion.updateMany({
      where: { id: actaId, guardados: 0, completadaEn: null },
      data: { borrador: comoGuardado(acta.valores.length, valores), borradorEn: ahora },
    });
    if (!motivo) await this.tocar(intento.id, ahora);
    return { guardado: count > 0 };
  }

  // ---- internos ----

  /** Registros del acta abierta sin guardar (su borrador), para sumarlos al terminar por tiempo. */
  private async parcial(intentoId: string): Promise<Parcial> {
    const abierta = await this.prisma.actaDigitacion.findFirst({
      where: { intentoId, guardados: 0, completadaEn: null },
      orderBy: { numero: 'desc' },
      select: { valores: true, borrador: true },
    });
    return abierta ? conteoFilas(abierta.valores, abierta.borrador) : { digitadas: 0, correctas: 0 };
  }

  /** Persona activa por cédula; si no, el mismo mensaje que "sin prácticas". */
  private async persona(cedula: string) {
    const persona = await this.prisma.operadorCda.findUnique({ where: { cedula }, ...PERSONA });
    if (!persona || !persona.activo) throw new NotFoundException(SIN_PRACTICAS);
    return persona;
  }

  private async practicasDe(persona: { id: string; grupo: string }): Promise<PracticaDisponibleSimulador[]> {
    const ahora = this.ahora();
    await this.cerrarVencidos(persona.id, undefined, ahora);
    const filas = await this.prisma.practicaDigitacion.findMany({
      where: {
        activa: true,
        OR: [
          { cargos: { some: { cargo: persona.grupo } } },
          { personas: { some: { operadorId: persona.id, incluida: true } } },
        ],
      },
      include: {
        cargos: { select: { cargo: true } },
        personas: { where: { operadorId: persona.id } },
        intentos: { where: { operadorId: persona.id, anuladoEn: null }, select: { terminadoEn: true, venceEn: true } },
      },
      orderBy: { inicio: 'asc' },
    });
    return filas
      .filter((p) => aplicaA(p, persona))
      .map((p) => ({ p, enCurso: p.intentos.some((i) => !i.terminadoEn && i.venceEn > ahora) }))
      // Fuera de la ventana solo se muestra si hay un intento que retomar.
      .filter(({ p, enCurso }) => enCurso || (p.inicio <= ahora && ahora <= p.fin))
      .map(({ p, enCurso }) => ({
        id: p.id,
        nombre: p.nombre,
        metaActas: p.metaActas,
        plazoMinutos: p.plazoMinutos,
        filasPorActa: p.filasPorActa,
        fin: p.fin.toISOString(),
        intentosUsados: p.intentos.length,
        intentosMax: p.intentosMax,
        enCurso,
      }));
  }

  /** Marca como terminados los intentos cuyo plazo pasó (a la hora en que vencieron). */
  private async cerrarVencidos(operadorId: string, practicaId: string | undefined, ahora: Date): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE "intentos_digitacion" SET "terminado_en" = "vence_en"
      WHERE "operador_id" = ${operadorId}::uuid
        AND "terminado_en" IS NULL
        AND "vence_en" <= ${ahora}
        ${practicaId ? Prisma.sql`AND "practica_id" = ${practicaId}::uuid` : Prisma.empty}`;
  }

  /** Marca la sesión como en uso (bloquea el retome desde otro equipo). */
  private async tocar(intentoId: string, ahora: Date): Promise<void> {
    await this.prisma.intentoDigitacion.updateMany({ where: { id: intentoId }, data: { ultimaActividadEn: ahora } });
  }

  private async intentoPorToken(token: string): Promise<IntentoConPractica> {
    const intento = await this.prisma.intentoDigitacion.findUnique({ where: { tokenHash: hashTokenSimulador(token) }, ...INTENTO });
    if (!intento) throw new UnauthorizedException('La sesión de práctica no es válida; vuelva a entrar con su cédula');
    if (intento.anuladoEn) throw new UnauthorizedException(INTENTO_ANULADO);
    return intento;
  }

  /** Estado, y si el tiempo se acabó, lo deja cerrado en la base. */
  private async estadoDe(intento: IntentoConPractica, ahora: Date): Promise<EstadoIntentoSimulador> {
    const motivo = motivoCierre(intento, intento.practica.metaActas, ahora);
    if (motivo && !intento.terminadoEn) {
      const terminadoEn = motivo === 'TIEMPO' ? intento.venceEn : ahora;
      await this.prisma.intentoDigitacion.updateMany({ where: { id: intento.id, terminadoEn: null }, data: { terminadoEn } });
      intento = { ...intento, terminadoEn };
    }
    // Terminado por tiempo: el acta que quedó a medias también cuenta.
    const parcial = motivo === 'TIEMPO' ? await this.parcial(intento.id) : undefined;
    return this.estadoSinCerrar(intento, ahora, parcial);
  }

  private estadoSinCerrar(intento: IntentoConPractica, ahora: Date, parcial?: Parcial): EstadoIntentoSimulador {
    return estadoIntento(
      intento,
      intento.practica,
      this.datosPersona(intento.operador.apellidosNombres, intento.cargo),
      ahora,
      parcial,
    );
  }

  private datosPersona(apellidosNombres: string, cargo: string) {
    return { nombre: enmascararNombre(apellidosNombres), cargo };
  }

  /** "Digitó 18 de 20": actas sin errores en el primer guardado, de las últimas 20. */
  private async aviso(intentoId: string): Promise<{ perfectas: number; de: number }> {
    const ultimas = await this.prisma.actaDigitacion.findMany({
      where: { intentoId, completadaEn: { not: null } },
      orderBy: { numero: 'desc' },
      take: AVISO_CADA_ACTAS,
      select: { filasFallidas: true },
    });
    return { perfectas: ultimas.filter((a) => a.filasFallidas === 0).length, de: ultimas.length };
  }
}
