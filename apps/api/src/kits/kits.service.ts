import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import * as ExcelJS from 'exceljs';
import { parse as csvParse } from 'csv-parse/sync';
import { asignarKitSchema, bulkKitRowSchema, createKitSchema, pdfQrSchema } from '@cne/shared-validation';
import type {
  AsignarKitRequest,
  BulkUploadResult,
  BulkUploadRow,
  CreateKitRequest,
  Kit,
  Paginated,
  PdfQrRequest,
} from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';

// Puntos por mm en PDFKit (72 dpi: 1 pt = 1/72 in, 1 in = 25.4 mm)
const MM = 72 / 25.4;

@Injectable()
export class KitsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(opts: {
    eventoId: string;
    page?: number;
    pageSize?: number;
    search?: string;
  }): Promise<Paginated<Kit>> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const where: any = { eventoId: opts.eventoId };
    if (opts.search) {
      where.OR = [
        { nombre: { contains: opts.search, mode: 'insensitive' } },
        { codigoUnico: { contains: opts.search, mode: 'insensitive' } },
      ];
    }
    const [total, items] = await this.prisma.$transaction([
      this.prisma.kitElectoral.count({ where }),
      this.prisma.kitElectoral.findMany({
        where,
        orderBy: { creadoEn: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: items.map(toKitDto), total, page, pageSize };
  }

  async create(input: CreateKitRequest): Promise<Kit> {
    const parsed = createKitSchema.parse(input);
    const evento = await this.prisma.eventoElectoral.findUnique({
      where: { id: parsed.eventoId },
    });
    if (!evento) throw new NotFoundException('Evento no encontrado');

    // CA1 + CA5: generar codigoUnico único por evento (reintento ante colisión)
    const codigoUnico = await this.generarCodigoUnico(parsed.eventoId);
    // CA2: el QR codifica el codigoUnico, verificable contra la BD
    const qrPayload = codigoUnico;

    const kit = await this.prisma.kitElectoral.create({
      data: {
        eventoId: parsed.eventoId,
        codigoUnico,
        qrPayload,
        nombre: parsed.nombre,
        contenidos: parsed.contenidos ?? null,
        estado: 'EN_BODEGA',
      },
    });
    return toKitDto(kit);
  }

  async asignar(id: string, input: AsignarKitRequest): Promise<Kit> {
    const parsed = asignarKitSchema.parse(input);

    const kit = await this.prisma.kitElectoral.findUnique({ where: { id } });
    if (!kit) throw new NotFoundException('Kit no encontrado');

    const operador = await this.prisma.usuario.findFirst({
      where: {
        id: parsed.operadorId,
        roles: { some: { rol: { nombre: 'OPERADOR_CDA' } } },
      },
    });
    if (!operador) throw new BadRequestException('El usuario no tiene rol OPERADOR_CDA');

    const recinto = await this.prisma.recinto.findUnique({ where: { id: parsed.recintoId } });
    if (!recinto) throw new NotFoundException('Recinto no encontrado');

    const otrosKits = await this.prisma.kitElectoral.findMany({
      where: {
        eventoId: kit.eventoId,
        operadorId: parsed.operadorId,
        id: { not: id },
        recintoId: { not: null },
      },
      select: { recintoId: true },
    });
    if (otrosKits.some((k) => k.recintoId !== parsed.recintoId)) {
      throw new ConflictException(
        'Este operador ya tiene kits asignados a otro recinto en este evento',
      );
    }

    const updated = await this.prisma.kitElectoral.update({
      where: { id },
      data: {
        operadorId: parsed.operadorId,
        recintoId: parsed.recintoId,
        estado: kit.estado === 'EN_BODEGA' ? 'ASIGNADO' : kit.estado,
      },
    });
    return toKitDto(updated);
  }

  async desasignar(id: string): Promise<Kit> {
    const kit = await this.prisma.kitElectoral.findUnique({ where: { id } });
    if (!kit) throw new NotFoundException('Kit no encontrado');

    const updated = await this.prisma.kitElectoral.update({
      where: { id },
      data: {
        operadorId: null,
        recintoId: null,
        estado: kit.estado === 'ASIGNADO' ? 'EN_BODEGA' : kit.estado,
      },
    });
    return toKitDto(updated);
  }

  // CA3 + CA4: generar PDF con etiquetas QR
  async generatePdfQr(input: PdfQrRequest): Promise<Buffer> {
    const parsed = pdfQrSchema.parse(input);
    const kits = await this.prisma.kitElectoral.findMany({
      where: { id: { in: parsed.kitIds } },
      orderBy: { codigoUnico: 'asc' },
    });
    if (kits.length === 0) throw new BadRequestException('No se encontraron kits con esos IDs');

    return this.buildPdf(kits);
  }

  /**
   * Carga masiva de kits para un evento. Cada fila crea un kit con código único
   * autogenerado; si trae cédula del operador + código del recinto, además lo
   * asigna (estado ASIGNADO), respetando la regla de un solo recinto por
   * operador. Si no trae asignación, el kit queda EN_BODEGA.
   */
  async bulkUpload(file: Express.Multer.File, eventoId: string): Promise<BulkUploadResult> {
    if (!file) throw new BadRequestException('Archivo requerido');
    const evento = await this.prisma.eventoElectoral.findUnique({ where: { id: eventoId } });
    if (!evento) throw new NotFoundException('Evento no encontrado');

    const rows = await this.parseRows(file);
    if (rows.length === 0) throw new BadRequestException('El archivo no tiene filas');

    // Precargas: operadores (por cédula) y recintos (por código).
    const operadores = await this.prisma.usuario.findMany({
      where: { roles: { some: { rol: { nombre: 'OPERADOR_CDA' } } } },
      select: { id: true, cedula: true },
    });
    const operadorPorCedula = new Map(operadores.map((o) => [o.cedula.trim(), o.id]));
    const recintos = await this.prisma.recinto.findMany({ select: { id: true, codigoRecinto: true } });
    const recintoPorCodigo = new Map(recintos.map((r) => [r.codigoRecinto.toLowerCase().trim(), r.id]));

    // Regla 1 operador = 1 recinto por evento: arrancamos del estado actual en BD.
    const asignadosBd = await this.prisma.kitElectoral.findMany({
      where: { eventoId, operadorId: { not: null }, recintoId: { not: null } },
      select: { operadorId: true, recintoId: true },
    });
    const recintoPorOperador = new Map<string, string>();
    for (const k of asignadosBd) {
      if (k.operadorId && k.recintoId) recintoPorOperador.set(k.operadorId, k.recintoId);
    }

    const errores: BulkUploadRow[] = [];
    let creados = 0;

    for (let i = 0; i < rows.length; i++) {
      const filaNum = i + 2; // +1 header, +1 base-1
      const raw = rows[i];
      const parsed = bulkKitRowSchema.safeParse(raw);
      if (!parsed.success) {
        errores.push({
          fila: filaNum,
          error: parsed.error.issues.map((iss) => `${iss.path.join('.')}: ${iss.message}`).join('; '),
          datos: raw,
        });
        continue;
      }
      const d = parsed.data;
      const cedula = (d.cedula_operador ?? '').trim();
      const codigoRecinto = (d.codigo_recinto ?? '').trim();

      let operadorId: string | null = null;
      let recintoId: string | null = null;
      if (cedula !== '') {
        operadorId = operadorPorCedula.get(cedula) ?? null;
        if (!operadorId) {
          errores.push({ fila: filaNum, error: `Operador no encontrado o sin rol OPERADOR_CDA: ${cedula}`, datos: raw });
          continue;
        }
        recintoId = recintoPorCodigo.get(codigoRecinto.toLowerCase()) ?? null;
        if (!recintoId) {
          errores.push({ fila: filaNum, error: `Recinto no encontrado: ${codigoRecinto}`, datos: raw });
          continue;
        }
        const yaAsignado = recintoPorOperador.get(operadorId);
        if (yaAsignado && yaAsignado !== recintoId) {
          errores.push({
            fila: filaNum,
            error: `El operador ${cedula} ya tiene kits asignados a otro recinto en este evento`,
            datos: raw,
          });
          continue;
        }
      }

      try {
        const codigoUnico = await this.generarCodigoUnico(eventoId);
        await this.prisma.kitElectoral.create({
          data: {
            eventoId,
            codigoUnico,
            qrPayload: codigoUnico,
            nombre: d.nombre,
            contenidos: d.contenidos?.trim() ? d.contenidos.trim() : null,
            operadorId,
            recintoId,
            estado: operadorId ? 'ASIGNADO' : 'EN_BODEGA',
          },
        });
        if (operadorId && recintoId) recintoPorOperador.set(operadorId, recintoId);
        creados++;
      } catch (e: any) {
        errores.push({ fila: filaNum, error: e?.message ?? 'Error desconocido', datos: raw });
      }
    }

    return { creados, errores };
  }

  async generateTemplate(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Kits');
    ws.columns = [
      { header: 'nombre', key: 'nombre', width: 28 },
      { header: 'contenidos', key: 'contenidos', width: 40 },
      { header: 'cedula_operador', key: 'cedula_operador', width: 16 },
      { header: 'codigo_recinto', key: 'codigo_recinto', width: 16 },
    ];
    ws.addRow({
      nombre: 'Kit Recinto 28',
      contenidos: 'Acta, sobres, sellos',
      cedula_operador: '1002003004',
      codigo_recinto: '28',
    });
    ws.addRow({ nombre: 'Kit de reserva (sin asignar)', contenidos: '', cedula_operador: '', codigo_recinto: '' });
    ws.getRow(1).font = { bold: true };
    const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    return Buffer.from(buffer);
  }

  // ─── internos ─────────────────────────────────────────────────────────────

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

  private async generarCodigoUnico(eventoId: string, intentos = 0): Promise<string> {
    if (intentos > 9) throw new BadRequestException('No se pudo generar un código único tras varios intentos');
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin I/O/0/1 para evitar ambigüedad
    const code = Array.from({ length: 8 }, () => chars[crypto.randomInt(0, chars.length)]).join('');
    const exists = await this.prisma.kitElectoral.findUnique({
      where: { eventoId_codigoUnico: { eventoId, codigoUnico: code } },
    });
    return exists ? this.generarCodigoUnico(eventoId, intentos + 1) : code;
  }

  private async buildPdf(kits: any[]): Promise<Buffer> {
    // Layout A4 (595×842 pt) — 2 col × 5 filas = 10 etiquetas/página
    // Etiqueta: 85mm ancho × 52mm alto
    const labelW = 85 * MM;
    const labelH = 52 * MM;
    const cols = 2;
    const rows = 5;
    const marginX = (595 - cols * labelW) / 2;
    const marginY = (842 - rows * labelH) / 2;
    const qrSize = 34 * MM; // imagen QR en puntos

    const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    let idx = 0;
    for (const kit of kits) {
      const posInPage = idx % (cols * rows);
      if (posInPage === 0 && idx > 0) doc.addPage();

      const col = posInPage % cols;
      const row = Math.floor(posInPage / cols);
      const x = marginX + col * labelW;
      const y = marginY + row * labelH;

      // Marco de la etiqueta
      doc.rect(x, y, labelW, labelH).stroke('#d1d5db');

      // QR como PNG buffer → incrustado en PDF
      const qrPng = await QRCode.toBuffer(kit.qrPayload, {
        type: 'png',
        width: 200,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
      const qrX = x + (labelW - qrSize) / 2;
      const qrY = y + 4 * MM;
      doc.image(qrPng, qrX, qrY, { width: qrSize, height: qrSize });

      // Código alfanumérico debajo del QR (CA4)
      doc
        .font('Courier-Bold')
        .fontSize(9)
        .fillColor('#1f2937')
        .text(kit.codigoUnico, x, qrY + qrSize + 2 * MM, {
          width: labelW,
          align: 'center',
        });

      // Nombre del kit (truncado si es muy largo)
      const nombre = kit.nombre.length > 32 ? kit.nombre.slice(0, 30) + '…' : kit.nombre;
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor('#6b7280')
        .text(nombre, x, qrY + qrSize + 6.5 * MM, { width: labelW, align: 'center' });

      idx++;
    }

    return new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });
  }
}

function toKitDto(k: any): Kit {
  return {
    id: k.id,
    eventoId: k.eventoId,
    codigoUnico: k.codigoUnico,
    qrPayload: k.qrPayload,
    nombre: k.nombre,
    contenidos: k.contenidos ?? null,
    recintoId: k.recintoId ?? null,
    operadorId: k.operadorId ?? null,
    estado: k.estado,
    creadoEn: k.creadoEn?.toISOString?.() ?? String(k.creadoEn),
  };
}
