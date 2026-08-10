import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { parse as csvParse } from 'csv-parse/sync';
import {
  bulkMilitarRowSchema,
  createMilitarSchema,
  updateMilitarSchema,
} from '@cne/shared-validation';
import type {
  BulkUploadResult,
  BulkUploadRow,
  CreateMilitarRequest,
  Militar,
  Paginated,
  UpdateMilitarRequest,
} from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';

@Injectable()
export class MilitaresService {
  constructor(private readonly prisma: PrismaService) {}

  async list(opts: {
    page?: number;
    pageSize?: number;
    search?: string;
    recintoId?: string;
  }): Promise<Paginated<Militar>> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const where: any = {};
    if (opts.search) {
      where.OR = [
        { nombres: { contains: opts.search, mode: 'insensitive' } },
        { apellidos: { contains: opts.search, mode: 'insensitive' } },
        { cedula: { contains: opts.search } },
      ];
    }
    if (opts.recintoId) where.recintoId = opts.recintoId;

    const [total, items] = await this.prisma.$transaction([
      this.prisma.militar.count({ where }),
      this.prisma.militar.findMany({
        where,
        include: { recinto: true },
        orderBy: { creadoEn: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: items.map(toMilitarDto), total, page, pageSize };
  }

  async create(input: CreateMilitarRequest): Promise<Militar> {
    const parsed = createMilitarSchema.parse(input);
    await this.assertRecinto(parsed.recintoId);
    const m = await this.prisma.militar.create({
      data: parsed,
      include: { recinto: true },
    });
    return toMilitarDto(m);
  }

  async update(id: string, input: UpdateMilitarRequest): Promise<Militar> {
    const parsed = updateMilitarSchema.parse(input);
    const existing = await this.prisma.militar.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Militar no encontrado');
    if (parsed.recintoId) await this.assertRecinto(parsed.recintoId);
    const m = await this.prisma.militar.update({
      where: { id },
      data: {
        cedula: parsed.cedula ?? existing.cedula,
        nombres: parsed.nombres ?? existing.nombres,
        apellidos: parsed.apellidos ?? existing.apellidos,
        recintoId: parsed.recintoId ?? existing.recintoId,
      },
      include: { recinto: true },
    });
    return toMilitarDto(m);
  }

  async remove(id: string): Promise<{ deleted: true }> {
    const existing = await this.prisma.militar.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Militar no encontrado');
    await this.prisma.militar.delete({ where: { id } });
    return { deleted: true };
  }

  async bulkUpload(file: Express.Multer.File): Promise<BulkUploadResult> {
    if (!file) throw new BadRequestException('Archivo requerido');
    const rows = await this.parseRows(file);
    if (rows.length === 0) throw new BadRequestException('El archivo no tiene filas');

    // Mapa codigo_recinto -> id (una sola consulta)
    const codigos = [...new Set(rows.map((r) => String(r.codigo_recinto ?? '').trim()))];
    const recintos = await this.prisma.recinto.findMany({
      where: { codigoRecinto: { in: codigos } },
      select: { id: true, codigoRecinto: true },
    });
    const recintoByCodigo = new Map<string, string>(
      recintos.map((r): [string, string] => [r.codigoRecinto, r.id]),
    );

    const errores: BulkUploadRow[] = [];
    let creados = 0;

    for (let i = 0; i < rows.length; i++) {
      const filaNum = i + 2;
      const raw = rows[i];
      const parsed = bulkMilitarRowSchema.safeParse(raw);
      if (!parsed.success) {
        errores.push({
          fila: filaNum,
          error: parsed.error.issues
            .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
            .join('; '),
          datos: raw,
        });
        continue;
      }
      const recintoId = recintoByCodigo.get(parsed.data.codigo_recinto.trim());
      if (!recintoId) {
        errores.push({
          fila: filaNum,
          error: `Recinto no encontrado: ${parsed.data.codigo_recinto}`,
          datos: raw,
        });
        continue;
      }
      try {
        await this.prisma.militar.create({
          data: {
            cedula: parsed.data.cedula,
            nombres: parsed.data.nombres,
            apellidos: parsed.data.apellidos,
            recintoId,
          },
        });
        creados++;
      } catch (e: any) {
        errores.push({ fila: filaNum, error: e?.message ?? 'Error', datos: raw });
      }
    }
    return { creados, errores };
  }

  async generateTemplate(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Militares');
    ws.columns = [
      { header: 'cedula', key: 'cedula', width: 14 },
      { header: 'nombres', key: 'nombres', width: 24 },
      { header: 'apellidos', key: 'apellidos', width: 24 },
      { header: 'codigo_recinto', key: 'codigo_recinto', width: 16 },
    ];
    ws.addRow({ cedula: '1003456789', nombres: 'Pedro', apellidos: 'Suárez', codigo_recinto: '28' });
    ws.getRow(1).font = { bold: true };
    const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    return Buffer.from(buffer);
  }

  // ---- internos ----
  private async assertRecinto(recintoId: string) {
    const r = await this.prisma.recinto.findUnique({ where: { id: recintoId } });
    if (!r) throw new BadRequestException('El recinto indicado no existe');
  }

  private async parseRows(
    file: Express.Multer.File,
  ): Promise<Array<Record<string, string>>> {
    const filename = (file.originalname ?? '').toLowerCase();
    const isExcel = filename.endsWith('.xlsx') || filename.endsWith('.xls');
    const isCsv = filename.endsWith('.csv') || file.mimetype === 'text/csv';

    if (isExcel) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(file.buffer as any);
      const ws = wb.worksheets[0];
      if (!ws) return [];
      const headers: string[] = [];
      ws.getRow(1).eachCell((cell, col) => {
        headers[col - 1] = String(cell.value ?? '').trim().toLowerCase();
      });
      const result: Array<Record<string, string>> = [];
      ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
        if (rowNum === 1) return;
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
          if (!h) return;
          const v = row.getCell(i + 1).value;
          obj[h] = v == null ? '' : String(v).trim();
        });
        result.push(obj);
      });
      return result;
    }
    if (isCsv) {
      return csvParse(file.buffer.toString('utf8'), {
        columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
      }) as Array<Record<string, string>>;
    }
    throw new BadRequestException('Formato no soportado: usa .xlsx o .csv');
  }
}

function toMilitarDto(m: any): Militar {
  return {
    id: m.id,
    cedula: m.cedula,
    nombres: m.nombres,
    apellidos: m.apellidos,
    recintoId: m.recintoId,
    recintoNombre: m.recinto?.nombre,
    recintoCodigo: m.recinto?.codigoRecinto,
    creadoEn: m.creadoEn?.toISOString?.() ?? String(m.creadoEn),
  };
}
