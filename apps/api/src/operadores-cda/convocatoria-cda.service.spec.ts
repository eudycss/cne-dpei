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
});
