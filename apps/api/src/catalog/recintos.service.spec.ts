import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { RecintosService } from './recintos.service';
import { PrismaService } from '../db/prisma.service';

describe('RecintosService', () => {
  let service: RecintosService;

  const prisma = {
    recinto: {
      count: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    canton: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    militar: { count: jest.fn() },
    eventoElectoral: { findFirst: jest.fn() },
    kitElectoral: { findMany: jest.fn() },
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
  };

  const recintoId = '44444444-4444-4444-4444-444444444444';

  function recintoRow(overrides: Record<string, unknown> = {}) {
    return {
      id: recintoId,
      codigoRecinto: 'R-100',
      nombre: 'Recinto X',
      direccion: null,
      cantonId: 1,
      canton: { nombre: 'Ibarra' },
      parroquia: null,
      zona: null,
      tipo: 'CDA',
      tieneInternet: false,
      coberturaMovil: false,
      numeroElectores: null,
      juntasFemeninas: null,
      juntasMasculinas: null,
      ...overrides,
    };
  }

  const validInput = {
    codigoRecinto: 'R-100',
    nombre: 'Recinto X',
    cantonId: 1,
    tipo: 'CDA' as const,
    latitud: 0.35,
    longitud: -78.11,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((arr: Promise<unknown>[]) => Promise.all(arr));
    prisma.$queryRaw.mockResolvedValue([]); // getCoords sin coords por defecto

    const moduleRef = await Test.createTestingModule({
      providers: [RecintosService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(RecintosService);
  });

  describe('getRecinto', () => {
    it('lanza NotFoundException si el recinto no existe', async () => {
      prisma.recinto.findUnique.mockResolvedValueOnce(null);
      await expect(service.getRecinto(recintoId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('lanza BadRequestException si el cantón no existe', async () => {
      prisma.canton.findUnique.mockResolvedValueOnce(null);
      await expect(service.create(validInput as any)).rejects.toThrow(BadRequestException);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('lanza ConflictException si el código de recinto ya existe', async () => {
      prisma.canton.findUnique.mockResolvedValueOnce({ id: 1 });
      prisma.recinto.findUnique.mockResolvedValueOnce(recintoRow()); // código ocupado
      await expect(service.create(validInput as any)).rejects.toThrow(ConflictException);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('si el código es de un recinto oculto, explica cómo recuperarlo', async () => {
      prisma.canton.findUnique.mockResolvedValueOnce({ id: 1 });
      prisma.recinto.findUnique.mockResolvedValueOnce(recintoRow({ activo: false }));
      await expect(service.create(validInput as any)).rejects.toThrow(/recinto oculto .* Google Sheet/);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('inserta el recinto cuando el cantón existe y el código está libre', async () => {
      prisma.canton.findUnique.mockResolvedValueOnce({ id: 1 });
      prisma.recinto.findUnique
        .mockResolvedValueOnce(null) // código libre
        .mockResolvedValueOnce(recintoRow()); // getRecinto() final
      prisma.$executeRaw.mockResolvedValueOnce(1);

      const result = await service.create(validInput as any);

      expect(result.codigoRecinto).toBe('R-100');
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1); // el INSERT raw
    });
  });

  describe('update', () => {
    it('lanza NotFoundException si el recinto no existe', async () => {
      prisma.recinto.findUnique.mockResolvedValueOnce(null);
      await expect(service.update(recintoId, { nombre: 'X' } as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza ConflictException si el nuevo código ya está en uso', async () => {
      prisma.recinto.findUnique
        .mockResolvedValueOnce(recintoRow({ codigoRecinto: 'R-100' })) // existing
        .mockResolvedValueOnce(recintoRow({ id: 'otro', codigoRecinto: 'R-200' })); // dup del nuevo código
      await expect(service.update(recintoId, { codigoRecinto: 'R-200' } as any)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.recinto.update).not.toHaveBeenCalled();
    });

    it('guarda y devuelve la unidad de contingencia (texto libre; vacía = null)', async () => {
      const conting = { contingenciaNombre: 'UE Alberto Enríquez', contingenciaDireccion: 'Galo Plaza Lasso 10-09' };
      prisma.recinto.findUnique.mockResolvedValueOnce(recintoRow()).mockResolvedValueOnce(recintoRow(conting));
      prisma.recinto.update.mockResolvedValueOnce(recintoRow(conting));

      const result = await service.update(recintoId, { contingenciaNombre: '  UE Alberto Enríquez ', contingenciaDireccion: 'Galo Plaza Lasso 10-09' });

      expect(prisma.recinto.update.mock.calls[0][0].data).toMatchObject(conting);
      expect(result).toMatchObject(conting);

      prisma.recinto.findUnique.mockResolvedValueOnce(recintoRow(conting)).mockResolvedValueOnce(recintoRow());
      await service.update(recintoId, { contingenciaNombre: null, contingenciaDireccion: null });
      expect(prisma.recinto.update.mock.calls[1][0].data).toMatchObject({ contingenciaNombre: null, contingenciaDireccion: null });
    });

    it('al pasar a NO-CDA (o editar un NO-CDA) la contingencia se borra', async () => {
      prisma.recinto.findUnique
        .mockResolvedValueOnce(recintoRow({ tipo: 'NO_CDA' }))
        .mockResolvedValueOnce(recintoRow({ tipo: 'NO_CDA' }));
      prisma.recinto.update.mockResolvedValueOnce(recintoRow());
      await service.update(recintoId, { contingenciaNombre: 'CPE' });
      expect(prisma.recinto.update.mock.calls[0][0].data).toMatchObject({ contingenciaNombre: null, contingenciaDireccion: null });
    });

    it('espacios en blanco cuentan como vacío (null)', async () => {
      prisma.recinto.findUnique.mockResolvedValueOnce(recintoRow()).mockResolvedValueOnce(recintoRow());
      prisma.recinto.update.mockResolvedValueOnce(recintoRow());
      await service.update(recintoId, { contingenciaNombre: '   ', contingenciaDireccion: '' });
      expect(prisma.recinto.update.mock.calls[0][0].data).toMatchObject({ contingenciaNombre: null, contingenciaDireccion: null });
    });

    it('más de 255 caracteres no se acepta', async () => {
      await expect(service.update(recintoId, { contingenciaNombre: 'x'.repeat(256) })).rejects.toThrow();
      expect(prisma.recinto.update).not.toHaveBeenCalled();
    });

    it('sin contingencia en el pedido no la toca', async () => {
      prisma.recinto.findUnique.mockResolvedValueOnce(recintoRow()).mockResolvedValueOnce(recintoRow());
      prisma.recinto.update.mockResolvedValueOnce(recintoRow());
      await service.update(recintoId, { nombre: 'Otro' });
      const data = prisma.recinto.update.mock.calls[0][0].data;
      expect(data.contingenciaNombre).toBeUndefined();
      expect(data.contingenciaDireccion).toBeUndefined();
    });

    it('al crear un CDA guarda también su unidad de contingencia', async () => {
      prisma.canton.findUnique.mockResolvedValueOnce({ id: 1 });
      prisma.recinto.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(recintoRow());
      prisma.$executeRaw.mockResolvedValueOnce(1);
      await service.create({ ...validInput, contingenciaNombre: 'CPE', contingenciaDireccion: '' });
      const valores = prisma.$executeRaw.mock.calls[0].slice(1);
      expect(valores).toEqual(expect.arrayContaining(['CPE', null]));
    });

    it('al crear un NO-CDA la contingencia no se guarda', async () => {
      prisma.canton.findUnique.mockResolvedValueOnce({ id: 1 });
      prisma.recinto.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(recintoRow({ tipo: 'NO_CDA' }));
      prisma.$executeRaw.mockResolvedValueOnce(1);
      await service.create({ ...validInput, tipo: 'NO_CDA', contingenciaNombre: 'CPE' });
      expect(prisma.$executeRaw.mock.calls[0].slice(1)).not.toContain('CPE');
    });

    it('actualiza un recinto existente', async () => {
      prisma.recinto.findUnique
        .mockResolvedValueOnce(recintoRow()) // existing
        .mockResolvedValueOnce(recintoRow({ nombre: 'Recinto Renombrado' })); // getRecinto()
      prisma.recinto.update.mockResolvedValueOnce(recintoRow({ nombre: 'Recinto Renombrado' }));

      const result = await service.update(recintoId, { nombre: 'Recinto Renombrado' } as any);

      expect(result.nombre).toBe('Recinto Renombrado');
      expect(prisma.recinto.update).toHaveBeenCalled();
    });

    describe('cambiar de CDA a NO-CDA', () => {
      beforeEach(() => {
        prisma.eventoElectoral.findFirst.mockResolvedValue({ id: 'ev-1' });
        prisma.kitElectoral.findMany.mockResolvedValue([]);
        prisma.recinto.count.mockResolvedValue(0);
      });

      it('lo bloquea si tiene kits asignados en el evento activo y nombra al operador', async () => {
        prisma.recinto.findUnique.mockResolvedValueOnce(recintoRow());
        prisma.kitElectoral.findMany.mockResolvedValueOnce([{ operador: { nombres: 'Diego', apellidos: 'Leon' } }]);

        const intento = service.update(recintoId, { tipo: 'NO_CDA' } as any);

        await expect(intento).rejects.toThrow(ConflictException);
        await expect(intento).rejects.toThrow(/Diego Leon/);
        expect(prisma.kitElectoral.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { recintoId, eventoId: 'ev-1' } }),
        );
        expect(prisma.recinto.update).not.toHaveBeenCalled();
      });

      it('lo bloquea si hay NO-CDAs que entregan en él', async () => {
        prisma.recinto.findUnique.mockResolvedValueOnce(recintoRow());
        prisma.recinto.count.mockResolvedValueOnce(2);

        await expect(service.update(recintoId, { tipo: 'NO_CDA' } as any)).rejects.toThrow(/2 NO-CDA/);
        expect(prisma.recinto.update).not.toHaveBeenCalled();
      });

      it('lo permite si no tiene kits ni NO-CDAs dependientes', async () => {
        prisma.recinto.findUnique
          .mockResolvedValueOnce(recintoRow())
          .mockResolvedValueOnce(recintoRow({ tipo: 'NO_CDA' }));

        await service.update(recintoId, { tipo: 'NO_CDA' } as any);

        expect(prisma.recinto.update).toHaveBeenCalledWith(
          expect.objectContaining({ data: expect.objectContaining({ tipo: 'NO_CDA' }) }),
        );
      });

      it('no revisa nada al volver de NO-CDA a CDA (es la corrección)', async () => {
        prisma.recinto.findUnique
          .mockResolvedValueOnce(recintoRow({ tipo: 'NO_CDA' }))
          .mockResolvedValueOnce(recintoRow());

        await service.update(recintoId, { tipo: 'CDA' } as any);

        expect(prisma.kitElectoral.findMany).not.toHaveBeenCalled();
        expect(prisma.recinto.update).toHaveBeenCalled();
      });
    });
  });

  describe('listRecintos', () => {
    it('sinCda=true lista los NO-CDA sin CDA destino', async () => {
      prisma.recinto.count.mockResolvedValueOnce(0);
      prisma.recinto.findMany.mockResolvedValueOnce([]);

      await service.listRecintos({ sinCda: 'true' });

      expect(prisma.recinto.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tipo: 'NO_CDA', cdaDestinoId: null }) }),
      );
    });

    it('no lista los recintos ocultos ni los cuenta como NO-CDA de un CDA', async () => {
      prisma.recinto.count.mockResolvedValueOnce(0);
      prisma.recinto.findMany.mockResolvedValueOnce([]);

      await service.listRecintos({ conOrigenes: 'true' });

      expect(prisma.recinto.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ activo: true, origenes: { some: { activo: true } } }),
          include: expect.objectContaining({ _count: { select: { origenes: { where: { activo: true } } } } }),
        }),
      );
    });
  });

  describe('remove', () => {
    it('lanza NotFoundException si el recinto no existe', async () => {
      prisma.recinto.findUnique.mockResolvedValueOnce(null);
      await expect(service.remove(recintoId)).rejects.toThrow(NotFoundException);
    });

    it('lanza ConflictException si el recinto tiene militares asignados', async () => {
      prisma.recinto.findUnique.mockResolvedValueOnce(recintoRow());
      prisma.militar.count.mockResolvedValueOnce(3); // militares
      prisma.recinto.count.mockResolvedValueOnce(0);
      await expect(service.remove(recintoId)).rejects.toThrow(ConflictException);
      expect(prisma.recinto.delete).not.toHaveBeenCalled();
    });

    it('lanza ConflictException si otros recintos lo usan como CDA destino', async () => {
      prisma.recinto.findUnique.mockResolvedValueOnce(recintoRow());
      prisma.militar.count.mockResolvedValueOnce(0);
      prisma.recinto.count.mockResolvedValueOnce(2); // dependientes
      await expect(service.remove(recintoId)).rejects.toThrow(ConflictException);
      expect(prisma.recinto.delete).not.toHaveBeenCalled();
    });

    it('elimina el recinto sin dependencias', async () => {
      prisma.recinto.findUnique.mockResolvedValueOnce(recintoRow());
      prisma.militar.count.mockResolvedValueOnce(0);
      prisma.recinto.count.mockResolvedValueOnce(0);

      const result = await service.remove(recintoId);

      expect(result).toEqual({ deleted: true });
      expect(prisma.recinto.delete).toHaveBeenCalledWith({ where: { id: recintoId } });
    });
  });

  describe('bulkUpload', () => {
    it('lanza BadRequestException si no se envía archivo', async () => {
      await expect(service.bulkUpload(undefined as any)).rejects.toThrow(BadRequestException);
    });

    it('lanza BadRequestException si el formato no es soportado', async () => {
      const file = {
        originalname: 'recintos.txt',
        mimetype: 'text/plain',
        buffer: Buffer.from('x'),
      } as Express.Multer.File;
      await expect(service.bulkUpload(file)).rejects.toThrow(BadRequestException);
    });

    it('crea nuevos, actualiza existentes y reporta cantones inexistentes (CSV)', async () => {
      prisma.canton.findMany.mockResolvedValueOnce([{ id: 1, codigo: '10' }]);
      prisma.recinto.findMany.mockResolvedValueOnce([
        { id: 'rid-exist', codigoRecinto: 'R-EXIST' },
      ]);
      prisma.$executeRaw.mockResolvedValue(1);

      const csv = [
        'codigo_recinto,nombre,canton_codigo,tipo,latitud,longitud',
        'R-NEW,Nuevo,10,CDA,0.35,-78.11', // crear
        'R-EXIST,Existe,10,NO_CDA,0.36,-78.12', // actualizar
        'R-BAD,Malo,99,CDA,0.37,-78.13', // cantón inexistente -> error
      ].join('\n');
      const file = {
        originalname: 'recintos.csv',
        mimetype: 'text/csv',
        buffer: Buffer.from(csv, 'utf8'),
      } as Express.Multer.File;

      const result = await service.bulkUpload(file);

      expect(result.creados).toBe(1);
      expect(result.actualizados).toBe(1);
      expect(result.errores).toHaveLength(1);
    });
  });
});
