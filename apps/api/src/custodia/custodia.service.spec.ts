import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/roles.decorator';
import { CustodiaController, textoBusqueda } from './custodia.controller';
import { CustodiaService } from './custodia.service';

const eventoId = '22222222-2222-2222-2222-222222222222';
const kitId = '33333333-3333-3333-3333-333333333333';
const recintoId = '44444444-4444-4444-4444-444444444444';
const otroRecintoId = '55555555-5555-5555-5555-555555555555';
const militarId = '66666666-6666-6666-6666-666666666666';
const otroMilitarId = '77777777-7777-7777-7777-777777777777';
const operadorId = '88888888-8888-8888-8888-888888888888';
const nuevoOperadorId = '99999999-9999-9999-9999-999999999999';
const asistenteId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function militarRow(id = militarId, rec = recintoId) {
  return { id, cedula: '1002003004', nombres: 'Juan', apellidos: 'Paz', recintoId: rec, recinto: { nombre: 'Escuela' } };
}

function kitRow(overrides: Record<string, unknown> = {}) {
  return { id: kitId, eventoId, codigoUnico: 'ABCD2345', recintoId, operadorId, estado: 'ASIGNADO', ...overrides };
}

describe('CustodiaService', () => {
  let service: CustodiaService;
  let prisma: any;
  let kits: { validarAsignacion: jest.Mock };

  beforeEach(() => {
    prisma = {
      eventoElectoral: {
        findFirst: jest.fn().mockResolvedValue({ id: eventoId }),
        findUnique: jest.fn().mockResolvedValue({ estado: 'ACTIVO' }),
      },
      kitElectoral: {
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      militar: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn() },
      entregaCustodioKit: {
        findUnique: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      correccionCustodiaKit: { create: jest.fn() },
      usuario: {
        findUnique: jest.fn().mockResolvedValue({ nombres: 'Jairo', apellidos: 'Leal' }),
        findUniqueOrThrow: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      // Transacción interactiva: el callback recibe el mismo cliente mockeado.
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    kits = { validarAsignacion: jest.fn().mockResolvedValue({}) };
    service = new CustodiaService(prisma, kits as any);
  });

  /** entregaDto: la entrega guardada, con su militar. */
  function entregaGuardada(militar = militarRow(), deOtro = false) {
    return {
      kitId,
      militarId: militar.id,
      entregadoPorId: asistenteId,
      entregadoEn: new Date('2026-11-16T07:00:00Z'),
      militarDeOtroRecinto: deOtro,
      militar,
    };
  }

  describe('validarKit', () => {
    it('busca el código en mayúsculas en el evento activo y propone los militares del recinto', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({
        ...kitRow(),
        nombre: '28 — Escuela',
        recinto: { id: recintoId, codigoRecinto: '28', nombre: 'Escuela' },
        operador: { id: operadorId, cedula: '1', nombres: 'Ana', apellidos: 'Pérez' },
      });
      prisma.militar.findMany.mockResolvedValueOnce([militarRow()]);
      prisma.entregaCustodioKit.findUnique.mockResolvedValueOnce(null);

      const r = await service.validarKit(' abcd2345 ');

      expect(prisma.kitElectoral.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { eventoId_codigoUnico: { eventoId, codigoUnico: 'ABCD2345' } } }),
      );
      expect(prisma.militar.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { recintoId } }));
      expect(r).toEqual(
        expect.objectContaining({
          editable: true,
          entrega: null,
          militaresRecinto: [expect.objectContaining({ id: militarId, recintoNombre: 'Escuela' })],
        }),
      );
    });

    it('lanza NotFound si el kit no está en el evento activo', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.validarKit('NOPE')).rejects.toThrow(NotFoundException);
    });
  });

  describe('registrarEntrega', () => {
    it('registra la entrega con el militar del recinto', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow());
      prisma.militar.findUnique.mockResolvedValueOnce(militarRow());
      prisma.entregaCustodioKit.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(entregaGuardada());

      const r = await service.registrarEntrega(asistenteId, { kitId, militarId });

      expect(prisma.entregaCustodioKit.create).toHaveBeenCalledWith({
        data: { kitId, eventoId, militarId, entregadoPorId: asistenteId, militarDeOtroRecinto: false },
      });
      expect(r.entregadoPorNombre).toBe('Jairo Leal');
    });

    it('un militar de otro recinto queda marcado', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow());
      prisma.militar.findUnique.mockResolvedValueOnce(militarRow(otroMilitarId, otroRecintoId));
      prisma.entregaCustodioKit.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(entregaGuardada(militarRow(otroMilitarId, otroRecintoId), true));

      await service.registrarEntrega(asistenteId, { kitId, militarId: otroMilitarId });

      expect(prisma.entregaCustodioKit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ militarDeOtroRecinto: true }),
      });
    });

    it('repetir con el mismo militar es idempotente; con otro militar es 409', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValue(kitRow());
      prisma.militar.findUnique.mockResolvedValueOnce(militarRow());
      prisma.entregaCustodioKit.findUnique.mockResolvedValue(entregaGuardada());

      await service.registrarEntrega(asistenteId, { kitId, militarId });
      expect(prisma.entregaCustodioKit.create).not.toHaveBeenCalled();

      prisma.militar.findUnique.mockResolvedValueOnce(militarRow(otroMilitarId));
      await expect(service.registrarEntrega(asistenteId, { kitId, militarId: otroMilitarId })).rejects.toThrow(
        ConflictException,
      );
    });

    it('si dos registros chocan (P2002), el perdedor responde como reintento o con 409, no con 500', async () => {
      const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      prisma.kitElectoral.findUnique.mockResolvedValue(kitRow());
      prisma.militar.findUnique.mockResolvedValueOnce(militarRow());
      prisma.entregaCustodioKit.create.mockRejectedValueOnce(p2002);
      // 1) no había entrega; 2) la del ganador (mismo militar); 3) entregaDto
      prisma.entregaCustodioKit.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(entregaGuardada())
        .mockResolvedValueOnce(entregaGuardada());

      const r = await service.registrarEntrega(asistenteId, { kitId, militarId });
      expect(r.militar.id).toBe(militarId);

      prisma.militar.findUnique.mockResolvedValueOnce(militarRow(otroMilitarId));
      prisma.entregaCustodioKit.create.mockRejectedValueOnce(p2002);
      prisma.entregaCustodioKit.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(entregaGuardada());
      await expect(service.registrarEntrega(asistenteId, { kitId, militarId: otroMilitarId })).rejects.toThrow(
        ConflictException,
      );
    });

    it('si el CDA recibe el kit mientras se registra la entrega, la transacción se revierte con 409', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow());
      prisma.militar.findUnique.mockResolvedValueOnce(militarRow());
      prisma.entregaCustodioKit.findUnique.mockResolvedValueOnce(null);
      prisma.kitElectoral.count.mockResolvedValueOnce(0);

      await expect(service.registrarEntrega(asistenteId, { kitId, militarId })).rejects.toThrow(/acaba de recibir/);
    });

    it('si el CDA ya recibió el kit (o no tiene operador) no se puede registrar', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow({ estado: 'ENTREGADO' }));
      await expect(service.registrarEntrega(asistenteId, { kitId, militarId })).rejects.toThrow(
        /ya recibió este kit/,
      );
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow({ estado: 'EN_BODEGA' }));
      await expect(service.registrarEntrega(asistenteId, { kitId, militarId })).rejects.toThrow(
        /no tiene un operador/,
      );
    });

    it('un kit de un evento que no está activo se rechaza', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow());
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce({ estado: 'CERRADO' });
      await expect(service.registrarEntrega(asistenteId, { kitId, militarId })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('corregirMilitar', () => {
    const input = { militarId: otroMilitarId, motivo: 'El militar asignado fue reemplazado' };

    it('cambia el militar y guarda la corrección con el valor anterior y el motivo', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow());
      prisma.entregaCustodioKit.findUnique
        .mockResolvedValueOnce(entregaGuardada())
        .mockResolvedValueOnce(entregaGuardada(militarRow(otroMilitarId, otroRecintoId), true));
      prisma.militar.findUnique.mockResolvedValueOnce(militarRow(otroMilitarId, otroRecintoId));

      await service.corregirMilitar(asistenteId, ['ASISTENTE_TRANSVERSAL'], kitId, input);

      // Condicional al militar leído: si otra corrección ganó, no pisa nada.
      expect(prisma.entregaCustodioKit.updateMany).toHaveBeenCalledWith({
        where: { kitId, militarId },
        data: { militarId: otroMilitarId, militarDeOtroRecinto: true },
      });
      expect(prisma.correccionCustodiaKit.create).toHaveBeenCalledWith({
        data: {
          kitId,
          campo: 'MILITAR',
          valorAnterior: militarId,
          valorNuevo: otroMilitarId,
          motivo: input.motivo,
          corregidoPorId: asistenteId,
        },
      });
    });

    it('si otra corrección cambió el militar antes, es 409 y no se escribe historial', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow());
      prisma.entregaCustodioKit.findUnique.mockResolvedValueOnce(entregaGuardada());
      prisma.militar.findUnique.mockResolvedValueOnce(militarRow(otroMilitarId));
      prisma.entregaCustodioKit.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        service.corregirMilitar(asistenteId, ['ASISTENTE_TRANSVERSAL'], kitId, input),
      ).rejects.toThrow(ConflictException);
      expect(prisma.correccionCustodiaKit.create).not.toHaveBeenCalled();
    });

    it('si el CDA recibe el kit durante la corrección, el asistente recibe 400 dentro de la transacción', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow());
      prisma.entregaCustodioKit.findUnique.mockResolvedValueOnce(entregaGuardada());
      prisma.militar.findUnique.mockResolvedValueOnce(militarRow(otroMilitarId));
      prisma.kitElectoral.count.mockResolvedValueOnce(0);

      await expect(
        service.corregirMilitar(asistenteId, ['ASISTENTE_TRANSVERSAL'], kitId, input),
      ).rejects.toThrow(/solo un administrador/);
      expect(prisma.entregaCustodioKit.updateMany).not.toHaveBeenCalled();
    });

    it('después de que el CDA recibió el kit solo el administrador corrige', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow({ estado: 'ENTREGADO' }));
      await expect(
        service.corregirMilitar(asistenteId, ['ASISTENTE_TRANSVERSAL'], kitId, input),
      ).rejects.toThrow(/solo un administrador/);

      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow({ estado: 'ENTREGADO' }));
      prisma.entregaCustodioKit.findUnique.mockResolvedValue(entregaGuardada());
      prisma.militar.findUnique.mockResolvedValueOnce(militarRow(otroMilitarId));
      await service.corregirMilitar('admin', ['ADMINISTRADOR'], kitId, input);
      expect(prisma.correccionCustodiaKit.create).toHaveBeenCalled();
    });

    it('sin entrega previa o con el mismo militar es 400', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValue(kitRow());
      prisma.entregaCustodioKit.findUnique.mockResolvedValueOnce(null);
      await expect(
        service.corregirMilitar(asistenteId, ['ASISTENTE_TRANSVERSAL'], kitId, input),
      ).rejects.toThrow(/aún no tiene una entrega/);

      prisma.entregaCustodioKit.findUnique.mockResolvedValueOnce(entregaGuardada());
      prisma.militar.findUnique.mockResolvedValueOnce(militarRow());
      await expect(
        service.corregirMilitar(asistenteId, ['ASISTENTE_TRANSVERSAL'], kitId, { ...input, militarId }),
      ).rejects.toThrow(/ya es el registrado/);
    });

    it('exige un motivo de al menos 5 caracteres', async () => {
      await expect(
        service.corregirMilitar(asistenteId, ['ASISTENTE_TRANSVERSAL'], kitId, { ...input, motivo: ' ok ' }),
      ).rejects.toThrow();
      expect(prisma.kitElectoral.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('cambiarOperador', () => {
    const input = { operadorId: nuevoOperadorId, motivo: 'La operadora asignada no se presentó' };

    it('reasigna con las reglas de kits (motivo como justificación) y guarda la corrección', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow());
      prisma.usuario.findUniqueOrThrow.mockResolvedValueOnce({
        id: nuevoOperadorId,
        cedula: '2',
        nombres: 'Luis',
        apellidos: 'Mora',
      });

      const r = await service.cambiarOperador(asistenteId, kitId, input);

      expect(kits.validarAsignacion).toHaveBeenCalledWith(kitId, nuevoOperadorId, input.motivo);
      // Condicional: sigue ASIGNADO y con el operador que se leyó.
      expect(prisma.kitElectoral.updateMany).toHaveBeenCalledWith({
        where: { id: kitId, estado: 'ASIGNADO', operadorId },
        data: { operadorId: nuevoOperadorId },
      });
      expect(prisma.correccionCustodiaKit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ campo: 'OPERADOR', valorAnterior: operadorId, valorNuevo: nuevoOperadorId }),
      });
      expect(r).toEqual({ id: nuevoOperadorId, cedula: '2', nombres: 'Luis', apellidos: 'Mora' });
    });

    it('si la asignación falla (p. ej. operador de otro recinto) no guarda corrección', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow());
      kits.validarAsignacion.mockRejectedValueOnce(new ConflictException('otro recinto'));

      await expect(service.cambiarOperador(asistenteId, kitId, input)).rejects.toThrow(ConflictException);
      expect(prisma.kitElectoral.updateMany).not.toHaveBeenCalled();
      expect(prisma.correccionCustodiaKit.create).not.toHaveBeenCalled();
    });

    it('si el kit cambió o lo recibió el CDA entre la lectura y la escritura, es 409 sin historial', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow());
      prisma.kitElectoral.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.cambiarOperador(asistenteId, kitId, input)).rejects.toThrow(/cambió mientras/);
      expect(prisma.correccionCustodiaKit.create).not.toHaveBeenCalled();
    });

    it('no se puede cambiar si el CDA ya recibió el kit, ni por el mismo operador', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow({ estado: 'ENTREGADO' }));
      await expect(service.cambiarOperador(asistenteId, kitId, input)).rejects.toThrow(BadRequestException);

      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kitRow());
      await expect(
        service.cambiarOperador(asistenteId, kitId, { ...input, operadorId }),
      ).rejects.toThrow(/ya es el asignado/);
      expect(kits.validarAsignacion).not.toHaveBeenCalled();
    });
  });

  describe('búsquedas', () => {
    it('con menos de 2 caracteres no consulta', async () => {
      expect(await service.buscarMilitares(' a ')).toEqual([]);
      expect(await service.buscarOperadores('')).toEqual([]);
      expect(prisma.militar.findMany).not.toHaveBeenCalled();
      expect(prisma.usuario.findMany).not.toHaveBeenCalled();
    });

    it('busca militares de cualquier recinto (sin filtro de recinto) con límite', async () => {
      prisma.militar.findMany.mockResolvedValueOnce([militarRow(otroMilitarId, otroRecintoId)]);
      const r = await service.buscarMilitares('paz');
      expect(prisma.militar.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20, where: { OR: expect.any(Array) } }),
      );
      expect(r[0].recintoId).toBe(otroRecintoId);
    });

    it('solo operadores CDA activos', async () => {
      await service.buscarOperadores('pérez');
      expect(prisma.usuario.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ activo: true, roles: { some: { rol: { nombre: 'OPERADOR_CDA' } } } }),
        }),
      );
    });
  });
});

describe('textoBusqueda', () => {
  it('solo acepta un texto (un ?buscar= repetido llega como arreglo) y lo recorta a 60', () => {
    expect(textoBusqueda('paz')).toBe('paz');
    expect(textoBusqueda(['a', 'b'])).toBe('');
    expect(textoBusqueda(undefined)).toBe('');
    expect(textoBusqueda('x'.repeat(80))).toHaveLength(60);
  });
});

describe('CustodiaController — roles', () => {
  it('todo el controlador es solo para el asistente transversal y el administrador', () => {
    expect(new Reflector().get(ROLES_KEY, CustodiaController)).toEqual(['ASISTENTE_TRANSVERSAL', 'ADMINISTRADOR']);
  });
});
