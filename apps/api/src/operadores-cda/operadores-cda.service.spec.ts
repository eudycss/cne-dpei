import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as ExcelJS from 'exceljs';

import { OperadoresCdaService } from './operadores-cda.service';
import { PrismaService } from '../db/prisma.service';
import { CuentasCdaService } from './cuentas-cda.service';
import { registrarCargos, TEXTOS_GRUPO } from './grupo-cda';

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
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn((args: unknown) => args),
    },
    $transaction: jest.fn((ops: unknown) =>
      typeof ops === 'function' ? (ops as (tx: unknown) => unknown)(prisma) : Promise.resolve(ops),
    ),
  };

  const cuentas = {
    tieneCuenta: jest.fn((g: string) => g === 'OPERADOR' || g === 'ASISTENTE'),
    asegurarCuenta: jest.fn().mockResolvedValue('YA_TENIA'),
    retirarCuenta: jest.fn().mockResolvedValue(undefined),
    sincronizar: jest.fn().mockResolvedValue({ vinculadas: 0, creadas: 1, fallidas: 0 }),
    hashInicial: jest.fn().mockResolvedValue('hash-inicial'),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.operadorCda.findMany.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        OperadoresCdaService,
        { provide: PrismaService, useValue: prisma },
        { provide: CuentasCdaService, useValue: cuentas },
      ],
    }).compile();
    service = moduleRef.get(OperadoresCdaService);
  });

  describe('cargo desactivado', () => {
    const base = Object.entries(TEXTOS_GRUPO).map(([clave, t]) => ({
      clave,
      nombre: t.titulo,
      centro: (t.cargo.endsWith(' CDA') ? 'CDA' : 'CPE') as 'CDA' | 'CPE',
      activo: true,
    }));
    beforeEach(() => registrarCargos(base.map((c) => (c.clave === 'SUPERVISOR' ? { ...c, activo: false } : c))));
    afterEach(() => registrarCargos(base));

    it('no se agrega personal a un cargo desactivado', async () => {
      await expect(
        service.crear({
          apellidosNombres: 'RUIZ MORA JUAN',
          cedula: '1710034065',
          cargo: 'X',
          fechaInicio: '2026-10-20',
          grupo: 'SUPERVISOR',
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.operadorCda.create).not.toHaveBeenCalled();
    });

    it('ni se importa el Excel en él (ni siquiera la vista previa)', async () => {
      await expect(service.importar(await excel([FILA_OK]), { aplicar: true, grupo: 'SUPERVISOR' })).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.importar(await excel([FILA_OK]), { aplicar: false, grupo: 'SUPERVISOR' })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.operadorCda.upsert).not.toHaveBeenCalled();
    });
  });

  describe('importar (vista previa)', () => {
    it('marca NUEVO o ACTUALIZAR según la cédula y no guarda nada', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([{ cedula: '1710034065', grupo: 'OPERADOR' }]);
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

    it('una cédula que ya está en el otro grupo es un error de esa fila (una persona, un solo grupo)', async () => {
      prisma.operadorCda.findMany.mockResolvedValue([{ cedula: '1710034065', grupo: 'OPERADOR' }]);
      const file = await excel([FILA_OK, [2, 'RUIZ MORA JUAN', '1002003000', '0987111222', 'ASISTENTE CDA']]);

      const r = await service.importar(file, { aplicar: false, grupo: 'ASISTENTE' });

      expect(r).toMatchObject({ nuevos: 1, actualizados: 0 });
      expect(r.filas.map((f) => f.cedula)).toEqual(['1002003000']);
      expect(r.errores).toEqual([{ fila: 10, error: 'La cédula ya está registrada en Operadores CDA' }]);
      await expect(service.importar(file, { aplicar: true, grupo: 'ASISTENTE' })).rejects.toThrow(BadRequestException);
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
          grupo: 'OPERADOR',
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
        grupo: 'OPERADOR',
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

  describe('buscar (en todos los cargos)', () => {
    it('busca en los 9 cargos por nombre o cédula, solo activos, con lo mínimo para ubicar a la persona', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([
        { id: 'o1', apellidosNombres: 'PÉREZ ANA', cedula: '1005201015', grupo: 'DIGITADOR', activo: true },
      ]);

      const r = await service.buscar({ q: '1005201015' });

      const args = prisma.operadorCda.findMany.mock.calls[0][0];
      expect(args.where).toEqual({
        activo: true,
        OR: [
          { apellidosNombres: { contains: '1005201015', mode: 'insensitive' } },
          { cedula: { contains: '1005201015' } },
        ],
      });
      expect(args.where).not.toHaveProperty('grupo');
      expect(args.select).toEqual({ id: true, apellidosNombres: true, cedula: true, grupo: true, activo: true });
      expect(args.take).toBe(20);
      expect(r).toEqual([{ id: 'o1', apellidosNombres: 'PÉREZ ANA', cedula: '1005201015', grupo: 'DIGITADOR', activo: true }]);
    });

    it('con incluirInactivos también trae a los ocultos', async () => {
      await service.buscar({ q: 'pérez', incluirInactivos: true });
      expect(prisma.operadorCda.findMany.mock.calls[0][0].where).not.toHaveProperty('activo');
    });
  });

  describe('CRUD manual', () => {
    const FILA_BD = {
      id: 'o1',
      numero: null,
      apellidosNombres: 'RUIZ MORA JUAN',
      cedula: '1710034065',
      telefono: null,
      cargo: 'OPERADOR CDA',
      unidad: null,
      fechaInicio: null,
      fotoKey: null,
      activo: true,
      creadoEn: new Date('2026-10-23T10:00:00Z'),
    };
    const ALTA = { apellidosNombres: 'RUIZ MORA JUAN', cedula: '1710034065', cargo: 'OPERADOR CDA', fechaInicio: '2026-10-20' };

    it('list con incluirInactivos no filtra por activo', async () => {
      await service.list({ incluirInactivos: true });
      expect(prisma.operadorCda.findMany.mock.calls[0][0].where).toEqual({ grupo: 'OPERADOR' });
    });

    it('list de asistentes: filtra por su grupo', async () => {
      await service.list({ grupo: 'ASISTENTE' });
      expect(prisma.operadorCda.findMany.mock.calls[0][0].where).toEqual({ grupo: 'ASISTENTE', activo: true });
    });

    it('crear guarda los opcionales ausentes como null y devuelve el DTO', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce(null);
      prisma.operadorCda.create.mockResolvedValueOnce(FILA_BD);

      const r = await service.crear({ ...ALTA, fechaInicio: '2026-10-20', unidad: '' });

      expect(prisma.operadorCda.create).toHaveBeenCalledWith({
        data: {
          cedula: '1710034065',
          grupo: 'OPERADOR',
          apellidosNombres: 'RUIZ MORA JUAN',
          telefono: null,
          cargo: 'OPERADOR CDA',
          unidad: null,
          fechaInicio: new Date('2026-10-20T00:00:00Z'),
        },
      });
      expect(r).toMatchObject({ id: 'o1', activo: true, tieneFoto: false });
    });

    it('crear con cédula ya registrada: 409, y si está oculto lo dice', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce({ activo: false, grupo: 'OPERADOR' });
      await expect(service.crear(ALTA)).rejects.toThrow(/oculto/);
      prisma.operadorCda.findUnique.mockResolvedValueOnce({ activo: true, grupo: 'OPERADOR' });
      await expect(service.crear(ALTA)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.operadorCda.create).not.toHaveBeenCalled();
    });

    it('crear un asistente con la cédula de un operador: 409 que dice en qué grupo está', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce({ activo: true, grupo: 'OPERADOR' });
      await expect(service.crear({ ...ALTA, grupo: 'ASISTENTE' })).rejects.toThrow(
        'Esa cédula ya está registrada en Operadores CDA',
      );
      expect(prisma.operadorCda.create).not.toHaveBeenCalled();
    });

    it('crear un asistente lo guarda en su grupo', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce(null);
      prisma.operadorCda.create.mockResolvedValueOnce({ ...FILA_BD, grupo: 'ASISTENTE' });
      const r = await service.crear({ ...ALTA, grupo: 'ASISTENTE' });
      expect(prisma.operadorCda.create.mock.calls[0][0].data.grupo).toBe('ASISTENTE');
      expect(r.grupo).toBe('ASISTENTE');
    });

    it('crear: dos altas simultáneas (P2002) responden 409, no 500', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce(null);
      prisma.operadorCda.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));
      await expect(service.crear(ALTA)).rejects.toBeInstanceOf(ConflictException);
    });

    it('editar no toca la cédula y vacía lo que el formulario manda vacío', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce({ id: 'o1' });
      prisma.operadorCda.update.mockResolvedValueOnce(FILA_BD);

      await service.editar('o1', { apellidosNombres: 'RUIZ MORA JUAN', cargo: 'OPERADOR CDA', telefono: undefined });

      const { data } = prisma.operadorCda.update.mock.calls[0][0];
      expect(data).not.toHaveProperty('cedula');
      expect(data).toMatchObject({ telefono: null, unidad: null, fechaInicio: null });
    });

    it('dispositivo: guarda Android, iPhone o ninguno y devuelve solo eso; un id inexistente da 404', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce({ id: 'o1' });
      prisma.operadorCda.update.mockResolvedValueOnce({ id: 'o1', dispositivo: 'IPHONE' });
      expect(await service.cambiarDispositivo('o1', 'IPHONE')).toEqual({ id: 'o1', dispositivo: 'IPHONE' });
      expect(prisma.operadorCda.update).toHaveBeenCalledWith({
        where: { id: 'o1' },
        data: { dispositivo: 'IPHONE' },
        select: { id: true, dispositivo: true },
      });

      prisma.operadorCda.findUnique.mockResolvedValueOnce(null);
      await expect(service.cambiarDispositivo('no-existe', null)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ocultar y reactivar cambian solo activo; un id inexistente da 404', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce({ id: 'o1' });
      prisma.operadorCda.update.mockResolvedValueOnce({ ...FILA_BD, activo: false });
      const r = await service.cambiarActivo('o1', false);
      expect(prisma.operadorCda.update).toHaveBeenCalledWith({ where: { id: 'o1' }, data: { activo: false } });
      expect(r.activo).toBe(false);

      prisma.operadorCda.findUnique.mockResolvedValueOnce({ id: 'o1' });
      prisma.operadorCda.update.mockResolvedValueOnce(FILA_BD);
      expect((await service.cambiarActivo('o1', true)).activo).toBe(true);
      expect(prisma.operadorCda.update).toHaveBeenLastCalledWith({ where: { id: 'o1' }, data: { activo: true } });

      prisma.operadorCda.findUnique.mockResolvedValueOnce(null);
      await expect(service.cambiarActivo('no-existe', true)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.editar('no-existe', ALTA)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('cuentas de la app', () => {
    const FILA = {
      id: 'o1',
      grupo: 'ASISTENTE',
      numero: null,
      apellidosNombres: 'RUIZ MORA JUAN',
      cedula: '1710034065',
      telefono: null,
      cargo: 'ASISTENTE CDA',
      unidad: null,
      fechaInicio: null,
      fotoKey: null,
      activo: true,
      creadoEn: new Date('2026-10-23T10:00:00Z'),
    };
    const ALTA = { apellidosNombres: 'RUIZ MORA JUAN', cedula: '1710034065', cargo: 'ASISTENTE CDA', fechaInicio: '2026-10-20' };

    it('crear un asistente le crea o vincula la cuenta', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce(null);
      prisma.operadorCda.create.mockResolvedValueOnce(FILA);

      await service.crear({ ...ALTA, grupo: 'ASISTENTE' });

      expect(cuentas.sincronizar).toHaveBeenCalledWith({ ids: ['o1'] });
    });

    it('si crear la cuenta falla, el alta igual responde bien (el botón la completa)', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce(null);
      prisma.operadorCda.create.mockResolvedValueOnce(FILA);
      cuentas.sincronizar.mockRejectedValueOnce(new Error('sin conexión'));

      await expect(service.crear({ ...ALTA, grupo: 'ASISTENTE' })).resolves.toMatchObject({ id: 'o1' });
    });

    it('si crear las cuentas falla tras importar, la importación igual responde y lo informa', async () => {
      cuentas.sincronizar.mockRejectedValueOnce(new Error('sin conexión'));

      const r = await service.importar(await excel([FILA_OK]), { aplicar: true });

      expect(r.cuentas).toEqual({ vinculadas: 0, creadas: 0, fallidas: 1 });
    });

    it('crear un digitador no crea cuenta', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce(null);
      prisma.operadorCda.create.mockResolvedValueOnce({ ...FILA, grupo: 'DIGITADOR' });

      await service.crear({ ...ALTA, grupo: 'DIGITADOR' });

      expect(cuentas.sincronizar).not.toHaveBeenCalled();
    });

    it('importar operadores: tras guardar, crea o vincula las cuentas de esas cédulas y lo informa', async () => {
      const file = await excel([FILA_OK]);

      const r = await service.importar(file, { aplicar: true });

      expect(cuentas.sincronizar).toHaveBeenCalledWith({ cedulas: ['1710034065'] });
      expect(r.cuentas).toEqual({ vinculadas: 0, creadas: 1, fallidas: 0 });
    });

    it('la vista previa no toca cuentas', async () => {
      await service.importar(await excel([FILA_OK]), { aplicar: false });
      expect(cuentas.sincronizar).not.toHaveBeenCalled();
    });

    it('importar otro grupo (digitadores) no crea cuentas', async () => {
      const r = await service.importar(await excel([FILA_OK]), { aplicar: true, grupo: 'DIGITADOR' });
      expect(cuentas.sincronizar).not.toHaveBeenCalled();
      expect(r.cuentas).toBeUndefined();
    });

    it('ocultar retira la cuenta en la misma transacción; reactivar la asegura', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce({ id: 'o1' });
      prisma.operadorCda.update.mockResolvedValueOnce({ ...FILA, activo: false });
      await service.cambiarActivo('o1', false);
      expect(cuentas.retirarCuenta).toHaveBeenCalledWith(prisma, 'o1');
      expect(cuentas.asegurarCuenta).not.toHaveBeenCalled();

      prisma.operadorCda.findUnique.mockResolvedValueOnce({ id: 'o1' });
      prisma.operadorCda.update.mockResolvedValueOnce(FILA);
      await service.cambiarActivo('o1', true);
      expect(cuentas.asegurarCuenta).toHaveBeenCalledWith(prisma, 'o1', 'hash-inicial');
    });

    it('si retirar la cuenta falla, falla todo (misma transacción)', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce({ id: 'o1' });
      prisma.operadorCda.update.mockResolvedValueOnce({ ...FILA, activo: false });
      cuentas.retirarCuenta.mockRejectedValueOnce(new Error('falla'));
      await expect(service.cambiarActivo('o1', false)).rejects.toThrow('falla');
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
    });

    it.each([
      [{ usuario: null }, 'SIN_CUENTA'],
      [{ usuario: { activo: true, debeCambiarPwd: true, bloqueadoHasta: null } }, 'PENDIENTE_CAMBIO'],
      [{ usuario: { activo: true, debeCambiarPwd: false, bloqueadoHasta: null } }, 'ACTIVA'],
      [{ usuario: { activo: true, debeCambiarPwd: false, bloqueadoHasta: new Date(Date.now() + 60_000) } }, 'BLOQUEADA'],
      [{ usuario: { activo: true, debeCambiarPwd: false, bloqueadoHasta: new Date(Date.now() - 60_000) } }, 'ACTIVA'],
      [{ usuario: { activo: false, debeCambiarPwd: false, bloqueadoHasta: null } }, 'INACTIVA'],
      [{ activo: false, usuario: { activo: true, debeCambiarPwd: false, bloqueadoHasta: null } }, 'INACTIVA'],
      [{ grupo: 'DIGITADOR', usuario: { activo: true, debeCambiarPwd: false, bloqueadoHasta: null } }, 'SIN_CUENTA'],
    ])('list: estado de la cuenta %o → %s', async (cambios, esperado) => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([{ ...FILA, ...cambios }]);

      const [o] = await service.list({ grupo: 'ASISTENTE' });

      expect(o.cuenta).toBe(esperado);
      expect(o).not.toHaveProperty('usuario');
    });

    it('list pide los datos de la cuenta vinculada', async () => {
      await service.list({});
      expect(prisma.operadorCda.findMany.mock.calls[0][0].include).toEqual({
        usuario: { select: { activo: true, debeCambiarPwd: true, bloqueadoHasta: true } },
      });
    });
  });
});
