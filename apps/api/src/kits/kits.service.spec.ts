import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { itemKitDetalleSchema } from '@cne/shared-validation';
import { KitsService, normalizarDetalle } from './kits.service';
import { PrismaService } from '../db/prisma.service';

function csvFile(csv: string) {
  return { originalname: 'kits.csv', mimetype: 'text/csv', buffer: Buffer.from(csv, 'utf8') } as Express.Multer.File;
}

describe('KitsService', () => {
  let service: KitsService;

  const prisma = {
    kitElectoral: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    eventoElectoral: {
      findUnique: jest.fn(),
    },
    usuario: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    recinto: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    itemKitCatalog: {
      count: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
  };

  const eventoId = '22222222-2222-2222-2222-222222222222';
  const kitId = '33333333-3333-3333-3333-333333333333';
  const operadorId = '11111111-1111-1111-1111-111111111111';
  const recintoId = '44444444-4444-4444-4444-444444444444';

  function kitRow(overrides: Record<string, unknown> = {}) {
    return {
      id: kitId,
      eventoId,
      codigoUnico: 'ABCD2345',
      qrPayload: 'ABCD2345',
      nombre: 'Kit 1',
      contenidos: null,
      recintoId: null,
      operadorId: null,
      estado: 'EN_BODEGA',
      esPrueba: false,
      creadoEn: new Date('2026-06-19T10:00:00Z'),
      itemsContenido: [],
      ...overrides,
    };
  }

  // Por defecto BORRADOR con jornada futura: no congelado (HU12-CA6).
  function eventoRow(overrides: Record<string, unknown> = {}) {
    return {
      id: eventoId,
      estado: 'BORRADOR',
      fechaJornada: new Date('2099-01-01'),
      ...overrides,
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((arr: Promise<unknown>[]) => Promise.all(arr));
    prisma.itemKitCatalog.findMany.mockResolvedValue([]);
    prisma.kitElectoral.findFirst.mockResolvedValue(null);

    const moduleRef = await Test.createTestingModule({
      providers: [KitsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(KitsService);
  });

  describe('list', () => {
    it('excluye kits de prueba salvo que incluirPrueba=true', async () => {
      prisma.kitElectoral.count.mockResolvedValueOnce(1);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([kitRow()]);
      await service.list({ eventoId });
      expect(prisma.kitElectoral.count).toHaveBeenCalledWith({
        where: { eventoId, esPrueba: false },
      });

      prisma.kitElectoral.count.mockResolvedValueOnce(2);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([kitRow(), kitRow({ esPrueba: true })]);
      await service.list({ eventoId, incluirPrueba: true });
      expect(prisma.kitElectoral.count).toHaveBeenCalledWith({ where: { eventoId } });
    });
  });

  describe('recintosOcupados', () => {
    it('devuelve los recintoId únicos de los kits reales (no de prueba) del evento', async () => {
      const otroRecintoId = '99999999-9999-9999-9999-999999999999';
      prisma.kitElectoral.findMany.mockResolvedValueOnce([
        { recintoId },
        { recintoId },
        { recintoId: otroRecintoId },
      ]);

      const result = await service.recintosOcupados(eventoId);

      expect(prisma.kitElectoral.findMany).toHaveBeenCalledWith({
        where: { eventoId, recintoId: { not: null }, esPrueba: false },
        select: { recintoId: true },
      });
      expect(result.sort()).toEqual([recintoId, otroRecintoId].sort());
    });
  });

  describe('create', () => {
    it('lanza NotFoundException si el evento no existe', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.create({ eventoId, nombre: 'Kit 1', recintoId } as any),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.kitElectoral.create).not.toHaveBeenCalled();
    });

    it('lanza NotFoundException si el recinto elegido no existe', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.recinto.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.create({ eventoId, nombre: 'Kit 1', recintoId } as any),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.kitElectoral.create).not.toHaveBeenCalled();
    });

    it('lanza ConflictException si el recinto ya tiene un kit real en este evento', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.recinto.findUnique.mockResolvedValueOnce({ id: recintoId });
      prisma.kitElectoral.findFirst.mockResolvedValueOnce(kitRow({ recintoId }));
      await expect(
        service.create({ eventoId, nombre: 'Kit 1', recintoId } as any),
      ).rejects.toThrow(ConflictException);
      expect(prisma.kitElectoral.create).not.toHaveBeenCalled();
    });

    it('permite crear un kit de prueba aunque el recinto ya tenga un kit real', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.recinto.findUnique.mockResolvedValueOnce({ id: recintoId });
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(null);
      prisma.kitElectoral.create.mockResolvedValueOnce(kitRow({ recintoId, esPrueba: true }));

      await service.create({ eventoId, nombre: 'Kit 1', recintoId, esPrueba: true } as any);

      expect(prisma.kitElectoral.findFirst).not.toHaveBeenCalled();
      expect(prisma.kitElectoral.create).toHaveBeenCalled();
    });

    it('crea el kit con un código único, ya ASIGNADO al recinto elegido', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.recinto.findUnique.mockResolvedValueOnce({ id: recintoId });
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(null); // sin colisión de código
      prisma.kitElectoral.create.mockResolvedValueOnce(kitRow({ recintoId, estado: 'ASIGNADO' }));

      const result = await service.create({ eventoId, nombre: 'Kit 1', recintoId } as any);

      expect(result.estado).toBe('ASIGNADO');
      expect(prisma.kitElectoral.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventoId, recintoId, estado: 'ASIGNADO' }),
        }),
      );
      const data = prisma.kitElectoral.create.mock.calls[0][0].data;
      expect(data.codigoUnico).toHaveLength(8);
      expect(data.qrPayload).toBe(data.codigoUnico); // CA2: el QR codifica el código único
    });

    it('lanza BadRequestException si algún itemId no existe o está inactivo', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.recinto.findUnique.mockResolvedValueOnce({ id: recintoId });
      prisma.itemKitCatalog.count.mockResolvedValueOnce(1); // pidió 2, solo 1 válido/activo
      await expect(
        service.create({
          eventoId,
          nombre: 'Kit 1',
          recintoId,
          itemIds: [operadorId, kitId],
        } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.kitElectoral.create).not.toHaveBeenCalled();
    });

    it('deduplica itemIds repetidos antes de validar y de armar itemsContenido.create', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.recinto.findUnique.mockResolvedValueOnce({ id: recintoId });
      prisma.itemKitCatalog.count.mockResolvedValueOnce(1); // 1 id único tras deduplicar
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(null);
      prisma.kitElectoral.create.mockResolvedValueOnce(
        kitRow({ recintoId, estado: 'ASIGNADO', itemsContenido: [{ item: { etiqueta: 'Computador' } }] }),
      );

      await service.create({
        eventoId,
        nombre: 'Kit 1',
        recintoId,
        itemIds: [operadorId, operadorId],
      } as any);

      expect(prisma.itemKitCatalog.count).toHaveBeenCalledWith({
        where: { id: { in: [operadorId] }, activo: true },
      });
      expect(prisma.kitElectoral.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            itemsContenido: { create: [{ item: { connect: { id: operadorId } }, serie: null, estado: 'BUENO' }] },
          }),
        }),
      );
    });

    it('con itemIds válidos, arma itemsContenido.create y expone items en el DTO', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.recinto.findUnique.mockResolvedValueOnce({ id: recintoId });
      prisma.itemKitCatalog.count.mockResolvedValueOnce(1);
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(null);
      prisma.kitElectoral.create.mockResolvedValueOnce(
        kitRow({ recintoId, estado: 'ASIGNADO', itemsContenido: [{ item: { etiqueta: 'Computador' } }] }),
      );

      const result = await service.create({
        eventoId,
        nombre: 'Kit 1',
        recintoId,
        itemIds: [operadorId],
      } as any);

      expect(prisma.kitElectoral.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            itemsContenido: { create: [{ item: { connect: { id: operadorId } }, serie: null, estado: 'BUENO' }] },
          }),
        }),
      );
      expect(result.items).toEqual(['Computador']);
    });
  });

  describe('asignar', () => {
    it('lanza NotFoundException si el kit no existe', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.asignar(kitId, { operadorId } as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza BadRequestException (sin frozen) si el kit no tiene recinto asignado', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow({ recintoId: null }));
      await expect(service.asignar(kitId, { operadorId } as any)).rejects.toMatchObject({
        response: expect.not.objectContaining({ frozen: true }),
      });
      expect(prisma.eventoElectoral.findUnique).not.toHaveBeenCalled();
      expect(prisma.kitElectoral.update).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si el usuario no tiene rol OPERADOR_CDA', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow({ recintoId }));
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.usuario.findFirst.mockResolvedValueOnce(null);
      await expect(service.asignar(kitId, { operadorId } as any)).rejects.toThrow(
        BadRequestException,
      );
      // Solo operadores activos: uno desactivado no se puede asignar.
      expect(prisma.usuario.findFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: operadorId, activo: true }),
      });
    });

    it('lanza ConflictException si el operador ya tiene kits en otro recinto', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow({ recintoId }));
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.usuario.findFirst.mockResolvedValueOnce({ id: operadorId });
      prisma.kitElectoral.findMany.mockResolvedValueOnce([
        { recintoId: '99999999-9999-9999-9999-999999999999' },
      ]);
      await expect(service.asignar(kitId, { operadorId } as any)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.kitElectoral.update).not.toHaveBeenCalled();
    });

    it('asigna el kit y pasa de EN_BODEGA a ASIGNADO', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow({ estado: 'EN_BODEGA', recintoId }));
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.usuario.findFirst.mockResolvedValueOnce({ id: operadorId });
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]); // sin conflictos
      prisma.kitElectoral.update.mockResolvedValueOnce(
        kitRow({ estado: 'ASIGNADO', operadorId, recintoId }),
      );

      const result = await service.asignar(kitId, { operadorId } as any);

      expect(result.estado).toBe('ASIGNADO');
      expect(prisma.kitElectoral.update).toHaveBeenCalledWith({
        where: { id: kitId },
        data: { operadorId, estado: 'ASIGNADO' },
      });
    });

    // HU12-CA6: freeze de asignaciones el día de la jornada electoral.
    it('lanza BadRequestException con frozen:true si el evento ya inició su jornada y no hay justificación', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow({ recintoId }));
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(
        eventoRow({ estado: 'ACTIVO', fechaJornada: new Date('2020-01-01') }),
      );
      await expect(service.asignar(kitId, { operadorId } as any)).rejects.toMatchObject(
        { response: { frozen: true } },
      );
      expect(prisma.kitElectoral.update).not.toHaveBeenCalled();
    });

    it('permite reasignar con jornada iniciada si se envía justificación', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow({ estado: 'EN_BODEGA', recintoId }));
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(
        eventoRow({ estado: 'ACTIVO', fechaJornada: new Date('2020-01-01') }),
      );
      prisma.usuario.findFirst.mockResolvedValueOnce({ id: operadorId });
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);
      prisma.kitElectoral.update.mockResolvedValueOnce(
        kitRow({ estado: 'ASIGNADO', operadorId, recintoId }),
      );

      const result = await service.asignar(kitId, {
        operadorId,
        justificacion: 'Kit dañado, se reemplaza en campo',
      } as any);

      expect(result.estado).toBe('ASIGNADO');
    });
  });

  describe('serie y estado de los ítems', () => {
    const itemA = '55555555-5555-5555-5555-555555555555';
    const itemB = '66666666-6666-6666-6666-666666666666';

    it('create con detalleItems guarda serie y estado (y manda sobre itemIds)', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.recinto.findUnique.mockResolvedValueOnce({ id: recintoId });
      prisma.itemKitCatalog.count.mockResolvedValueOnce(2);
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(null);
      prisma.kitElectoral.create.mockResolvedValueOnce(
        kitRow({
          recintoId,
          itemsContenido: [
            { itemId: itemA, serie: '5CD445577S', estado: 'BUENO', item: { etiqueta: 'Computador' } },
            { itemId: itemB, serie: null, estado: 'REGULAR', item: { etiqueta: 'Cargador' } },
          ],
        }),
      );

      const result = await service.create({
        eventoId,
        nombre: 'Kit 1',
        recintoId,
        itemIds: [operadorId],
        detalleItems: [
          { itemId: itemA, serie: ' 5CD445577S ' },
          { itemId: itemB, serie: '', estado: 'REGULAR' },
        ],
      } as any);

      expect(prisma.kitElectoral.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            itemsContenido: {
              create: [
                { item: { connect: { id: itemA } }, serie: '5CD445577S', estado: 'BUENO' },
                { item: { connect: { id: itemB } }, serie: null, estado: 'REGULAR' },
              ],
            },
          }),
        }),
      );
      expect(result.detalleItems).toEqual([
        { itemId: itemA, etiqueta: 'Computador', serie: '5CD445577S', estado: 'BUENO' },
        { itemId: itemB, etiqueta: 'Cargador', serie: null, estado: 'REGULAR' },
      ]);
    });

    it('editar con detalleItems reemplaza todo el contenido (borra y vuelve a crear)', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow({ itemsContenido: [{ itemId: itemA }] }));
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.itemKitCatalog.count.mockResolvedValueOnce(1);
      prisma.kitElectoral.update.mockResolvedValueOnce(kitRow());

      await service.editar(kitId, { detalleItems: [{ itemId: itemB, serie: 'X1', estado: 'MALO' }] } as any);

      expect(prisma.kitElectoral.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            itemsContenido: {
              deleteMany: {},
              create: [{ item: { connect: { id: itemB } }, serie: 'X1', estado: 'MALO' }],
            },
          },
        }),
      );
    });

    it('carga masiva: "CODIGO:SERIE" guarda la serie; sin ":" queda sin serie', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.usuario.findMany.mockResolvedValueOnce([]);
      prisma.recinto.findMany.mockResolvedValueOnce([]);
      prisma.itemKitCatalog.findMany.mockResolvedValueOnce([
        { id: itemA, codigo: 'COMPUTADOR' },
        { id: itemB, codigo: 'MOUSE' },
      ]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);
      prisma.kitElectoral.findUnique.mockResolvedValue(null);
      prisma.kitElectoral.create.mockResolvedValue(kitRow());

      const csv = ['nombre,items', 'Kit A,"computador: 5CD445577S ,MOUSE"'].join('\n');
      const result = await service.bulkUpload(csvFile(csv), eventoId);

      expect(result.errores).toHaveLength(0);
      expect(prisma.kitElectoral.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            itemsContenido: {
              create: [
                { item: { connect: { id: itemA } }, serie: '5CD445577S', estado: 'BUENO' },
                { item: { connect: { id: itemB } }, serie: null, estado: 'BUENO' },
              ],
            },
          }),
        }),
      );
    });

    it('carga masiva: una serie de más de 60 caracteres es error de esa fila', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.usuario.findMany.mockResolvedValueOnce([]);
      prisma.recinto.findMany.mockResolvedValueOnce([]);
      prisma.itemKitCatalog.findMany.mockResolvedValueOnce([{ id: itemA, codigo: 'COMPUTADOR' }]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);

      const csv = ['nombre,items', `Kit A,COMPUTADOR:${'X'.repeat(61)}`].join('\n');
      const result = await service.bulkUpload(csvFile(csv), eventoId);

      expect(result.creados).toBe(0);
      expect(result.errores[0].error).toMatch(/serie demasiado larga/i);
    });

    it('editar con detalleItems acepta un ítem ya del kit aunque se haya desactivado en el catálogo', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow({ itemsContenido: [{ itemId: itemA }] }));
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.kitElectoral.update.mockResolvedValueOnce(kitRow());

      await service.editar(kitId, { detalleItems: [{ itemId: itemA, serie: 'CORREGIDA' }] } as any);

      // itemA ya estaba en el kit: no se valida contra el catálogo activo.
      expect(prisma.itemKitCatalog.count).not.toHaveBeenCalled();
      expect(prisma.kitElectoral.update).toHaveBeenCalled();
    });

    it('carga masiva: una serie que empieza como fórmula (=, +, -, @) es error de esa fila', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.usuario.findMany.mockResolvedValueOnce([]);
      prisma.recinto.findMany.mockResolvedValueOnce([]);
      prisma.itemKitCatalog.findMany.mockResolvedValueOnce([{ id: itemA, codigo: 'COMPUTADOR' }]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);

      const csv = ['nombre,items', 'Kit A,COMPUTADOR:=HYPERLINK(x)'].join('\n');
      const result = await service.bulkUpload(csvFile(csv), eventoId);

      expect(result.creados).toBe(0);
      expect(result.errores[0].error).toMatch(/no puede empezar con/i);
      expect(prisma.kitElectoral.create).not.toHaveBeenCalled();
    });

    it('el esquema rechaza series con fórmula, de más de 60 caracteres o un estado inválido', () => {
      const ok = (d: object) => itemKitDetalleSchema.safeParse({ itemId: itemA, ...d }).success;
      expect(ok({ serie: '5CD445577S', estado: 'REGULAR' })).toBe(true);
      expect(ok({ serie: '=1+1' })).toBe(false);
      expect(ok({ serie: '@cmd' })).toBe(false);
      expect(ok({ serie: 'AB\u0007C' })).toBe(false);
      expect(ok({ serie: 'X'.repeat(61) })).toBe(false);
      expect(ok({ estado: 'ROTO' })).toBe(false);
    });

    it('normalizarDetalle deduplica por ítem (gana el último), limpia la serie y usa BUENO por defecto', () => {
      expect(
        normalizarDetalle(
          [
            { itemId: itemA, serie: 'viejo' },
            { itemId: itemB, serie: '   ' },
            { itemId: itemA, serie: ' nuevo ', estado: 'MALO' },
          ],
          undefined,
        ),
      ).toEqual([
        { itemId: itemA, serie: 'nuevo', estado: 'MALO' },
        { itemId: itemB, serie: null, estado: 'BUENO' },
      ]);
      expect(normalizarDetalle(undefined, [itemA])).toEqual([{ itemId: itemA, serie: null, estado: 'BUENO' }]);
      expect(normalizarDetalle(undefined, undefined)).toBeUndefined();
    });
  });

  describe('editar', () => {
    it('lanza NotFoundException si el kit no existe', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.editar(kitId, { recintoId } as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza NotFoundException si el recinto nuevo no existe', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow());
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.recinto.findUnique.mockResolvedValueOnce(null);
      await expect(service.editar(kitId, { recintoId } as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('cambia el recinto y regenera el nombre a partir de él', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow({ itemsContenido: [] }));
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.recinto.findUnique.mockResolvedValueOnce({
        id: recintoId,
        codigoRecinto: '28',
        nombre: 'Escuela Central',
      });
      prisma.kitElectoral.update.mockResolvedValueOnce(
        kitRow({ recintoId, nombre: '28 — Escuela Central' }),
      );

      const result = await service.editar(kitId, { recintoId } as any);

      expect(prisma.kitElectoral.update).toHaveBeenCalledWith({
        where: { id: kitId },
        data: { recintoId, nombre: '28 — Escuela Central' },
        include: { itemsContenido: { include: { item: true } } },
      });
      expect(result.nombre).toBe('28 — Escuela Central');
    });

    it('lanza ConflictException si el recinto nuevo ya tiene otro kit real en este evento', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow({ itemsContenido: [] }));
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.recinto.findUnique.mockResolvedValueOnce({
        id: recintoId,
        codigoRecinto: '28',
        nombre: 'Escuela Central',
      });
      prisma.kitElectoral.findFirst.mockResolvedValueOnce(
        kitRow({ id: '99999999-9999-9999-9999-999999999999', recintoId }),
      );

      await expect(service.editar(kitId, { recintoId } as any)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.kitElectoral.update).not.toHaveBeenCalled();
    });

    it('lanza ConflictException si el kit ya tiene operador y el nuevo recinto choca con sus otros kits', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(
        kitRow({ operadorId, itemsContenido: [] }),
      );
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.recinto.findUnique.mockResolvedValueOnce({
        id: recintoId,
        codigoRecinto: '28',
        nombre: 'Escuela Central',
      });
      prisma.kitElectoral.findMany.mockResolvedValueOnce([
        { recintoId: '99999999-9999-9999-9999-999999999999' },
      ]);

      await expect(service.editar(kitId, { recintoId } as any)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.kitElectoral.update).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si algún itemId nuevo no existe o está inactivo', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow({ itemsContenido: [] }));
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.itemKitCatalog.count.mockResolvedValueOnce(0);
      await expect(
        service.editar(kitId, { itemIds: [operadorId] } as any),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.kitElectoral.update).not.toHaveBeenCalled();
    });

    it('agrega y quita ítems según el nuevo set (deleteMany + create)', async () => {
      const itemViejoId = '55555555-5555-5555-5555-555555555555';
      const itemNuevoId = '66666666-6666-6666-6666-666666666666';
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(
        kitRow({ itemsContenido: [{ itemId: itemViejoId }] }),
      );
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.itemKitCatalog.count.mockResolvedValueOnce(1);
      prisma.kitElectoral.update.mockResolvedValueOnce(kitRow());

      await service.editar(kitId, { itemIds: [itemNuevoId] } as any);

      expect(prisma.kitElectoral.update).toHaveBeenCalledWith({
        where: { id: kitId },
        data: {
          itemsContenido: {
            deleteMany: { itemId: { in: [itemViejoId] } },
            create: [{ item: { connect: { id: itemNuevoId } } }],
          },
        },
        include: { itemsContenido: { include: { item: true } } },
      });
    });

    it('lanza BadRequestException con frozen:true si el evento ya inició su jornada y no hay justificación', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow({ itemsContenido: [] }));
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(
        eventoRow({ estado: 'ACTIVO', fechaJornada: new Date('2020-01-01') }),
      );
      await expect(
        service.editar(kitId, { recintoId } as any),
      ).rejects.toMatchObject({ response: { frozen: true } });
      expect(prisma.kitElectoral.update).not.toHaveBeenCalled();
    });
  });

  describe('desasignar', () => {
    it('lanza NotFoundException si el kit no existe', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.desasignar(kitId)).rejects.toThrow(NotFoundException);
    });

    it('limpia operador/recinto y vuelve a EN_BODEGA si estaba ASIGNADO', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(
        kitRow({ estado: 'ASIGNADO', operadorId, recintoId }),
      );
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.kitElectoral.update.mockResolvedValueOnce(kitRow({ estado: 'EN_BODEGA' }));

      await service.desasignar(kitId);

      expect(prisma.kitElectoral.update).toHaveBeenCalledWith({
        where: { id: kitId },
        data: { operadorId: null, recintoId: null, estado: 'EN_BODEGA' },
      });
    });

    it('lanza BadRequestException con frozen:true si el evento ya inició su jornada y no hay justificación', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(
        kitRow({ estado: 'ASIGNADO', operadorId, recintoId }),
      );
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(
        eventoRow({ estado: 'ACTIVO', fechaJornada: new Date('2020-01-01') }),
      );
      await expect(service.desasignar(kitId)).rejects.toMatchObject({ response: { frozen: true } });
      expect(prisma.kitElectoral.update).not.toHaveBeenCalled();
    });
  });

  describe('generatePdfQr', () => {
    it('lanza BadRequestException si no se encuentran kits', async () => {
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);
      await expect(service.generatePdfQr({ kitIds: [kitId] } as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('busca los kits con el include de recinto/operador (una sola consulta, sin N+1)', async () => {
      prisma.kitElectoral.findMany.mockResolvedValueOnce([kitRow({ recinto: null, operador: null })]);
      await service.generatePdfQr({ kitIds: [kitId] } as any);
      expect(prisma.kitElectoral.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ include: { recinto: true, operador: true } }),
      );
      // Con la relación real de Prisma ya no hace falta resolver aparte.
      expect(prisma.recinto.findMany).not.toHaveBeenCalled();
      expect(prisma.usuario.findMany).not.toHaveBeenCalled();
    });

    it('genera un PDF (Buffer no vacío) con las etiquetas QR', async () => {
      prisma.kitElectoral.findMany.mockResolvedValueOnce([kitRow({ recinto: null, operador: null })]);
      const pdf = await service.generatePdfQr({ kitIds: [kitId] } as any);
      expect(Buffer.isBuffer(pdf)).toBe(true);
      expect(pdf.length).toBeGreaterThan(0);
    });

    it('genera el PDF cuando el kit trae recinto y operador incluidos', async () => {
      prisma.kitElectoral.findMany.mockResolvedValueOnce([
        kitRow({
          recintoId,
          operadorId,
          estado: 'ASIGNADO',
          recinto: { id: recintoId, codigoRecinto: '28', nombre: 'Escuela Central' },
          operador: { id: operadorId, nombres: 'Juan', apellidos: 'Pérez' },
        }),
      ]);

      const pdf = await service.generatePdfQr({ kitIds: [kitId] } as any);

      expect(Buffer.isBuffer(pdf)).toBe(true);
      expect(pdf.length).toBeGreaterThan(0);
    });
  });

  describe('mapKitsConDatos (etiquetas del PDF)', () => {
    function mapKitsConDatos(kits: any[]) {
      return (service as any).mapKitsConDatos(kits);
    }

    it('arma "código — nombre" para recinto y "nombres apellidos" para operador', () => {
      const [resultado] = mapKitsConDatos([
        kitRow({
          recinto: { id: recintoId, codigoRecinto: '28', nombre: 'Escuela Central' },
          operador: { id: operadorId, nombres: 'Juan', apellidos: 'Pérez' },
        }),
      ]);
      expect(resultado.recintoLabel).toBe('28 — Escuela Central');
      expect(resultado.operadorLabel).toBe('Juan Pérez');
    });

    it('usa null cuando el kit no tiene recinto/operador asignado', () => {
      const [resultado] = mapKitsConDatos([kitRow({ recinto: null, operador: null })]);
      expect(resultado.recintoLabel).toBeNull();
      expect(resultado.operadorLabel).toBeNull();
    });

    it('usa null (sin explotar) si el kit referencia un recinto/operador que ya no existe (FK huérfana)', () => {
      // Con la FK real (onDelete: SetNull) esto ya no puede pasar en la base —
      // pero se prueba igual como red de seguridad ante datos inesperados.
      const [resultado] = mapKitsConDatos([kitRow({ recinto: undefined, operador: undefined })]);
      expect(resultado.recintoLabel).toBeNull();
      expect(resultado.operadorLabel).toBeNull();
    });
  });

  describe('bulkUpload', () => {
    it('lanza BadRequestException si no se envía archivo', async () => {
      await expect(service.bulkUpload(undefined as any, eventoId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza NotFoundException si el evento no existe', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.bulkUpload(csvFile('nombre\nKit A'), eventoId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza BadRequestException si el archivo no tiene filas', async () => {
      // parseRows lanza antes de tocar usuario/recinto/kit, así que solo se consulta el evento.
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      await expect(
        service.bulkUpload(csvFile('nombre,contenidos,cedula_operador,codigo_recinto'), eventoId),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException con frozen:true si el evento ya inició su jornada (sin excepción posible)', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(
        eventoRow({ estado: 'ACTIVO', fechaJornada: new Date('2020-01-01') }),
      );
      await expect(
        service.bulkUpload(csvFile('nombre\nKit A'), eventoId),
      ).rejects.toMatchObject({ response: { frozen: true } });
      expect(prisma.kitElectoral.create).not.toHaveBeenCalled();
    });

    it('crea kits asignados y en bodega, y reporta operador/recinto inexistentes', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.usuario.findMany.mockResolvedValueOnce([{ id: operadorId, cedula: '1002003004' }]);
      prisma.recinto.findMany.mockResolvedValueOnce([{ id: recintoId, codigoRecinto: '28' }]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]); // sin asignaciones previas
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]); // sin recintos ya usados
      prisma.kitElectoral.findUnique.mockResolvedValue(null); // generarCodigoUnico: sin colisión
      prisma.kitElectoral.create.mockResolvedValue(kitRow());

      const csv = [
        'nombre,contenidos,cedula_operador,codigo_recinto',
        'Kit A,Acta,1002003004,28', // asignado
        'Kit B,,,', // bodega
        'Kit C,,9999999999,28', // operador inexistente -> error
        'Kit D,,1002003004,99', // recinto inexistente -> error
      ].join('\n');

      const result = await service.bulkUpload(csvFile(csv), eventoId);

      expect(result.creados).toBe(2);
      expect(result.errores).toHaveLength(2);
      expect(prisma.kitElectoral.create).toHaveBeenCalledTimes(2);
      const estados = prisma.kitElectoral.create.mock.calls.map((c) => c[0].data.estado);
      expect(estados).toContain('ASIGNADO'); // Kit A
      expect(estados).toContain('EN_BODEGA'); // Kit B
    });

    it('reporta error si un operador queda con kits en dos recintos distintos', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.usuario.findMany.mockResolvedValueOnce([{ id: operadorId, cedula: '1002003004' }]);
      prisma.recinto.findMany.mockResolvedValueOnce([
        { id: recintoId, codigoRecinto: '28' },
        { id: '99999999-9999-9999-9999-999999999999', codigoRecinto: '30' },
      ]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]); // sin recintos ya usados
      prisma.kitElectoral.findUnique.mockResolvedValue(null);
      prisma.kitElectoral.create.mockResolvedValue(kitRow());

      const csv = [
        'nombre,contenidos,cedula_operador,codigo_recinto',
        'Kit A,,1002003004,28', // asigna recinto 28
        'Kit B,,1002003004,30', // mismo operador, otro recinto -> error
      ].join('\n');

      const result = await service.bulkUpload(csvFile(csv), eventoId);

      expect(result.creados).toBe(1);
      expect(result.errores).toHaveLength(1);
      expect(result.errores[0].error).toMatch(/otro recinto/i);
    });

    it('reporta error de fila si el recinto ya tiene un kit real en este evento', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.usuario.findMany.mockResolvedValueOnce([{ id: operadorId, cedula: '1002003004' }]);
      prisma.recinto.findMany.mockResolvedValueOnce([{ id: recintoId, codigoRecinto: '28' }]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]); // sin asignaciones previas por operador
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ recintoId }]); // recinto 28 ya usado
      prisma.kitElectoral.findUnique.mockResolvedValue(null);
      prisma.kitElectoral.create.mockResolvedValue(kitRow());

      const csv = ['nombre,cedula_operador,codigo_recinto', 'Kit A,1002003004,28'].join('\n');
      const result = await service.bulkUpload(csvFile(csv), eventoId);

      expect(result.creados).toBe(0);
      expect(result.errores).toHaveLength(1);
      expect(result.errores[0].error).toMatch(/ya tiene un kit asignado/i);
      expect(prisma.kitElectoral.create).not.toHaveBeenCalled();
    });

    it('crea el kit con los ítems del catálogo indicados en la columna items', async () => {
      const itemAId = '55555555-5555-5555-5555-555555555555';
      const itemBId = '66666666-6666-6666-6666-666666666666';
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.usuario.findMany.mockResolvedValueOnce([]);
      prisma.recinto.findMany.mockResolvedValueOnce([]);
      prisma.itemKitCatalog.findMany.mockResolvedValueOnce([
        { id: itemAId, codigo: 'COMPUTADOR' },
        { id: itemBId, codigo: 'MOUSE' },
      ]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]); // sin recintos ya usados
      prisma.kitElectoral.findUnique.mockResolvedValue(null);
      prisma.kitElectoral.create.mockResolvedValue(kitRow());

      const csv = ['nombre,items', 'Kit A,"COMPUTADOR,MOUSE"'].join('\n');
      const result = await service.bulkUpload(csvFile(csv), eventoId);

      expect(result.creados).toBe(1);
      expect(result.errores).toHaveLength(0);
      expect(prisma.kitElectoral.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            itemsContenido: {
              create: [
                { item: { connect: { id: itemAId } }, serie: null, estado: 'BUENO' },
                { item: { connect: { id: itemBId } }, serie: null, estado: 'BUENO' },
              ],
            },
          }),
        }),
      );
    });

    it('reporta error de fila si un código de ítem no existe o está inactivo, sin abortar el resto del archivo', async () => {
      const itemAId = '55555555-5555-5555-5555-555555555555';
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(eventoRow());
      prisma.usuario.findMany.mockResolvedValueOnce([]);
      prisma.recinto.findMany.mockResolvedValueOnce([]);
      prisma.itemKitCatalog.findMany.mockResolvedValueOnce([{ id: itemAId, codigo: 'COMPUTADOR' }]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]); // sin recintos ya usados
      prisma.kitElectoral.findUnique.mockResolvedValue(null);
      prisma.kitElectoral.create.mockResolvedValue(kitRow());

      const csv = [
        'nombre,items',
        'Kit A,NOEXISTE',
        'Kit B,COMPUTADOR',
      ].join('\n');
      const result = await service.bulkUpload(csvFile(csv), eventoId);

      expect(result.creados).toBe(1);
      expect(result.errores).toHaveLength(1);
      expect(result.errores[0].error).toMatch(/ítem de kit no encontrado/i);
      expect(prisma.kitElectoral.create).toHaveBeenCalledTimes(1);
    });
  });
});
