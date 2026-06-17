import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as ExcelJS from 'exceljs';
import { parse as csvParse } from 'csv-parse/sync';
import { bulkRecintoRowSchema, createRecintoSchema, updateRecintoSchema } from '@cne/shared-validation';
import type {
  BulkUploadRow,
  Canton,
  CreateRecintoRequest,
  Paginated,
  Recinto,
  UpdateRecintoRequest,
} from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';

@Injectable()
export class RecintosService {
  constructor(private readonly prisma: PrismaService) {}

  async listRecintos(opts: {
    page?: number;
    pageSize?: number;
    search?: string;
    cantonId?: number;
    tipo?: 'CDA' | 'NO_CDA';
    cdaDestinoId?: string;
    conOrigenes?: 'true' | 'false';
  }): Promise<Paginated<Recinto>> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
    const where: any = {};
    if (opts.search) {
      where.OR = [
        { nombre: { contains: opts.search, mode: 'insensitive' } },
        { codigoRecinto: { contains: opts.search } },
        { parroquia: { contains: opts.search, mode: 'insensitive' } },
      ];
    }
    if (opts.cantonId) where.cantonId = opts.cantonId;
    if (opts.tipo) where.tipo = opts.tipo;
    if (opts.cdaDestinoId) where.cdaDestinoId = opts.cdaDestinoId;
    if (opts.conOrigenes === 'true') where.origenes = { some: {} };
    if (opts.conOrigenes === 'false') where.origenes = { none: {} };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.recinto.count({ where }),
      this.prisma.recinto.findMany({
        where,
        include: { canton: true, _count: { select: { origenes: true } } },
        orderBy: { nombre: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const coords = await this.getCoords(items.map((i) => i.id));
    return {
      items: items.map((i) => toRecintoDto(i, coords.get(i.id))),
      total,
      page,
      pageSize,
    };
  }

  async getRecinto(id: string): Promise<Recinto> {
    const r = await this.prisma.recinto.findUnique({
      where: { id },
      include: { canton: true },
    });
    if (!r) throw new NotFoundException('Recinto no encontrado');
    const coords = await this.getCoords([id]);
    return toRecintoDto(r, coords.get(id));
  }

  async listCantones(): Promise<Canton[]> {
    const cantones = await this.prisma.canton.findMany({ orderBy: { nombre: 'asc' } });
    return cantones.map((c) => ({ id: c.id, codigo: c.codigo, nombre: c.nombre }));
  }

  async create(input: CreateRecintoRequest): Promise<Recinto> {
    const parsed = createRecintoSchema.parse(input);
    await this.assertCanton(parsed.cantonId);
    await this.assertCodigoDisponible(parsed.codigoRecinto);

    const id = crypto.randomUUID();
    await this.prisma.$executeRaw`
      INSERT INTO recintos (
        id, codigo_recinto, nombre, direccion, canton_id, parroquia, zona, tipo,
        ubicacion, tiene_internet, cobertura_movil, numero_electores,
        juntas_femeninas, juntas_masculinas
      ) VALUES (
        ${id}::uuid, ${parsed.codigoRecinto}, ${parsed.nombre}, ${parsed.direccion ?? null},
        ${parsed.cantonId}, ${parsed.parroquia ?? null}, ${parsed.zona ?? null}, ${parsed.tipo}::tipo_recinto,
        ST_SetSRID(ST_MakePoint(${parsed.longitud}, ${parsed.latitud}), 4326)::geography,
        ${parsed.tieneInternet ?? false}, ${parsed.coberturaMovil ?? false}, ${parsed.numeroElectores ?? null},
        ${parsed.juntasFemeninas ?? null}, ${parsed.juntasMasculinas ?? null}
      )
    `;
    return this.getRecinto(id);
  }

  async update(id: string, input: UpdateRecintoRequest): Promise<Recinto> {
    const parsed = updateRecintoSchema.parse(input);
    const existing = await this.prisma.recinto.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Recinto no encontrado');

    if (parsed.cantonId) await this.assertCanton(parsed.cantonId);
    if (parsed.codigoRecinto && parsed.codigoRecinto !== existing.codigoRecinto) {
      await this.assertCodigoDisponible(parsed.codigoRecinto);
    }

    await this.prisma.recinto.update({
      where: { id },
      data: {
        codigoRecinto: parsed.codigoRecinto ?? undefined,
        nombre: parsed.nombre ?? undefined,
        direccion: parsed.direccion === undefined ? undefined : parsed.direccion,
        cantonId: parsed.cantonId ?? undefined,
        parroquia: parsed.parroquia === undefined ? undefined : parsed.parroquia,
        zona: parsed.zona === undefined ? undefined : parsed.zona,
        tipo: parsed.tipo ?? undefined,
        tieneInternet: parsed.tieneInternet ?? undefined,
        coberturaMovil: parsed.coberturaMovil ?? undefined,
        numeroElectores: parsed.numeroElectores === undefined ? undefined : parsed.numeroElectores,
        juntasFemeninas: parsed.juntasFemeninas === undefined ? undefined : parsed.juntasFemeninas,
        juntasMasculinas: parsed.juntasMasculinas === undefined ? undefined : parsed.juntasMasculinas,
      },
    });

    if (parsed.latitud !== undefined && parsed.longitud !== undefined) {
      await this.prisma.$executeRaw`
        UPDATE recintos
        SET ubicacion = ST_SetSRID(ST_MakePoint(${parsed.longitud}, ${parsed.latitud}), 4326)::geography
        WHERE id = ${id}::uuid
      `;
    }

    return this.getRecinto(id);
  }

  async remove(id: string): Promise<{ deleted: true }> {
    const existing = await this.prisma.recinto.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Recinto no encontrado');

    const [militaresCount, dependientesCount] = await this.prisma.$transaction([
      this.prisma.militar.count({ where: { recintoId: id } }),
      this.prisma.recinto.count({ where: { cdaDestinoId: id } }),
    ]);
    if (militaresCount > 0) {
      throw new ConflictException(
        `No se puede eliminar: el recinto tiene ${militaresCount} militar(es) asignado(s)`,
      );
    }
    if (dependientesCount > 0) {
      throw new ConflictException(
        `No se puede eliminar: ${dependientesCount} recinto(s) lo tienen configurado como CDA destino`,
      );
    }

    await this.prisma.recinto.delete({ where: { id } });
    return { deleted: true };
  }

  async bulkUpload(file: Express.Multer.File): Promise<{ creados: number; actualizados: number; errores: BulkUploadRow[] }> {
    if (!file) throw new BadRequestException('Archivo requerido');
    const rows = await this.parseRows(file);
    if (rows.length === 0) throw new BadRequestException('El archivo no tiene filas');

    const cantones = await this.prisma.canton.findMany({ select: { id: true, codigo: true } });
    const cantonByCodigo = new Map(cantones.map((c) => [c.codigo.toLowerCase().trim(), c.id]));

    const recintosList = await this.prisma.recinto.findMany({ select: { id: true, codigoRecinto: true } });
    const recintoByCodigo = new Map(recintosList.map((r) => [r.codigoRecinto.toLowerCase().trim(), r.id]));

    const errores: BulkUploadRow[] = [];
    let creados = 0;
    let actualizados = 0;

    for (let i = 0; i < rows.length; i++) {
      const filaNum = i + 2;
      const raw = rows[i];
      const parsed = bulkRecintoRowSchema.safeParse(raw);
      if (!parsed.success) {
        errores.push({ fila: filaNum, error: parsed.error.issues.map((iss) => `${iss.path.join('.')}: ${iss.message}`).join('; '), datos: raw });
        continue;
      }
      const d = parsed.data;

      const cantonId = cantonByCodigo.get(d.canton_codigo.toLowerCase().trim());
      if (!cantonId) {
        errores.push({ fila: filaNum, error: `Cantón no encontrado: ${d.canton_codigo}`, datos: raw });
        continue;
      }

      let cdaDestinoId: string | null = null;
      if (d.cda_destino_codigo && d.cda_destino_codigo.trim()) {
        cdaDestinoId = recintoByCodigo.get(d.cda_destino_codigo.toLowerCase().trim()) ?? null;
        if (!cdaDestinoId) {
          errores.push({ fila: filaNum, error: `CDA destino no encontrado: ${d.cda_destino_codigo}`, datos: raw });
          continue;
        }
      }

      try {
        const existente = recintoByCodigo.get(d.codigo_recinto.toLowerCase().trim());
        if (existente) {
          await this.prisma.$executeRaw`
            UPDATE recintos SET
              nombre = ${d.nombre},
              canton_id = ${cantonId},
              parroquia = ${d.parroquia || null},
              zona = ${d.zona || null},
              tipo = ${d.tipo}::tipo_recinto,
              cda_destino_id = ${cdaDestinoId}::uuid,
              ubicacion = ST_SetSRID(ST_MakePoint(${d.longitud}, ${d.latitud}), 4326)::geography,
              tiene_internet = ${d.tiene_internet ?? false},
              cobertura_movil = ${d.cobertura_movil ?? false},
              numero_electores = ${d.numero_electores ?? null},
              juntas_femeninas = ${d.juntas_femeninas ?? null},
              juntas_masculinas = ${d.juntas_masculinas ?? null}
            WHERE codigo_recinto = ${d.codigo_recinto}
          `;
          actualizados++;
        } else {
          const id = crypto.randomUUID();
          await this.prisma.$executeRaw`
            INSERT INTO recintos (
              id, codigo_recinto, nombre, canton_id, parroquia, zona, tipo,
              cda_destino_id, ubicacion, tiene_internet, cobertura_movil,
              numero_electores, juntas_femeninas, juntas_masculinas
            ) VALUES (
              ${id}::uuid, ${d.codigo_recinto}, ${d.nombre}, ${cantonId},
              ${d.parroquia || null}, ${d.zona || null}, ${d.tipo}::tipo_recinto,
              ${cdaDestinoId}::uuid,
              ST_SetSRID(ST_MakePoint(${d.longitud}, ${d.latitud}), 4326)::geography,
              ${d.tiene_internet ?? false}, ${d.cobertura_movil ?? false},
              ${d.numero_electores ?? null}, ${d.juntas_femeninas ?? null}, ${d.juntas_masculinas ?? null}
            )
          `;
          recintoByCodigo.set(d.codigo_recinto.toLowerCase().trim(), id);
          creados++;
        }
      } catch (e: any) {
        errores.push({ fila: filaNum, error: e?.message ?? 'Error', datos: raw });
      }
    }

    return { creados, actualizados, errores };
  }

  // ---- internos ----
  private async assertCanton(cantonId: number) {
    const c = await this.prisma.canton.findUnique({ where: { id: cantonId } });
    if (!c) throw new BadRequestException('El cantón indicado no existe');
  }

  private async assertCodigoDisponible(codigoRecinto: string) {
    const dup = await this.prisma.recinto.findUnique({ where: { codigoRecinto } });
    if (dup) throw new ConflictException(`Ya existe un recinto con código ${codigoRecinto}`);
  }

  private async parseRows(file: Express.Multer.File): Promise<Array<Record<string, string>>> {
    const filename = (file.originalname ?? '').toLowerCase();
    const isExcel = filename.endsWith('.xlsx') || filename.endsWith('.xls');
    const isCsv = filename.endsWith('.csv') || file.mimetype === 'text/csv';
    if (isExcel) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(file.buffer as any);
      const ws = wb.worksheets[0];
      if (!ws) return [];
      const headers: string[] = [];
      ws.getRow(1).eachCell((cell, col) => { headers[col - 1] = String(cell.value ?? '').trim().toLowerCase(); });
      const result: Array<Record<string, string>> = [];
      ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
        if (rowNum === 1) return;
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { if (!h) return; const v = row.getCell(i + 1).value; obj[h] = v == null ? '' : String(v).trim(); });
        result.push(obj);
      });
      return result;
    }
    if (isCsv) {
      return csvParse(file.buffer.toString('utf8'), { columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()), skip_empty_lines: true, trim: true }) as Array<Record<string, string>>;
    }
    throw new BadRequestException('Formato no soportado: usa .xlsx o .csv');
  }

  private async getCoords(ids: string[]): Promise<Map<string, { lat: number; lng: number }>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<{ id: string; lat: number; lng: number }[]>`
      SELECT id, ST_Y(ubicacion::geometry) AS lat, ST_X(ubicacion::geometry) AS lng
      FROM recintos
      WHERE id = ANY(${ids}::uuid[])
    `;
    return new Map(rows.map((r) => [r.id, { lat: r.lat, lng: r.lng }]));
  }
}

function toRecintoDto(r: any, coords?: { lat: number; lng: number }): Recinto {
  return {
    id: r.id,
    codigoRecinto: r.codigoRecinto,
    nombre: r.nombre,
    direccion: r.direccion ?? null,
    cantonId: r.cantonId,
    cantonNombre: r.canton?.nombre,
    parroquia: r.parroquia ?? null,
    zona: r.zona ?? null,
    tipo: r.tipo,
    latitud: coords?.lat ?? 0,
    longitud: coords?.lng ?? 0,
    tieneInternet: r.tieneInternet,
    coberturaMovil: r.coberturaMovil,
    numeroElectores: r.numeroElectores ?? null,
    juntasFemeninas: r.juntasFemeninas ?? null,
    juntasMasculinas: r.juntasMasculinas ?? null,
    noCdasCount: r._count?.origenes,
  };
}
