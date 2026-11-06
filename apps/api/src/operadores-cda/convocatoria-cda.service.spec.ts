import { BadRequestException } from '@nestjs/common';
import { ConvocatoriaCdaService } from './convocatoria-cda.service';
import type { PrismaService } from '../db/prisma.service';

const fecha = (dia: string) => new Date(`${dia}T00:00:00Z`);
const persona = (id: string, nombre: string, grupo: string, cargo: string, centro: string, orden: number) => ({
  id,
  apellidosNombres: nombre,
  cedula: `170000000${id[7]}`,
  grupo,
  cargoCda: { nombre: cargo, centro, orden },
});

describe('ConvocatoriaCdaService', () => {
  const prisma = {
    operadorCda: { findMany: jest.fn() },
    parejaCda: { findMany: jest.fn() },
    asistenciaCda: { findMany: jest.fn() },
    convocatoriaCda: {
      findMany: jest.fn(),
      deleteMany: jest.fn((args: unknown) => ({ op: 'deleteMany', args })),
      createMany: jest.fn((args: unknown) => ({ op: 'createMany', args })),
    },
    $transaction: jest.fn(),
  };
  // Lo que Prisma devolvería: cuántos quitó (1) y cuántos agregó (los que se mandan).
  const contar = (ops: { op: string; args: { data?: unknown[] } }[]) =>
    Promise.resolve(ops.map((o) => ({ count: o.op === 'deleteMany' ? 1 : o.args.data!.length })));
  let service: ConvocatoriaCdaService;
  const personal = [
    persona('00000003-0000-4000-8000-000000000000', 'ZAPATA ZOE', 'DIGITADOR', 'Digitador', 'CPE', 1),
    persona('00000001-0000-4000-8000-000000000000', 'ANDRADE ANA', 'OPERADOR', 'Operador', 'CDA', 1),
    persona('00000002-0000-4000-8000-000000000000', 'BENÍTEZ BRUNO', 'ASISTENTE', 'Asistente', 'CDA', 2),
    persona('00000004-0000-4000-8000-000000000000', 'ÁLVAREZ ALBA', 'DIGITADOR', 'Digitador', 'CPE', 1),
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(contar);
    // Ana va en Parejas el 05; Zoe convocada a mano.
    prisma.parejaCda.findMany.mockResolvedValue([{ fecha: fecha('2026-11-05'), operadorCdaId: '00000001-0000-4000-8000-000000000000', asistenteCdaId: null }]);
    prisma.convocatoriaCda.findMany.mockResolvedValue([{ fecha: fecha('2026-11-05'), operadorId: '00000003-0000-4000-8000-000000000000' }]);
    prisma.operadorCda.findMany.mockImplementation(({ where }: { where: { id?: { in: string[] } } }) =>
      Promise.resolve(where.id ? personal.filter((p) => where.id!.in.includes(p.id)) : personal),
    );
    service = new ConvocatoriaCdaService(prisma as unknown as PrismaService);
  });

  describe('dia', () => {
    it('todo el personal activo por centro, cargo y nombre, con quién está convocado y quién viene de Parejas', async () => {
      const r = await service.dia('2026-11-05');
      expect(prisma.operadorCda.findMany.mock.calls[0][0].where).toEqual({ activo: true });
      expect(r.personas.map((p) => [p.apellidosNombres, p.centro, p.convocado, p.porPareja])).toEqual([
        ['ANDRADE ANA', 'CDA', true, true],
        ['BENÍTEZ BRUNO', 'CDA', false, false],
        ['ÁLVAREZ ALBA', 'CPE', false, false],
        ['ZAPATA ZOE', 'CPE', true, false],
      ]);
      expect(r).toEqual(expect.objectContaining({ fecha: '2026-11-05', convocados: 2, total: 4 }));
    });

    it('una fecha inválida se rechaza', async () => {
      await expect(service.dia('2026-02-30')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.dia(undefined)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('guardar', () => {
    it('deja exactamente los marcados a mano: agrega los nuevos, quita los que ya no están, sin duplicar a los de Parejas', async () => {
      // Se manda a Ana (ya va en Parejas), a Bruno y a Alba; Zoe sale.
      const r = await service.guardar('2026-11-05', { operadorIds: ['00000001-0000-4000-8000-000000000000', '00000002-0000-4000-8000-000000000000', '00000004-0000-4000-8000-000000000000'] }, 'u-admin');
      const [ops] = prisma.$transaction.mock.calls[0];
      expect(ops).toEqual([
        // Quita a los activos que ya no están (Zoe); a los ocultos no los toca.
        {
          op: 'deleteMany',
          args: {
            where: {
              fecha: fecha('2026-11-05'),
              operadorId: { notIn: ['00000002-0000-4000-8000-000000000000', '00000004-0000-4000-8000-000000000000'] },
              operador: { activo: true },
            },
          },
        },
        {
          op: 'createMany',
          args: {
            data: [
              { fecha: fecha('2026-11-05'), operadorId: '00000002-0000-4000-8000-000000000000', creadoPorId: 'u-admin' },
              { fecha: fecha('2026-11-05'), operadorId: '00000004-0000-4000-8000-000000000000', creadoPorId: 'u-admin' },
            ],
            skipDuplicates: true,
          },
        },
      ]);
      expect(r).toEqual(expect.objectContaining({ agregados: 2, quitados: 1 }));
    });

    it('rechaza personas que no existen o están ocultas, y fechas inválidas', async () => {
      await expect(service.guardar('2026-11-05', { operadorIds: ['99999999-9999-4999-8999-999999999999'] })).rejects.toThrow(
        'Alguna persona no existe o está oculta',
      );
      await expect(service.guardar('ayer', { operadorIds: [] })).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('una lista vacía quita a todos los marcados a mano (los de Parejas siguen)', async () => {
      const r = await service.guardar('2026-11-05', { operadorIds: [] });
      expect(r).toEqual(expect.objectContaining({ agregados: 0, quitados: 1 }));
    });
  });

  describe('cargar (Excel de convocatoria)', () => {
    const ID = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;
    const csv = (texto: string) =>
      ({ originalname: 'convocatoria.csv', mimetype: 'text/csv', buffer: Buffer.from(texto, 'utf8') }) as Express.Multer.File;

    beforeEach(() => {
      prisma.operadorCda.findMany.mockImplementation(({ where }: { where: { cedula?: { in: string[] } } }) =>
        Promise.resolve(
          [
            { id: ID(1), cedula: '1000000001', apellidosNombres: 'ANDRADE ANA', activo: true },
            { id: ID(2), cedula: '1000000002', apellidosNombres: 'BENÍTEZ BRUNO', activo: true },
            { id: ID(3), cedula: '0400000003', apellidosNombres: 'ZAPATA ZOE', activo: true },
            { id: ID(5), cedula: '1000000005', apellidosNombres: 'OCULTA OLGA', activo: false },
          ].filter((x) => where.cedula?.in.includes(x.cedula)),
        ),
      );
      // Ana va en Parejas el 05; Zoe ya estaba convocada a mano el 05.
      prisma.parejaCda.findMany.mockResolvedValue([{ fecha: fecha('2026-11-05'), operadorCdaId: ID(1), asistenteCdaId: null }]);
      prisma.convocatoriaCda.findMany.mockResolvedValue([{ fecha: fecha('2026-11-05'), operadorId: ID(3) }]);
      // El 05 marcaron entrada Ana y Bruno; el 04 nadie.
      prisma.asistenciaCda.findMany.mockResolvedValue([
        { fecha: fecha('2026-11-05'), operadorId: ID(1) },
        { fecha: fecha('2026-11-05'), operadorId: ID(2) },
      ]);
    });

    it('vista previa: cada fila con su estado y, por fecha, convocados, cuántos vinieron y cuántos sin entrada', async () => {
      const r = await service.cargar(
        csv(
          [
            'Fecha,Cédula,Nombre',
            '05/11/2026,1000000002,BRUNO', // nueva y vino
            '2026-11-05,400000003,ZOE', // ya convocada (cédula sin el 0 inicial)
            '05/11/2026,1000000001,ANA', // va en Parejas
            '04/11/2026,1000000002,BRUNO', // nueva, el 04 no vino
            '04/11/2026,1000000002,BRUNO', // repetida
            '05/11/2026,1000000005,OLGA', // oculta
            '05/11/2026,1999999999,NADIE', // no existe
            '31/02/2026,1000000002,X', // fecha inválida
            '05/11/2026,abc,X', // cédula inválida
          ].join('\n'),
        ),
        undefined,
        false,
      );
      expect(r.filas.map((f) => [f.fila, f.estado, f.fecha, f.cedula, f.mensaje])).toEqual([
        [2, 'NUEVA', '2026-11-05', '1000000002', null],
        [3, 'YA_CONVOCADA', '2026-11-05', '0400000003', 'Ya estaba convocada'],
        [4, 'EN_PAREJAS', '2026-11-05', '1000000001', 'Ya convocada: va en Parejas ese día'],
        [5, 'NUEVA', '2026-11-04', '1000000002', null],
        [6, 'ERROR', '2026-11-04', '1000000002', 'Repetida: ya está en la fila 5'],
        [7, 'ERROR', '2026-11-05', '1000000005', 'Está oculta: reactívela en Listado para convocarla'],
        [8, 'ERROR', '2026-11-05', '1999999999', 'No hay nadie del personal CDA/CPE con esa cédula'],
        [9, 'ERROR', null, '1000000002', '"31/02/2026" no es una fecha (use 05/11/2026 o 2026-11-05)'],
        [10, 'ERROR', '2026-11-05', 'abc', '"abc" no es una cédula (10 dígitos)'],
      ]);
      expect(r.filas[0].apellidosNombres).toBe('BENÍTEZ BRUNO');
      expect(r).toEqual(expect.objectContaining({ aplicada: false, nuevas: 2, errores: 5 }));
      expect(r.fechas).toEqual([
        { fecha: '2026-11-04', convocados: 1, vinieron: 0, sinEntrada: 1 },
        { fecha: '2026-11-05', convocados: 3, vinieron: 2, sinEntrada: 1 },
      ]);
      expect(prisma.convocatoriaCda.createMany).not.toHaveBeenCalled();
    });

    it('al aplicar agrega solo las nuevas, a nombre de quien carga (no quita a nadie)', async () => {
      const r = await service.cargar(csv('Fecha,Cédula\n05/11/2026,1000000002\n05/11/2026,0400000003'), undefined, true, 'u-admin');
      expect(prisma.convocatoriaCda.createMany).toHaveBeenCalledWith({
        data: [{ fecha: fecha('2026-11-05'), operadorId: ID(2), creadoPorId: 'u-admin' }],
        skipDuplicates: true,
      });
      expect(prisma.convocatoriaCda.deleteMany).not.toHaveBeenCalled();
      expect(r.aplicada).toBe(true);
    });

    it('sin columna Fecha usa el día elegido en la pantalla; sin ninguno, la fila es error', async () => {
      const conDia = await service.cargar(csv('Cédula\n1000000002'), '2026-11-04', false);
      expect(conDia.filas[0]).toEqual(expect.objectContaining({ estado: 'NUEVA', fecha: '2026-11-04' }));
      const sinDia = await service.cargar(csv('Cédula\n1000000002'), undefined, false);
      expect(sinDia.filas[0].mensaje).toBe('Falta la fecha: elija el día en la pantalla o agregue la columna Fecha');
      expect(sinDia.fechas).toEqual([]);
    });

    it('acepta otros encabezados (C.I., Día) y la fecha como la entrega Excel', async () => {
      const excel = String(new Date('2026-11-05T00:00:00Z'));
      const r = await service.cargar(csv(`C.I.,Día\n1000000002,"${excel}"`), undefined, false);
      expect(r.filas[0]).toEqual(expect.objectContaining({ estado: 'NUEVA', fecha: '2026-11-05' }));
    });

    it('lee su propia plantilla Excel', async () => {
      const plantilla = await service.plantilla();
      const r = await service.cargar(
        { originalname: 'plantilla_convocatoria.xlsx', mimetype: 'application/octet-stream', buffer: plantilla } as Express.Multer.File,
        undefined,
        false,
      );
      // La fila de ejemplo tiene una cédula que no existe.
      expect(r.filas).toEqual([expect.objectContaining({ fecha: '2026-11-05', cedula: '1001234567', estado: 'ERROR' })]);
    });

    it('en Excel la fila es la real del archivo (aunque haya filas en blanco) y lee celdas de fecha', async () => {
      const ExcelJS = await import('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Convocatoria');
      ws.addRow(['Fecha', 'Cédula']);
      ws.addRow([new Date('2026-11-05T00:00:00Z'), '1000000002']);
      ws.addRow([]);
      ws.addRow([]);
      ws.addRow(['05/11/2026', 'abc']);
      const buffer = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
      const r = await service.cargar({ originalname: 'c.xlsx', mimetype: 'x', buffer } as Express.Multer.File, undefined, false);
      expect(r.filas.map((f) => [f.fila, f.fecha, f.estado])).toEqual([
        [2, '2026-11-05', 'NUEVA'],
        [5, '2026-11-05', 'ERROR'],
      ]);
    });

    it('las fechas de un archivo no pueden abarcar más de un año', async () => {
      await expect(service.cargar(csv('Fecha,Cédula\n05/11/2024,1000000002\n05/11/2026,1000000002'), undefined, false)).rejects.toThrow(
        'cargue como máximo un año por archivo',
      );
    });

    it('informa lo que de verdad se guardó (si otra carga agregó a alguien a la vez)', async () => {
      (prisma.convocatoriaCda.createMany as jest.Mock).mockResolvedValueOnce({ count: 0 });
      const r = await service.cargar(csv('Fecha,Cédula\n05/11/2026,1000000002'), undefined, true);
      expect(r.nuevas).toBe(0);
    });

    it('rechaza sin archivo, vacío, demasiadas filas o un día de pantalla inválido', async () => {
      await expect(service.cargar(undefined, undefined, false)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.cargar(csv('Cédula\n'), undefined, false)).rejects.toThrow('El archivo no tiene filas');
      const muchas = ['Cédula', ...Array.from({ length: 5001 }, () => '1000000002')].join('\n');
      await expect(service.cargar(csv(muchas), '2026-11-05', false)).rejects.toThrow('el máximo es 5000');
      await expect(service.cargar(csv('Cédula\n1000000002'), '2026-13-40', false)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
