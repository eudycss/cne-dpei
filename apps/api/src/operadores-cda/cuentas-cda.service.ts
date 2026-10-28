import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import type { GrupoCda, ResumenCuentasCda } from '@cne/shared-types';

import { PrismaService } from '../db/prisma.service';
import { partirNombre } from './nombre-cda';

/** Solo estos grupos usan la app de campo (parejas operador + asistente). */
export const GRUPOS_CON_CUENTA: readonly GrupoCda[] = ['OPERADOR', 'ASISTENTE'];
const ROL_CDA = 'OPERADOR_CDA';

export type ResultadoAsegurar = 'CREADA' | 'VINCULADA' | 'YA_TENIA' | 'NO_APLICA';

type Tx = Prisma.TransactionClient;

/**
 * Cuentas de la app para las personas de Operadores CDA (grupos OPERADOR y
 * ASISTENTE). Entran con su cédula; la cuenta nueva no tiene correo y usa la
 * misma contraseña inicial que el reseteo de Usuarios, con cambio obligatorio.
 */
@Injectable()
export class CuentasCdaService {
  constructor(private readonly prisma: PrismaService) {}

  tieneCuenta(grupo: GrupoCda): boolean {
    return GRUPOS_CON_CUENTA.includes(grupo);
  }

  /**
   * Garantiza que la persona tenga una cuenta activa con rol OPERADOR_CDA.
   * Si ya existe un usuario con su cédula (cuenta vieja o de otro rol), se
   * vincula sin tocar su contraseña ni sus otros roles.
   */
  async asegurarCuenta(tx: Tx, operadorId: string): Promise<ResultadoAsegurar> {
    const op = await tx.operadorCda.findUnique({
      where: { id: operadorId },
      select: { id: true, cedula: true, apellidosNombres: true, telefono: true, grupo: true, activo: true, usuarioId: true },
    });
    if (!op || !op.activo || !this.tieneCuenta(op.grupo)) return 'NO_APLICA';
    const rolId = await this.rolCdaId(tx);

    if (op.usuarioId) {
      await this.activarConRol(tx, op.usuarioId, rolId);
      return 'YA_TENIA';
    }

    const existente = await tx.usuario.findUnique({ where: { cedula: op.cedula }, select: { id: true, activo: true } });
    if (existente) {
      if (!existente.activo) await tx.usuario.update({ where: { id: existente.id }, data: { activo: true } });
      await this.garantizarRol(tx, existente.id, rolId);
      await tx.operadorCda.update({ where: { id: op.id }, data: { usuarioId: existente.id } });
      return 'VINCULADA';
    }

    const passwordHash = await argon2.hash(process.env.DEFAULT_RESET_PASSWORD ?? 'Cne2026!');
    const creado = await tx.usuario.create({
      data: {
        cedula: op.cedula,
        email: null,
        ...partirNombre(op.apellidosNombres),
        telefono: op.telefono,
        passwordHash,
        debeCambiarPwd: true,
        roles: { create: { rolId } },
      },
      select: { id: true },
    });
    await tx.operadorCda.update({ where: { id: op.id }, data: { usuarioId: creado.id } });
    return 'CREADA';
  }

  /**
   * Quita el acceso a la app: retira el rol OPERADOR_CDA y cierra sus sesiones.
   * Solo desactiva la cuenta si ese era su único rol (un Administrador que
   * además es asistente sigue entrando a la web). El vínculo se conserva para
   * reutilizar la misma cuenta si vuelve.
   */
  async retirarCuenta(tx: Tx, operadorId: string): Promise<void> {
    const op = await tx.operadorCda.findUnique({ where: { id: operadorId }, select: { usuarioId: true } });
    if (!op?.usuarioId) return;
    const usuarioId = op.usuarioId;
    const rolId = await this.rolCdaId(tx);
    await tx.usuarioRol.deleteMany({ where: { usuarioId, rolId } });
    const otrosRoles = await tx.usuarioRol.count({ where: { usuarioId } });
    if (otrosRoles === 0) await tx.usuario.update({ where: { id: usuarioId }, data: { activo: false } });
    await tx.refreshToken.updateMany({ where: { usuarioId, revocadoEn: null }, data: { revocadoEn: new Date() } });
  }

  /**
   * Crea o vincula la cuenta de cada operador/asistente activo que aún no
   * tiene. Sin filtro recorre a todos (botón de la web); con `ids` o `cedulas`
   * solo a esas personas (alta manual e importación).
   */
  async sincronizar(
    filtro: { ids?: string[]; cedulas?: string[] } = {},
  ): Promise<{ vinculadas: number; creadas: number }> {
    const pendientes = await this.prisma.operadorCda.findMany({
      where: {
        grupo: { in: [...GRUPOS_CON_CUENTA] },
        activo: true,
        usuarioId: null,
        ...(filtro.ids && { id: { in: filtro.ids } }),
        ...(filtro.cedulas && { cedula: { in: filtro.cedulas } }),
      },
      select: { id: true },
      orderBy: { apellidosNombres: 'asc' },
    });
    const conteo = { vinculadas: 0, creadas: 0 };
    // Una transacción por persona: un error no deshace a las demás, y el hash
    // argon2 (~64 MB) se calcula de a uno (Render tiene 512 MB).
    for (const { id } of pendientes) {
      const r = await this.asegurarConReintento(id);
      if (r === 'CREADA') conteo.creadas++;
      if (r === 'VINCULADA') conteo.vinculadas++;
    }
    return conteo;
  }

  async resumen(): Promise<ResumenCuentasCda> {
    const base = { grupo: { in: [...GRUPOS_CON_CUENTA] }, activo: true };
    const [conCuenta, sinCuenta, pendientesCambioPwd, bloqueadas, cuentasSinVinculo] = await Promise.all([
      this.prisma.operadorCda.count({ where: { ...base, usuarioId: { not: null } } }),
      this.prisma.operadorCda.count({ where: { ...base, usuarioId: null } }),
      this.prisma.operadorCda.count({ where: { ...base, usuario: { is: { debeCambiarPwd: true } } } }),
      this.prisma.operadorCda.count({ where: { ...base, usuario: { is: { bloqueadoHasta: { gt: new Date() } } } } }),
      this.prisma.usuario.count({ where: this.whereSinVinculo() }),
    ]);
    return { conCuenta, sinCuenta, pendientesCambioPwd, bloqueadas, cuentasSinVinculo };
  }

  /** Desactiva las cuentas viejas de Operador CDA que no corresponden a nadie del listado. */
  async desactivarSinVinculo(): Promise<{ desactivadas: number }> {
    const cuentas = await this.prisma.usuario.findMany({ where: this.whereSinVinculo(), select: { id: true } });
    if (cuentas.length === 0) return { desactivadas: 0 };
    const ids = cuentas.map((c) => c.id);
    const [{ count }] = await this.prisma.$transaction([
      this.prisma.usuario.updateMany({ where: { id: { in: ids } }, data: { activo: false } }),
      this.prisma.refreshToken.updateMany({
        where: { usuarioId: { in: ids }, revocadoEn: null },
        data: { revocadoEn: new Date() },
      }),
    ]);
    return { desactivadas: count };
  }

  /** Activas, sin persona en Operadores CDA y con OPERADOR_CDA como único rol. */
  private whereSinVinculo(): Prisma.UsuarioWhereInput {
    return {
      activo: true,
      operadorCda: { is: null },
      roles: { some: { rol: { nombre: ROL_CDA } }, every: { rol: { nombre: ROL_CDA } } },
    };
  }

  /** Dos pulsaciones simultáneas pueden crear la misma cédula: la segunda reintenta y vincula. */
  private async asegurarConReintento(operadorId: string): Promise<ResultadoAsegurar> {
    try {
      return await this.prisma.$transaction((tx) => this.asegurarCuenta(tx, operadorId));
    } catch (e) {
      if ((e as { code?: string } | null)?.code !== 'P2002') throw e;
      return this.prisma.$transaction((tx) => this.asegurarCuenta(tx, operadorId));
    }
  }

  private async activarConRol(tx: Tx, usuarioId: string, rolId: string): Promise<void> {
    await tx.usuario.update({ where: { id: usuarioId }, data: { activo: true } });
    await this.garantizarRol(tx, usuarioId, rolId);
  }

  private async garantizarRol(tx: Tx, usuarioId: string, rolId: string): Promise<void> {
    await tx.usuarioRol.upsert({
      where: { usuarioId_rolId: { usuarioId, rolId } },
      create: { usuarioId, rolId },
      update: {},
    });
  }

  private async rolCdaId(tx: Tx): Promise<string> {
    const rol = await tx.rol.findUnique({ where: { nombre: ROL_CDA }, select: { id: true } });
    if (!rol) throw new Error(`Falta el rol ${ROL_CDA} (correr el seed)`);
    return rol.id;
  }
}
