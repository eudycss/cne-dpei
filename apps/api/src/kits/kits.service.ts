import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import * as QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { createKitSchema, pdfQrSchema } from '@cne/shared-validation';
import type { CreateKitRequest, Kit, Paginated, PdfQrRequest } from '@cne/shared-types';
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

  // ─── internos ─────────────────────────────────────────────────────────────

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
