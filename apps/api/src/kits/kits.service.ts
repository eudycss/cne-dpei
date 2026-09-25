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
import {
  asignarKitSchema,
  bulkKitRowSchema,
  createKitSchema,
  desasignarKitSchema,
  editKitSchema,
  pdfQrSchema,
} from '@cne/shared-validation';
import type {
  AsignarKitRequest,
  BulkUploadResult,
  BulkUploadRow,
  CreateKitRequest,
  DesasignarKitRequest,
  EditKitRequest,
  Kit,
  Paginated,
  PdfQrRequest,
} from '@cne/shared-types';
import { PrismaService } from '../db/prisma.service';
import { parseUploadRows } from '../common/parse-upload-rows';

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
    incluirPrueba?: boolean;
  }): Promise<Paginated<Kit>> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const where: any = { eventoId: opts.eventoId };
    if (!opts.incluirPrueba) where.esPrueba = false;
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
        include: { itemsContenido: { include: { item: true } } },
      }),
    ]);
    return { items: items.map(toKitDto), total, page, pageSize };
  }

  /**
   * Recintos que ya tienen un kit real (no de prueba) en este evento — usado
   * para filtrarlos del selector de recinto al crear/editar un kit, así no se
   * puede duplicar un kit para el mismo recinto.
   */
  async recintosOcupados(eventoId: string): Promise<string[]> {
    const kits = await this.prisma.kitElectoral.findMany({
      where: { eventoId, recintoId: { not: null }, esPrueba: false },
      select: { recintoId: true },
    });
    return [...new Set(kits.map((k) => k.recintoId as string))];
  }

  async create(input: CreateKitRequest): Promise<Kit> {
    const parsed = createKitSchema.parse(input);
    const evento = await this.prisma.eventoElectoral.findUnique({
      where: { id: parsed.eventoId },
    });
    if (!evento) throw new NotFoundException('Evento no encontrado');

    const recinto = await this.prisma.recinto.findUnique({ where: { id: parsed.recintoId } });
    if (!recinto) throw new NotFoundException('Recinto no encontrado');

    // Un recinto solo puede tener un kit real (no de prueba) por evento —
    // los kits de prueba no cuentan como "ocupando" el recinto.
    if (!parsed.esPrueba) {
      const ocupado = await this.prisma.kitElectoral.findFirst({
        where: { eventoId: parsed.eventoId, recintoId: parsed.recintoId, esPrueba: false },
      });
      if (ocupado) {
        throw new ConflictException('Este recinto ya tiene un kit asignado en este evento');
      }
    }

    // Set: un mismo id repetido en itemIds no debe crear dos filas para el
    // mismo (kitId, itemId) — violaría la PK compuesta de KitItemContenido.
    const itemIds = [...new Set(parsed.itemIds)];
    if (itemIds.length > 0) {
      const activos = await this.prisma.itemKitCatalog.count({
        where: { id: { in: itemIds }, activo: true },
      });
      if (activos !== itemIds.length) {
        throw new BadRequestException('Uno o más ítems del kit no existen o están inactivos');
      }
    }

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
        recintoId: parsed.recintoId,
        estado: 'ASIGNADO',
        esPrueba: parsed.esPrueba ?? false,
        itemsContenido: {
          create: itemIds.map((itemId) => ({ item: { connect: { id: itemId } } })),
        },
      },
      include: { itemsContenido: { include: { item: true } } },
    });
    return toKitDto(kit);
  }

  async asignar(id: string, input: AsignarKitRequest): Promise<Kit> {
    const parsed = asignarKitSchema.parse(input);

    const kit = await this.prisma.kitElectoral.findUnique({ where: { id } });
    if (!kit) throw new NotFoundException('Kit no encontrado');

    // El recinto ya queda fijo desde la creación (o desde una edición
    // posterior) — asignar operador no puede fijarlo por su cuenta.
    if (!kit.recintoId) {
      throw new BadRequestException(
        'El kit no tiene un recinto asignado. Edita el kit para asignarle uno antes de asignar un operador.',
      );
    }

    const evento = await this.prisma.eventoElectoral.findUnique({ where: { id: kit.eventoId } });
    if (!evento) throw new NotFoundException('Evento no encontrado');
    this.assertNoFrozen(evento, parsed.justificacion);

    const operador = await this.prisma.usuario.findFirst({
      where: {
        id: parsed.operadorId,
        roles: { some: { rol: { nombre: 'OPERADOR_CDA' } } },
      },
    });
    if (!operador) throw new BadRequestException('El usuario no tiene rol OPERADOR_CDA');

    const otrosKits = await this.prisma.kitElectoral.findMany({
      where: {
        eventoId: kit.eventoId,
        operadorId: parsed.operadorId,
        id: { not: id },
        recintoId: { not: null },
      },
      select: { recintoId: true },
    });
    if (otrosKits.some((k) => k.recintoId !== kit.recintoId)) {
      throw new ConflictException(
        'Este operador ya tiene kits asignados a otro recinto en este evento',
      );
    }

    const updated = await this.prisma.kitElectoral.update({
      where: { id },
      data: {
        operadorId: parsed.operadorId,
        estado: kit.estado === 'EN_BODEGA' ? 'ASIGNADO' : kit.estado,
      },
    });
    return toKitDto(updated);
  }

  /**
   * Edita el recinto y/o el contenido (ítems del catálogo) de un kit ya
   * creado. El recinto solo se puede cambiar, nunca quitar; si el kit no
   * tenía uno (p.ej. venido de carga masiva sin código de recinto), editar es
   * la vía para dárselo por primera vez. Si el kit ya tiene operador
   * asignado, un cambio de recinto respeta la regla de 1 operador = 1 recinto
   * por evento.
   */
  async editar(id: string, input: EditKitRequest): Promise<Kit> {
    const parsed = editKitSchema.parse(input);

    const kit = await this.prisma.kitElectoral.findUnique({
      where: { id },
      include: { itemsContenido: true },
    });
    if (!kit) throw new NotFoundException('Kit no encontrado');

    const evento = await this.prisma.eventoElectoral.findUnique({ where: { id: kit.eventoId } });
    if (!evento) throw new NotFoundException('Evento no encontrado');
    this.assertNoFrozen(evento, parsed.justificacion);

    const data: any = {};

    if (parsed.recintoId !== undefined) {
      const recinto = await this.prisma.recinto.findUnique({ where: { id: parsed.recintoId } });
      if (!recinto) throw new NotFoundException('Recinto no encontrado');

      if (!kit.esPrueba) {
        const ocupado = await this.prisma.kitElectoral.findFirst({
          where: {
            eventoId: kit.eventoId,
            recintoId: parsed.recintoId,
            esPrueba: false,
            id: { not: id },
          },
        });
        if (ocupado) {
          throw new ConflictException('Este recinto ya tiene un kit asignado en este evento');
        }
      }

      if (kit.operadorId) {
        const otrosKits = await this.prisma.kitElectoral.findMany({
          where: {
            eventoId: kit.eventoId,
            operadorId: kit.operadorId,
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
      }

      data.recintoId = parsed.recintoId;
      data.nombre = `${recinto.codigoRecinto} — ${recinto.nombre}`;
    }

    if (parsed.itemIds !== undefined) {
      const itemIds = [...new Set(parsed.itemIds)];
      if (itemIds.length > 0) {
        const activos = await this.prisma.itemKitCatalog.count({
          where: { id: { in: itemIds }, activo: true },
        });
        if (activos !== itemIds.length) {
          throw new BadRequestException('Uno o más ítems del kit no existen o están inactivos');
        }
      }
      const actuales = new Set(kit.itemsContenido.map((ic) => ic.itemId));
      const nuevos = new Set(itemIds);
      const toRemove = [...actuales].filter((itemId) => !nuevos.has(itemId));
      const toAdd = [...nuevos].filter((itemId) => !actuales.has(itemId));
      data.itemsContenido = {
        deleteMany: toRemove.length > 0 ? { itemId: { in: toRemove } } : undefined,
        create: toAdd.map((itemId) => ({ item: { connect: { id: itemId } } })),
      };
    }

    const updated = await this.prisma.kitElectoral.update({
      where: { id },
      data,
      include: { itemsContenido: { include: { item: true } } },
    });
    return toKitDto(updated);
  }

  async desasignar(id: string, input?: DesasignarKitRequest): Promise<Kit> {
    const parsed = desasignarKitSchema.parse(input ?? {});

    const kit = await this.prisma.kitElectoral.findUnique({ where: { id } });
    if (!kit) throw new NotFoundException('Kit no encontrado');

    const evento = await this.prisma.eventoElectoral.findUnique({ where: { id: kit.eventoId } });
    if (!evento) throw new NotFoundException('Evento no encontrado');
    this.assertNoFrozen(evento, parsed.justificacion);

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
      include: { recinto: true, operador: true },
    });
    if (kits.length === 0) throw new BadRequestException('No se encontraron kits con esos IDs');

    return this.buildPdf(this.mapKitsConDatos(kits));
  }

  /**
   * Adjunta recintoLabel/operadorLabel a cada kit a partir de las relaciones
   * ya incluidas por Prisma (kit.recinto / kit.operador, con onDelete: SetNull
   * — si se borra el recinto u operador, quedan en null en vez de romper la
   * referencia). Extraído como método puro para poder testear el formato de
   * las etiquetas sin generar un PDF real.
   */
  private mapKitsConDatos(kits: any[]): any[] {
    return kits.map((k) => ({
      ...k,
      recintoLabel: k.recinto ? `${k.recinto.codigoRecinto} — ${k.recinto.nombre}` : null,
      operadorLabel: k.operador ? `${k.operador.nombres} ${k.operador.apellidos}` : null,
    }));
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
    // HU12-CA6: la carga masiva no admite excepciones — una vez congelado el
    // evento, las asignaciones puntuales se hacen una por una con justificación.
    this.assertNoFrozen(evento);

    const rows = await parseUploadRows(file);
    if (rows.length === 0) throw new BadRequestException('El archivo no tiene filas');

    // Precargas: operadores (por cédula) y recintos (por código).
    const operadores = await this.prisma.usuario.findMany({
      where: { roles: { some: { rol: { nombre: 'OPERADOR_CDA' } } } },
      select: { id: true, cedula: true },
    });
    const operadorPorCedula = new Map<string, string>(
      operadores.map((o): [string, string] => [o.cedula.trim(), o.id]),
    );
    const recintos = await this.prisma.recinto.findMany({ select: { id: true, codigoRecinto: true } });
    const recintoPorCodigo = new Map<string, string>(
      recintos.map((r): [string, string] => [r.codigoRecinto.toLowerCase().trim(), r.id]),
    );
    const itemsCatalogActivos = await this.prisma.itemKitCatalog.findMany({
      where: { activo: true },
      select: { id: true, codigo: true },
    });
    const itemIdPorCodigo = new Map<string, string>(
      itemsCatalogActivos.map((it): [string, string] => [it.codigo.toLowerCase().trim(), it.id]),
    );

    // Regla 1 operador = 1 recinto por evento: arrancamos del estado actual en BD.
    const asignadosBd = await this.prisma.kitElectoral.findMany({
      where: { eventoId, operadorId: { not: null }, recintoId: { not: null } },
      select: { operadorId: true, recintoId: true },
    });
    const recintoPorOperador = new Map<string, string>();
    for (const k of asignadosBd) {
      if (k.operadorId && k.recintoId) recintoPorOperador.set(k.operadorId, k.recintoId);
    }

    // Un recinto solo puede tener un kit real (no de prueba) por evento.
    const recintosUsadosBd = await this.prisma.kitElectoral.findMany({
      where: { eventoId, recintoId: { not: null }, esPrueba: false },
      select: { recintoId: true },
    });
    const recintosUsados = new Set(recintosUsadosBd.map((k) => k.recintoId as string));

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
        if (recintosUsados.has(recintoId)) {
          errores.push({
            fila: filaNum,
            error: `Este recinto ya tiene un kit asignado en este evento: ${codigoRecinto}`,
            datos: raw,
          });
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

      const codigosItems = (d.items ?? '')
        .split(',')
        .map((c) => c.trim())
        .filter((c) => c !== '');
      const itemIds: string[] = [];
      let itemInvalido: string | null = null;
      for (const codigo of codigosItems) {
        const itemId = itemIdPorCodigo.get(codigo.toLowerCase());
        if (!itemId) {
          itemInvalido = codigo;
          break;
        }
        itemIds.push(itemId);
      }
      if (itemInvalido) {
        errores.push({
          fila: filaNum,
          error: `Ítem de kit no encontrado o inactivo: ${itemInvalido}`,
          datos: raw,
        });
        continue;
      }
      const itemIdsUnicos = [...new Set(itemIds)];

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
            itemsContenido: {
              create: itemIdsUnicos.map((itemId) => ({ item: { connect: { id: itemId } } })),
            },
          },
        });
        if (operadorId && recintoId) {
          recintoPorOperador.set(operadorId, recintoId);
          recintosUsados.add(recintoId);
        }
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
      { header: 'items', key: 'items', width: 30 },
      { header: 'cedula_operador', key: 'cedula_operador', width: 16 },
      { header: 'codigo_recinto', key: 'codigo_recinto', width: 16 },
    ];
    ws.addRow({
      nombre: 'Kit Recinto 28',
      contenidos: 'Acta, sobres, sellos',
      items: 'COMPUTADOR,MOUSE',
      cedula_operador: '1710034065',
      codigo_recinto: '28',
    });
    ws.addRow({
      nombre: 'Kit de reserva (sin asignar)',
      contenidos: '',
      items: '',
      cedula_operador: '',
      codigo_recinto: '',
    });
    ws.getRow(1).font = { bold: true };
    const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    return Buffer.from(buffer);
  }

  // ─── internos ─────────────────────────────────────────────────────────────

  /**
   * HU12-CA6: una vez iniciada la jornada electoral (evento ACTIVO y fecha de
   * jornada alcanzada), las asignaciones quedan congeladas. Se puede modificar
   * igual con una justificación explícita, que queda en bitácora.
   */
  private assertNoFrozen(
    evento: { estado: string; fechaJornada: Date },
    justificacion?: string,
  ): void {
    const hoy = new Date().toISOString().slice(0, 10);
    const jornada = evento.fechaJornada.toISOString().slice(0, 10);
    const congelado = evento.estado === 'ACTIVO' && hoy >= jornada;
    if (congelado && !justificacion?.trim()) {
      throw new BadRequestException({
        message:
          'Las asignaciones están congeladas: ya inició la jornada electoral. Proporciona una justificación para modificar esta asignación.',
        frozen: true,
      });
    }
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
    const qrSize = 31 * MM; // imagen QR en puntos

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
        .text(kit.codigoUnico, x, qrY + qrSize + 1.5 * MM, {
          width: labelW,
          align: 'center',
        });

      // Recinto y operador asignados (CA: identificar de un vistazo a quién
      // pertenece la etiqueta, sin tener que escanear el QR — ya no se repite
      // el nombre del kit, redundante con el recinto)
      const truncar = (s: string, max: number) => (s.length > max ? s.slice(0, max - 2) + '…' : s);
      const recintoTexto = truncar(kit.recintoLabel ?? 'Sin recinto asignado', 42);
      doc
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor('#1f2937')
        .text(recintoTexto, x, qrY + qrSize + 6 * MM, { width: labelW, align: 'center' });

      const operadorTexto = truncar(kit.operadorLabel ?? 'Sin operador asignado', 42);
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor('#6b7280')
        .text(operadorTexto, x, qrY + qrSize + 9.5 * MM, { width: labelW, align: 'center' });

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
    items: (k.itemsContenido ?? []).map((ic: any) => ic.item.etiqueta),
    itemIds: (k.itemsContenido ?? []).map((ic: any) => ic.itemId),
    recintoId: k.recintoId ?? null,
    operadorId: k.operadorId ?? null,
    estado: k.estado,
    esPrueba: k.esPrueba ?? false,
    creadoEn: k.creadoEn?.toISOString?.() ?? String(k.creadoEn),
  };
}
