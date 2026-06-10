import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import * as crypto from 'node:crypto';
import * as ExcelJS from 'exceljs';
import { parse as csvParse } from 'csv-parse/sync';
import {
  bulkUserRowSchema,
  createUserSchema,
  updateUserSchema,
} from '@cne/shared-validation';
import type {
  BulkUploadResult,
  BulkUploadRow,
  CreateUserRequest,
  Paginated,
  UpdateUserRequest,
  User,
} from '@cne/shared-types';

import { PrismaService } from '../db/prisma.service';
import { INotifier, NOTIFIER } from '../auth/notifier';

@Injectable()
export class UsersService {
  private readonly log = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFIER) private readonly notifier: INotifier,
  ) {}

  async list(opts: {
    page?: number;
    pageSize?: number;
    search?: string;
    role?: string;
  }): Promise<Paginated<User>> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const where: any = opts.search
      ? {
          OR: [
            { email: { contains: opts.search, mode: 'insensitive' as const } },
            { cedula: { contains: opts.search } },
            { nombres: { contains: opts.search, mode: 'insensitive' as const } },
            { apellidos: { contains: opts.search, mode: 'insensitive' as const } },
          ],
        }
      : {};
    if (opts.role) {
      where.roles = { some: { rol: { nombre: opts.role } } };
    }
    const [total, items] = await this.prisma.$transaction([
      this.prisma.usuario.count({ where }),
      this.prisma.usuario.findMany({
        where,
        include: { roles: { include: { rol: true } } },
        orderBy: { creadoEn: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: items.map(toUserDto),
      total,
      page,
      pageSize,
    };
  }

  async create(input: CreateUserRequest): Promise<User & { initialPassword: string }> {
    const parsed = createUserSchema.parse(input);
    await this.assertUniqueEmailCedula(parsed.email, parsed.cedula);

    const initialPassword = generateInitialPassword();
    const passwordHash = await argon2.hash(initialPassword);

    const user = await this.prisma.usuario.create({
      data: {
        cedula: parsed.cedula,
        email: parsed.email,
        nombres: parsed.nombres,
        apellidos: parsed.apellidos,
        telefono: parsed.telefono ?? null,
        passwordHash,
        debeCambiarPwd: true,
      },
      include: { roles: { include: { rol: true } } },
    });
    await this.notifier.sendInitialPassword(user.email, initialPassword).catch((e) =>
      this.log.error(`No se pudo enviar correo a ${user.email}: ${e?.message}`),
    );
    return { ...toUserDto(user), initialPassword };
  }

  async update(id: string, input: UpdateUserRequest): Promise<User> {
    const parsed = updateUserSchema.parse(input);
    const existing = await this.prisma.usuario.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Usuario no encontrado');
    if (parsed.email && parsed.email !== existing.email) {
      await this.assertUniqueEmailCedula(parsed.email);
    }
    const user = await this.prisma.usuario.update({
      where: { id },
      data: {
        email: parsed.email ?? existing.email,
        nombres: parsed.nombres ?? existing.nombres,
        apellidos: parsed.apellidos ?? existing.apellidos,
        telefono: parsed.telefono ?? existing.telefono,
        activo: parsed.activo ?? existing.activo,
      },
      include: { roles: { include: { rol: true } } },
    });
    return toUserDto(user);
  }

  /**
   * Restablece la contraseña de un usuario (acción de administrador).
   * Genera una contraseña temporal fuerte, fuerza el cambio en el próximo
   * login (debeCambiarPwd) y revoca las sesiones activas. Devuelve la
   * contraseña temporal para que el administrador la entregue al usuario.
   */
  async resetPassword(id: string): Promise<{ user: User; temporaryPassword: string }> {
    const existing = await this.prisma.usuario.findUnique({
      where: { id },
      include: { roles: { include: { rol: true } } },
    });
    if (!existing) throw new NotFoundException('Usuario no encontrado');

    // Contraseña por defecto fija (configurable por entorno).
    const temporaryPassword = process.env.DEFAULT_RESET_PASSWORD ?? 'CneImbabura2026*';
    const passwordHash = await argon2.hash(temporaryPassword);

    await this.prisma.$transaction([
      this.prisma.usuario.update({
        where: { id },
        data: { passwordHash, debeCambiarPwd: true },
      }),
      // Revoca refresh tokens activos: las sesiones existentes quedan invalidadas
      this.prisma.refreshToken.updateMany({
        where: { usuarioId: id, revocadoEn: null },
        data: { revocadoEn: new Date() },
      }),
    ]);

    await this.notifier.sendInitialPassword(existing.email, temporaryPassword).catch((e) =>
      this.log.error(`No se pudo enviar correo a ${existing.email}: ${e?.message}`),
    );
    return { user: toUserDto(existing), temporaryPassword };
  }

  async bulkUpload(file: Express.Multer.File): Promise<BulkUploadResult> {
    if (!file) throw new BadRequestException('Archivo requerido');
    const rows = await this.parseRows(file);
    if (rows.length === 0) throw new BadRequestException('El archivo no tiene filas');

    const errores: BulkUploadRow[] = [];
    let creados = 0;

    for (let i = 0; i < rows.length; i++) {
      const filaNum = i + 2; // +1 por header, +1 por base-1
      const raw = rows[i];
      const parsed = bulkUserRowSchema.safeParse(raw);
      if (!parsed.success) {
        errores.push({
          fila: filaNum,
          error: parsed.error.issues.map((iss) => `${iss.path.join('.')}: ${iss.message}`).join('; '),
          datos: raw,
        });
        continue;
      }
      try {
        await this.assertUniqueEmailCedula(parsed.data.email, parsed.data.cedula);
        const initialPassword = generateInitialPassword();
        const hash = await argon2.hash(initialPassword);
        await this.prisma.usuario.create({
          data: {
            cedula: parsed.data.cedula,
            email: parsed.data.email,
            nombres: parsed.data.nombres,
            apellidos: parsed.data.apellidos,
            telefono: parsed.data.telefono ?? null,
            passwordHash: hash,
            debeCambiarPwd: true,
          },
        });
        await this.notifier.sendInitialPassword(parsed.data.email, initialPassword);
        creados++;
      } catch (e: any) {
        errores.push({ fila: filaNum, error: e?.message ?? 'Error desconocido', datos: raw });
      }
    }
    return { creados, errores };
  }

  async generateTemplate(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Usuarios');
    ws.columns = [
      { header: 'cedula', key: 'cedula', width: 14 },
      { header: 'email', key: 'email', width: 30 },
      { header: 'nombres', key: 'nombres', width: 24 },
      { header: 'apellidos', key: 'apellidos', width: 24 },
      { header: 'telefono', key: 'telefono', width: 16 },
    ];
    ws.addRow({
      cedula: '0102030405',
      email: 'ejemplo@cne-imbabura.gob.ec',
      nombres: 'María',
      apellidos: 'Pérez',
      telefono: '+593987654321',
    });
    ws.getRow(1).font = { bold: true };
    const buffer = (await wb.xlsx.writeBuffer()) as ArrayBuffer;
    return Buffer.from(buffer);
  }

  async assignRoles(userIds: string[], roleIds: string[]) {
    // Reemplazo: borramos roles previos y volvemos a asignar el set indicado
    const validRoles = await this.prisma.rol.findMany({ where: { id: { in: roleIds } } });
    if (validRoles.length !== roleIds.length) {
      throw new BadRequestException('Algún rol no existe');
    }
    const validUsers = await this.prisma.usuario.findMany({ where: { id: { in: userIds } } });
    if (validUsers.length !== userIds.length) {
      throw new BadRequestException('Algún usuario no existe');
    }
    await this.prisma.$transaction([
      this.prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: userIds } } }),
      this.prisma.usuarioRol.createMany({
        data: userIds.flatMap((u) => roleIds.map((r) => ({ usuarioId: u, rolId: r }))),
        skipDuplicates: true,
      }),
    ]);
    return { actualizados: userIds.length };
  }

  // ---- internos ----------------------------------------------------------

  private async assertUniqueEmailCedula(email: string, cedula?: string) {
    const existsEmail = await this.prisma.usuario.findUnique({ where: { email } });
    if (existsEmail) throw new ConflictException(`Email ya registrado: ${email}`);
    if (cedula) {
      const existsCed = await this.prisma.usuario.findUnique({ where: { cedula } });
      if (existsCed) throw new ConflictException(`Cédula ya registrada: ${cedula}`);
    }
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
      const records = csvParse(file.buffer.toString('utf8'), {
        columns: (h: string[]) => h.map((c) => c.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
      }) as Array<Record<string, string>>;
      return records;
    }
    throw new BadRequestException('Formato no soportado: usa .xlsx o .csv');
  }
}

function toUserDto(u: any): User {
  return {
    id: u.id,
    cedula: u.cedula,
    email: u.email,
    nombres: u.nombres,
    apellidos: u.apellidos,
    telefono: u.telefono ?? null,
    activo: u.activo,
    debeCambiarPwd: u.debeCambiarPwd,
    roles: (u.roles ?? []).map((r: any) => r.rol.nombre),
    creadoEn: u.creadoEn?.toISOString?.() ?? String(u.creadoEn),
    actualizadoEn: u.actualizadoEn?.toISOString?.() ?? String(u.actualizadoEn),
  };
}

function generateInitialPassword(): string {
  // 12 caracteres con A-z, dígito y símbolo (cumple política HU1-CA3)
  const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*';
  const all = upper + lower + digits + symbols;
  const pick = (set: string) => set[crypto.randomInt(0, set.length)];
  const base = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (base.length < 12) base.push(pick(all));
  // Mezcla determinista usando crypto
  for (let i = base.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [base[i], base[j]] = [base[j], base[i]];
  }
  return base.join('');
}
