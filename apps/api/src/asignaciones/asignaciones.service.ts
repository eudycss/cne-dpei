import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { bulkAsignacionRowSchema, upsertAsignacionSchema } from '@cne/shared-validation';
import type {
  Asignacion,
  BulkUploadResult,
  BulkUploadRow,
  UpsertAsignacionRequest,
} from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { parseUploadRows } from '../common/parse-upload-rows';

@Injectable()
export class AsignacionesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(eventoId: string): Promise<Asignacion[]> {
    const rows = await this.prisma.asignacionSupervisor.findMany({
      where: { eventoId },
      orderBy: { creadoEn: 'asc' },
    });
    if (rows.length === 0) return [];

    const userIds = [
      ...new Set([...rows.map((r) => r.operadorId), ...rows.map((r) => r.supervisorId)]),
    ];
    const users = await this.prisma.usuario.findMany({
      where: { id: { in: userIds } },
      select: { id: true, nombres: true, apellidos: true, cedula: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    return rows.map((r) => toDto(r, byId));
  }

  async upsert(input: UpsertAsignacionRequest): Promise<Asignacion> {
    const parsed = upsertAsignacionSchema.parse(input);

    const evento = await this.prisma.eventoElectoral.findUnique({
      where: { id: parsed.eventoId },
    });
    if (!evento) throw new NotFoundException('Evento no encontrado');

    const operador = await this.prisma.usuario.findFirst({
      where: {
        id: parsed.operadorId,
        roles: { some: { rol: { nombre: 'OPERADOR_CDA' } } },
      },
      select: { id: true, nombres: true, apellidos: true, cedula: true },
    });
    if (!operador) throw new BadRequestException('El usuario no tiene rol OPERADOR_CDA');

    const supervisor = await this.prisma.usuario.findFirst({
      where: {
        id: parsed.supervisorId,
        roles: { some: { rol: { nombre: 'TECNICO_SUPERVISOR' } } },
      },
      select: { id: true, nombres: true, apellidos: true, cedula: true },
    });
    if (!supervisor) throw new BadRequestException('El usuario no tiene rol TECNICO_SUPERVISOR');

    const row = await this.prisma.asignacionSupervisor.upsert({
      where: {
        eventoId_operadorId: { eventoId: parsed.eventoId, operadorId: parsed.operadorId },
      },
      create: {
        eventoId: parsed.eventoId,
        operadorId: parsed.operadorId,
        supervisorId: parsed.supervisorId,
      },
      update: { supervisorId: parsed.supervisorId },
    });

    const byId = new Map([
      [operador.id, operador],
      [supervisor.id, supervisor],
    ]);
    return toDto(row, byId);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.asignacionSupervisor.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Asignación no encontrada');
    await this.prisma.asignacionSupervisor.delete({ where: { id } });
  }

  /**
   * Carga masiva de asignaciones operador↔supervisor para un evento. Cada fila
   * referencia operador y supervisor por cédula; hace upsert igual que el alta
   * individual (1 supervisor por operador y evento).
   */
  async bulkUpload(file: Express.Multer.File, eventoId: string): Promise<BulkUploadResult> {
    if (!file) throw new BadRequestException('Archivo requerido');
    const evento = await this.prisma.eventoElectoral.findUnique({ where: { id: eventoId } });
    if (!evento) throw new NotFoundException('Evento no encontrado');

    const rows = await parseUploadRows(file);
    if (rows.length === 0) throw new BadRequestException('El archivo no tiene filas');

    const operadores = await this.prisma.usuario.findMany({
      where: { roles: { some: { rol: { nombre: 'OPERADOR_CDA' } } } },
      select: { id: true, cedula: true },
    });
    const operadorPorCedula = new Map(operadores.map((o) => [o.cedula.trim(), o.id]));
    const supervisores = await this.prisma.usuario.findMany({
      where: { roles: { some: { rol: { nombre: 'TECNICO_SUPERVISOR' } } } },
      select: { id: true, cedula: true },
    });
    const supervisorPorCedula = new Map(supervisores.map((s) => [s.cedula.trim(), s.id]));

    const errores: BulkUploadRow[] = [];
    let creados = 0;

    for (let i = 0; i < rows.length; i++) {
      const filaNum = i + 2; // +1 header, +1 base-1
      const raw = rows[i];
      const parsed = bulkAsignacionRowSchema.safeParse(raw);
      if (!parsed.success) {
        errores.push({
          fila: filaNum,
          error: parsed.error.issues.map((iss) => `${iss.path.join('.')}: ${iss.message}`).join('; '),
          datos: raw,
        });
        continue;
      }
      const cedulaOp = parsed.data.cedula_operador.trim();
      const cedulaSv = parsed.data.cedula_supervisor.trim();

      const operadorId = operadorPorCedula.get(cedulaOp);
      if (!operadorId) {
        errores.push({ fila: filaNum, error: `Operador no encontrado o sin rol OPERADOR_CDA: ${cedulaOp}`, datos: raw });
        continue;
      }
      const supervisorId = supervisorPorCedula.get(cedulaSv);
      if (!supervisorId) {
        errores.push({ fila: filaNum, error: `Supervisor no encontrado o sin rol TECNICO_SUPERVISOR: ${cedulaSv}`, datos: raw });
        continue;
      }

      try {
        await this.prisma.asignacionSupervisor.upsert({
          where: { eventoId_operadorId: { eventoId, operadorId } },
          create: { eventoId, operadorId, supervisorId },
          update: { supervisorId },
        });
        creados++;
      } catch (e: any) {
        errores.push({ fila: filaNum, error: e?.message ?? 'Error desconocido', datos: raw });
      }
    }

    return { creados, errores };
  }

  async generateTemplate(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Asignaciones');
    ws.columns = [
      { header: 'cedula_operador', key: 'cedula_operador', width: 18 },
      { header: 'cedula_supervisor', key: 'cedula_supervisor', width: 18 },
    ];
    ws.addRow({ cedula_operador: '1002003004', cedula_supervisor: '1003004005' });
    ws.getRow(1).font = { bold: true };
    const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    return Buffer.from(buffer);
  }
}

function toDto(
  r: { id: string; eventoId: string; operadorId: string; supervisorId: string; creadoEn: Date },
  byId: Map<string, { id: string; nombres: string; apellidos: string; cedula: string }>,
): Asignacion {
  const op = byId.get(r.operadorId);
  const sv = byId.get(r.supervisorId);
  return {
    id: r.id,
    eventoId: r.eventoId,
    operadorId: r.operadorId,
    operadorNombre: op ? `${op.nombres} ${op.apellidos}` : r.operadorId,
    operadorCedula: op?.cedula ?? '',
    supervisorId: r.supervisorId,
    supervisorNombre: sv ? `${sv.nombres} ${sv.apellidos}` : r.supervisorId,
    creadoEn: r.creadoEn.toISOString(),
  };
}
