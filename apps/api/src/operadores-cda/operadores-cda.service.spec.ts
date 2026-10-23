import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as ExcelJS from 'exceljs';

import { OperadoresCdaService } from './operadores-cda.service';
import { PrismaService } from '../db/prisma.service';

const ENCABEZADOS = ['N°', 'Apellidos Nombres', 'Cédula', 'Teléfonos De Contacto', 'Cargo', 'Unidad', 'Inicial'];
const FILA_OK = [1, 'PÉREZ LÓPEZ ANA MARÍA', '1710034065', '0987923273', 'OPERADOR CDA', 'UPSI', '20 de octubre de 2026'];

async function excel(filas: unknown[][], nombre = 'operadores.xlsx'): Promise<Express.Multer.File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Hoja1');
  ws.getCell('B1').value = 'DELEGACIÓN PROVINCIAL ELECTORAL DE IMBABURA';
  ws.getRow(9).values = ENCABEZADOS;
  filas.forEach((f, i) => (ws.getRow(10 + i).values = f as ExcelJS.CellValue[]));
  const buffer = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  return { originalname: nombre, buffer } as Express.Multer.File;
}

describe('OperadoresCdaService', () => {
  let service: OperadoresCdaService;

  const prisma = {
    operadorCda: {
      findMany: jest.fn(),
      upsert: jest.fn((args: unknown) => args),
    },
    $transaction: jest.fn((ops: unknown[]) => Promise.resolve(ops)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.operadorCda.findMany.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [OperadoresCdaService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(OperadoresCdaService);
  });

  describe('importar (vista previa)', () => {
    it('marca NUEVO o ACTUALIZAR según la cédula y no guarda nada', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([{ cedula: '1710034065' }]);
      const file = await excel([FILA_OK, [2, 'RUIZ MORA JUAN', '1002003000', '0987111222', 'OPERADOR CDA']]);

      const r = await service.importar(file, { aplicar: false });

      expect(r).toMatchObject({ vistaPrevia: true, nuevos: 1, actualizados: 1, errores: [] });
      expect(r.filas.map((f) => [f.fila, f.cedula, f.accion])).toEqual([
        [10, '1710034065', 'ACTUALIZAR'],
        [11, '1002003000', 'NUEVO'],
      ]);
      expect(r.filas[0].fechaInicio).toBe('2026-10-20');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('reporta filas inválidas y cédulas repetidas con su número de fila', async () => {
      const file = await excel([
        FILA_OK,
        [2, 'RUIZ MORA JUAN', '1710034066', '0987111222', 'OPERADOR CDA'],
        [3, 'VEGA TAPIA LUIS', '1710034065', '0987111333', 'OPERADOR CDA'],
      ]);

      const r = await service.importar(file, { aplicar: false });

      expect(r.filas).toHaveLength(1);
      expect(r.errores.map((e) => e.fila)).toEqual([11, 12]);
      expect(r.errores[0].error).toContain('Cédula ecuatoriana inválida');
      expect(r.errores[1].error).toContain('ya está en la fila 10');
    });
  });

  describe('importar (aplicar)', () => {
    it('guarda con upsert por cédula en una sola transacción', async () => {
      const file = await excel([FILA_OK]);

      await service.importar(file, { aplicar: true });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.operadorCda.upsert).toHaveBeenCalledWith({
        where: { cedula: '1710034065' },
        create: expect.objectContaining({
          cedula: '1710034065',
          apellidosNombres: 'PÉREZ LÓPEZ ANA MARÍA',
          fechaInicio: new Date('2026-10-20T00:00:00Z'),
        }),
        update: expect.not.objectContaining({ cedula: expect.anything() }),
      });
    });

    it('reimportar no reactiva a nadie ni borra datos que vienen vacíos en el Excel', async () => {
      const file = await excel([[1, 'PÉREZ LÓPEZ ANA MARÍA', '1710034065', '', 'OPERADOR CDA']]);

      await service.importar(file, { aplicar: true });

      const { update } = prisma.operadorCda.upsert.mock.calls[0][0] as { update: Record<string, unknown> };
      expect(update).not.toHaveProperty('activo');
      expect(update.telefono).toBeUndefined();
      expect(update.unidad).toBeUndefined();
      expect(update.fechaInicio).toBeUndefined();
    });

    it('no guarda nada si hay errores', async () => {
      const file = await excel([FILA_OK, [2, 'SIN CEDULA', '', '', 'OPERADOR CDA']]);
      await expect(service.importar(file, { aplicar: true })).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('importar (límites)', () => {
    it('rechaza una hoja con demasiadas filas antes de recorrerla', async () => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Hoja1');
      ws.getRow(9).values = ENCABEZADOS;
      ws.getCell('A2500').value = 'x';
      const file = { originalname: 'x.xlsx', buffer: Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer) } as Express.Multer.File;
      await expect(service.importar(file, { aplicar: false })).rejects.toThrow('demasiadas filas');
    });

    it('rechaza más de 500 operadores', async () => {
      const filas = Array.from({ length: 501 }, (_, i) => [i + 1, `PERSONA ${i}`, '1710034065', '', 'OPERADOR CDA']);
      await expect(service.importar(await excel(filas), { aplicar: false })).rejects.toThrow('Demasiados operadores');
    });

    it('rechaza un ZIP que dice descomprimirse en más de 30 MB (zip bomb)', async () => {
      const file = await excel([FILA_OK]);
      // Infla el tamaño descomprimido declarado en el directorio central.
      const firma = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
      const pos = file.buffer.indexOf(firma);
      file.buffer.writeUInt32LE(40 * 1024 * 1024, pos + 24);
      await expect(service.importar(file, { aplicar: false })).rejects.toThrow('demasiado grande o está dañado');
    });

    it('marca como error una fecha que no existe (31 de febrero) en vez de fallar al guardar', async () => {
      const file = await excel([[1, 'PÉREZ LÓPEZ ANA MARÍA', '1710034065', '0987923273', 'OPERADOR CDA', 'UPSI', '31 de febrero de 2026']]);
      const r = await service.importar(file, { aplicar: false });
      expect(r.errores[0].error).toContain('Fecha inexistente');
      await expect(service.importar(file, { aplicar: true })).rejects.toThrow(BadRequestException);
    });

    it('devuelve como máximo 100 errores, con textos acotados, y avisa cuántos más hay', async () => {
      const largo = 'X'.repeat(500);
      const filas = Array.from({ length: 120 }, (_, i) => [i + 1, largo, '123', '', 'OPERADOR CDA']);
      const r = await service.importar(await excel(filas), { aplicar: false });
      expect(r.errores).toHaveLength(101);
      expect(r.errores[100].error).toBe('… y 20 fila(s) más con errores');
      expect(String(r.errores[0].datos?.apellidosNombres)).toHaveLength(200);
    });
  });

  describe('importar (archivo)', () => {
    it('rechaza archivos que no son .xlsx aunque traigan otra extensión', async () => {
      const csv = { originalname: 'operadores.xlsx', buffer: Buffer.from('cedula,nombres\n') } as Express.Multer.File;
      await expect(service.importar(csv, { aplicar: false })).rejects.toThrow('Formato no soportado');
      const conOtroNombre = await excel([FILA_OK], 'operadores.csv');
      await expect(service.importar(conOtroNombre, { aplicar: false })).rejects.toThrow('Formato no soportado');
    });

    it('rechaza si falta el archivo o no tiene el encabezado de operadores', async () => {
      await expect(service.importar(undefined, { aplicar: false })).rejects.toThrow('Archivo requerido');

      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('Militares').getRow(1).values = ['cedula', 'nombres', 'codigo_recinto'];
      const file = {
        originalname: 'x.xlsx',
        buffer: Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer),
      } as Express.Multer.File;
      await expect(service.importar(file, { aplicar: false })).rejects.toThrow('No se encontró la fila de encabezados');
    });
  });

  describe('list', () => {
    it('devuelve solo activos, busca por nombre o cédula y expone si tiene foto', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([
        {
          id: 'o1',
          numero: 1,
          apellidosNombres: 'PÉREZ LÓPEZ ANA MARÍA',
          cedula: '1710034065',
          telefono: '0987923273',
          cargo: 'OPERADOR CDA',
          unidad: null,
          fechaInicio: new Date('2026-10-20T00:00:00Z'),
          fotoKey: 'clave-cifrada',
          activo: true,
          creadoEn: new Date('2026-10-22T10:00:00Z'),
        },
      ]);

      const r = await service.list({ search: ' pérez ' });

      expect(prisma.operadorCda.findMany.mock.calls[0][0].where).toEqual({
        activo: true,
        OR: [
          { apellidosNombres: { contains: 'pérez', mode: 'insensitive' } },
          { cedula: { contains: 'pérez' } },
        ],
      });
      expect(r[0]).toMatchObject({ fechaInicio: '2026-10-20', tieneFoto: true });
      expect(r[0]).not.toHaveProperty('fotoKey');
    });
  });
});
