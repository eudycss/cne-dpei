import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';

import { ParejasCdaService } from './parejas-cda.service';
import * as reporteParejasModulo from './reporte-parejas-cda';
import { PrismaService } from '../db/prisma.service';
import { CuentasCdaService } from './cuentas-cda.service';
import { KitsService } from '../kits/kits.service';

const DIA = '2026-10-30';
const FECHA = new Date(`${DIA}T00:00:00Z`);
const EVENTO = { id: 'ev2', nombre: 'Prueba Técnica 2' };
const RECINTO = { id: 'r1', codigoRecinto: '957', nombre: 'UE ATAHUALPA', canton: { nombre: 'COTACACHI' } };
const OPERADOR = { id: 'op1', apellidosNombres: 'PÉREZ ANA', cedula: '1710034065', telefono: null, usuarioId: 'u1', activo: true, grupo: 'OPERADOR' };
const ASISTENTE = { id: 'as1', apellidosNombres: 'RUIZ JUAN', cedula: '1713175071', telefono: null, usuarioId: 'u2', activo: true, grupo: 'ASISTENTE' };

function pareja(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    fecha: FECHA,
    recintoId: RECINTO.id,
    operadorCdaId: OPERADOR.id,
    asistenteCdaId: ASISTENTE.id,
    kitId: null,
    articulos: null,
    creadoEn: new Date('2026-10-29T10:00:00Z'),
    recinto: RECINTO,
    operador: OPERADOR,
    asistente: ASISTENTE,
    kit: null,
    ...over,
  };
}

async function plantilla(filas: Record<string, string>[]): Promise<Express.Multer.File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Parejas');
  const cols = ['cedula_operador', 'nombre_operador', 'telefono_operador', 'cedula_asistente', 'nombre_asistente', 'telefono_asistente', 'codigo_recinto', 'articulos'];
  ws.addRow(cols);
  for (const f of filas) ws.addRow(cols.map((c) => f[c] ?? ''));
  const buffer = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  return { originalname: 'parejas.xlsx', buffer } as Express.Multer.File;
}

describe('ParejasCdaService', () => {
  let service: ParejasCdaService;

  const prisma = {
    parejaCda: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
    },
    operadorCda: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    recinto: { findMany: jest.fn(), findUnique: jest.fn() },
    eventoElectoral: { findFirst: jest.fn(), findUnique: jest.fn() },
    kitElectoral: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(), delete: jest.fn() },
    itemKitCatalog: { findMany: jest.fn() },
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const cuentas = {
    asegurarCuenta: jest.fn().mockResolvedValue('CREADA'),
    hashInicial: jest.fn().mockResolvedValue('hash'),
    crearOVincular: jest.fn().mockResolvedValue('CREADA'),
  };
  const kits = {
    create: jest.fn().mockResolvedValue({ id: 'kNuevo' }),
    asignar: jest.fn().mockResolvedValue({}),
    quitarOperador: jest.fn().mockResolvedValue(undefined),
    estaCongelado: jest.fn().mockReturnValue(false),
    generatePdfQr: jest.fn().mockResolvedValue(Buffer.from('%PDF')),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // clearAllMocks no borra las respuestas "Once" que una prueba no usó: no deben pasar a la siguiente.
    for (const fn of [prisma.parejaCda.findMany, prisma.parejaCda.findUnique, prisma.kitElectoral.findFirst, prisma.kitElectoral.findMany]) fn.mockReset();
    kits.estaCongelado.mockReturnValue(false);
    prisma.parejaCda.findMany.mockResolvedValue([]);
    prisma.operadorCda.findMany.mockResolvedValue([]);
    prisma.recinto.findMany.mockResolvedValue([]);
    prisma.itemKitCatalog.findMany.mockResolvedValue([
      { id: 'iLap', codigo: 'LAP' },
      { id: 'iMod', codigo: 'MOD' },
    ]);
    prisma.eventoElectoral.findFirst.mockResolvedValue(EVENTO);
    prisma.kitElectoral.findFirst.mockResolvedValue(null);
    prisma.kitElectoral.findMany.mockResolvedValue([]);
    prisma.kitElectoral.delete.mockResolvedValue({});
    prisma.parejaCda.findFirst.mockResolvedValue(null);
    prisma.parejaCda.updateMany.mockResolvedValue({ count: 1 });
    prisma.parejaCda.count.mockResolvedValue(0);
    const moduleRef = await Test.createTestingModule({
      providers: [
        ParejasCdaService,
        { provide: PrismaService, useValue: prisma },
        { provide: CuentasCdaService, useValue: cuentas },
        { provide: KitsService, useValue: kits },
      ],
    }).compile();
    service = moduleRef.get(ParejasCdaService);
  });

  describe('listarConIngreso (reporte por técnico)', () => {
    it('quién tiene de verdad el kit: el operador, el asistente, otra persona o nadie', async () => {
      const kit = (operadorId: string | null, eventoId = 'ev2') => ({ codigoUnico: 'K', eventoId, operadorId, estado: 'ASIGNADO' });
      const otroRecinto = (id: string, codigo: string) => ({ id, recintoId: id, recinto: { ...RECINTO, id, codigoRecinto: codigo } });
      prisma.parejaCda.findMany.mockResolvedValue([
        pareja({ kitId: 'k1', kit: kit('u1') }),
        pareja({ ...otroRecinto('r2', '2'), kitId: 'k2', kit: kit('u2') }),
        pareja({ ...otroRecinto('r3', '3'), kitId: 'k3', kit: kit('u9') }),
        pareja({ ...otroRecinto('r4', '4'), kitId: 'k4', kit: kit(null) }),
        pareja({ ...otroRecinto('r5', '5'), kitId: 'k5', kit: kit('u1', 'evViejo') }),
        pareja({ ...otroRecinto('r6', '6') }),
      ]);

      const { dia, filas } = await service.listarConIngreso(DIA);

      expect(dia.evento).toEqual(EVENTO);
      expect(Object.fromEntries(filas.map((f) => [f.pareja.recinto.codigo, f.ingresa]))).toEqual({
        '957': 'OPERADOR',
        '2': 'ASISTENTE',
        '3': 'OTRA',
        '4': null,
        // El kit de otro evento no cuenta.
        '5': null,
        '6': null,
      });

      expect(filas.find((f) => f.pareja.recinto.codigo === '957')?.lleva?.apellidosNombres).toBe('PÉREZ ANA');

      // Sin evento activo de ese día, nadie ingresa todavía.
      prisma.eventoElectoral.findFirst.mockResolvedValue(null);
      const sinEvento = await service.listarConIngreso(DIA);
      expect(sinEvento.filas.every((f) => f.ingresa === null)).toBe(true);
    });
  });

  it('listarConIngreso: el kit de una pareja lo lleva alguien de la otra pareja del recinto (caso 6116: la 1.ª sin Android)', async () => {
    const HERRERA = { ...OPERADOR, id: 'op9', apellidosNombres: 'HERRERA PAULA', usuarioId: 'u9' };
    prisma.parejaCda.findMany.mockResolvedValue([
      pareja({ kitId: 'k1', kit: { codigoUnico: 'K', eventoId: 'ev2', operadorId: 'u9', estado: 'ASIGNADO' } }),
      pareja({ id: 'p2', operadorCdaId: 'op9', operador: HERRERA, asistente: null, creadoEn: new Date('2026-10-29T11:00:00Z') }),
    ]);

    const { filas } = await service.listarConIngreso(DIA);
    const de = (id: string) => filas.find((f) => f.pareja.id === id)!;

    expect(de('p1')).toMatchObject({ ingresa: 'RECINTO', lleva: { apellidosNombres: 'HERRERA PAULA' } });
    // La 2.ª pareja no tiene kit propio, pero su integrante lleva el del recinto.
    expect(de('p2')).toMatchObject({ ingresa: null, lleva: { apellidosNombres: 'HERRERA PAULA' } });
    expect(JSON.stringify(filas)).not.toContain('usuarioId');
  });

  describe('listar', () => {
    it('busca el evento ACTIVO cuya jornada es ese día', async () => {
      await service.listar(DIA);
      expect(prisma.eventoElectoral.findFirst.mock.calls[0][0].where).toEqual({ estado: 'ACTIVO', fechaJornada: FECHA });
      expect(prisma.parejaCda.findMany.mock.calls[0][0].where).toEqual({ fecha: FECHA, recintoId: { not: null } });
    });

    it('estados: cada pareja del recinto va con su propio kit (ninguna queda solo registrada) y dice cuántas van', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ kitId: 'k1', kit: { codigoUnico: 'KIT-1', eventoId: 'ev2', operadorId: 'u1' } }),
        pareja({ id: 'p2', operadorCdaId: 'op2', operador: { ...OPERADOR, id: 'op2', usuarioId: 'u3' }, asistente: null, creadoEn: new Date('2026-10-29T11:00:00Z') }),
        pareja({ id: 'p3', recintoId: 'r2', recinto: { id: 'r2', codigoRecinto: '1126', nombre: 'UE B' }, operador: { ...OPERADOR, id: 'op3' } }),
      ]);

      const r = await service.listar(DIA);

      expect(r.evento).toEqual(EVENTO);
      expect(r.congelado).toBe(false);
      expect(r.parejas.map((p) => [p.id, p.estado, p.parejasEnRecinto])).toEqual([
        ['p1', 'EN_APP', 2],
        ['p2', 'SIN_KIT', 2],
        ['p3', 'SIN_KIT', 1],
      ]);
      expect(r.parejas[0]).toMatchObject({ fecha: DIA, kitCodigo: 'KIT-1', recinto: { codigo: '957', nombre: 'UE ATAHUALPA', canton: 'COTACACHI' } });
      expect(r.parejas[1]).toMatchObject({ asistente: null, portador: { id: 'op2' } });
    });

    it('tres parejas en un recinto: cada una lleva su kit con su propia persona de Android (no se presta de otra pareja)', async () => {
      const conAndroid = (o: Record<string, unknown>) => ({ ...o, dispositivo: 'ANDROID' });
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        // Sin Android en la pareja: lo lleva su operador aunque otra pareja del recinto tenga Android.
        pareja({ id: 'pA', asistente: null, creadoEn: new Date('2026-10-29T09:00:00Z') }),
        pareja({ id: 'pB', operadorCdaId: 'op2', operador: conAndroid({ ...OPERADOR, id: 'op2', usuarioId: 'u3' }), asistenteCdaId: 'as2', asistente: conAndroid({ ...ASISTENTE, id: 'as2', usuarioId: 'u4' }) }),
        pareja({ id: 'pC', operadorCdaId: 'op3', operador: { ...OPERADOR, id: 'op3', usuarioId: 'u5' }, asistenteCdaId: 'as3', asistente: conAndroid({ ...ASISTENTE, id: 'as3', usuarioId: 'u6' }) }),
      ]);

      const r = await service.listar(DIA);

      expect(r.parejas.map((p) => [p.id, p.portador?.id, p.parejasEnRecinto])).toEqual([
        ['pA', 'op1', 3],
        ['pB', 'op2', 3],
        ['pC', 'as3', 3],
      ]);
      expect(r.parejas.every((p) => p.estado === 'SIN_KIT')).toBe(true);
    });

    it('sin evento activo de esa fecha: la lista queda pendiente', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(null);
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja()]);
      const r = await service.listar(DIA);
      expect(r.evento).toBeNull();
      expect(r.parejas[0].estado).toBe('PENDIENTE_EVENTO');
    });

    it('devuelve los CDA activos que no tienen pareja ese día, sin contar los que ya la tienen', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja()]);
      prisma.recinto.findMany.mockResolvedValueOnce([{ id: 'r9', codigoRecinto: '1126', nombre: 'UE VACÍA' }]);

      const r = await service.listar(DIA);

      expect(prisma.recinto.findMany.mock.calls[0][0].where).toEqual({ tipo: 'CDA', activo: true, id: { notIn: [RECINTO.id] } });
      expect(r.recintosSinPareja).toEqual([{ id: 'r9', codigo: '1126', nombre: 'UE VACÍA' }]);
    });

    it('un día sin parejas lista todos los CDA activos', async () => {
      prisma.recinto.findMany.mockResolvedValueOnce([{ id: 'r1', codigoRecinto: '957', nombre: 'UE ATAHUALPA' }]);

      const r = await service.listar(DIA);

      expect(prisma.recinto.findMany.mock.calls[0][0].where).toEqual({ tipo: 'CDA', activo: true, id: { notIn: [] } });
      expect(r.recintosSinPareja).toHaveLength(1);
    });
  });

  it('listar avisa si las asignaciones del evento de ese día ya están congeladas (jornada iniciada)', async () => {
    kits.estaCongelado.mockReturnValue(true);
    const r = await service.listar(DIA);
    expect(kits.estaCongelado).toHaveBeenCalledWith({ estado: 'ACTIVO', fechaJornada: FECHA });
    expect(r.congelado).toBe(true);
  });

  describe('disponibles', () => {
    it('por defecto oculta a quien ya fue cualquier día y los recintos ya usados', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        { fecha: new Date('2026-10-28T00:00:00Z'), operadorCdaId: 'opViejo', asistenteCdaId: 'asViejo', recintoId: 'rViejo' },
        { fecha: FECHA, operadorCdaId: 'opHoy', asistenteCdaId: null, recintoId: 'rHoy' },
      ]);
      await service.disponibles(DIA, false);

      expect(prisma.parejaCda.findMany.mock.calls[0][0].where).toEqual({});
      const [ops, asis] = prisma.operadorCda.findMany.mock.calls.map(([a]) => a.where);
      expect(ops).toEqual({ grupo: 'OPERADOR', activo: true, id: { notIn: expect.arrayContaining(['opViejo', 'asViejo', 'opHoy']) } });
      expect(asis.grupo).toBe('ASISTENTE');
      expect(prisma.recinto.findMany.mock.calls[0][0].where).toEqual({
        tipo: 'CDA',
        activo: true,
        id: { notIn: expect.arrayContaining(['rViejo', 'rHoy']) },
      });
    });

    it('"Usar todos": solo oculta a quien ya tiene pareja ese mismo día; los recintos se repiten', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([{ fecha: FECHA, operadorCdaId: 'opHoy', asistenteCdaId: 'asHoy', recintoId: 'rHoy' }]);
      await service.disponibles(DIA, true);

      expect(prisma.parejaCda.findMany.mock.calls[0][0].where).toEqual({ fecha: FECHA });
      expect(prisma.operadorCda.findMany.mock.calls[0][0].where.id).toEqual({ notIn: ['opHoy', 'asHoy'] });
      expect(prisma.recinto.findMany.mock.calls[0][0].where).toEqual({ tipo: 'CDA', activo: true });
    });
  });

  describe('crear', () => {
    beforeEach(() => {
      prisma.operadorCda.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === 'op1'
            ? { ...OPERADOR, grupo: 'OPERADOR', activo: true }
            : where.id === 'as1'
              ? { ...ASISTENTE, grupo: 'ASISTENTE', activo: true }
              : where.id === 'op2'
                ? { id: 'op2', grupo: 'OPERADOR', activo: true }
                : where.id === 'as2'
                  ? { id: 'as2', grupo: 'ASISTENTE', activo: true }
                  : where.id === 'dig1'
                ? { id: 'dig1', grupo: 'DIGITADOR', activo: true }
                : null,
        ),
      );
      prisma.recinto.findUnique.mockResolvedValue({ ...RECINTO, activo: true, tipo: 'CDA' });
      prisma.parejaCda.create.mockResolvedValue({ id: 'p1' });
    });

    it('cada pareja es un Operador y un Asistente CDA (el asistente es opcional)', async () => {
      await service.crear({ fecha: DIA, operadorCdaId: 'op1', asistenteCdaId: 'as1', recintoId: 'r1' }, 'admin');
      await service.crear({ fecha: DIA, operadorCdaId: 'op2', recintoId: 'r1' }, 'admin');
      expect(prisma.parejaCda.create.mock.calls.map((c) => [c[0].data.operadorCdaId, c[0].data.asistenteCdaId])).toEqual([
        ['op1', 'as1'],
        ['op2', null],
      ]);
    });

    it.each([
      ['dos operadores', 'op1', 'op2', 'como asistente es de Operadores CDA, no de Asistentes CDA'],
      ['dos asistentes', 'as1', 'as2', 'como operador es de Asistentes CDA, no de Operadores CDA'],
      ['los cargos al revés', 'as1', 'op1', 'como operador es de Asistentes CDA, no de Operadores CDA'],
      ['otro cargo', 'op1', 'dig1', 'como asistente es de Digitadores, no de Asistentes CDA'],
    ])('no permite %s', async (_caso, operadorCdaId, asistenteCdaId, mensaje) => {
      await expect(service.crear({ fecha: DIA, operadorCdaId, asistenteCdaId, recintoId: 'r1' }, 'admin')).rejects.toThrow(mensaje);
      expect(prisma.parejaCda.create).not.toHaveBeenCalled();
    });

    it('la 2.ª pareja de un recinto sigue la misma regla', async () => {
      prisma.parejaCda.findMany.mockResolvedValue([pareja()]);
      await expect(
        service.crear({ fecha: DIA, operadorCdaId: 'as2', asistenteCdaId: 'op2', recintoId: 'r1' }, 'admin'),
      ).rejects.toThrow('cada pareja es un Operador y un Asistente CDA');
      expect(prisma.parejaCda.create).not.toHaveBeenCalled();
    });

    it('la misma persona no puede ir dos veces en la pareja', async () => {
      await expect(
        service.crear({ fecha: DIA, operadorCdaId: 'op1', asistenteCdaId: 'op1', recintoId: 'r1' }, 'admin'),
      ).rejects.toThrow('Elija dos personas distintas');
      expect(prisma.parejaCda.create).not.toHaveBeenCalled();
    });

    it('nadie está en dos parejas el mismo día, aunque en una pareja anterior vaya en la otra columna', async () => {
      prisma.parejaCda.findFirst.mockResolvedValueOnce({ operadorCdaId: 'as2', asistenteCdaId: 'asX' });
      await expect(
        service.crear({ fecha: DIA, operadorCdaId: 'op1', asistenteCdaId: 'as2', recintoId: 'r1' }, 'admin'),
      ).rejects.toThrow(new ConflictException('El asistente ya tiene pareja el 2026-10-30'));
      expect(prisma.parejaCda.findFirst.mock.calls[0][0].where).toEqual({
        fecha: FECHA,
        OR: [{ operadorCdaId: { in: ['op1', 'as2'] } }, { asistenteCdaId: { in: ['op1', 'as2'] } }],
      });
      expect(prisma.parejaCda.create).not.toHaveBeenCalled();
    });

    it('si la persona ya tiene pareja ese día responde 409 con un mensaje claro', async () => {
      prisma.parejaCda.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: 'uq_parejas_cda_fecha_operador' } }),
      );
      await expect(service.crear({ fecha: DIA, operadorCdaId: 'op1', recintoId: 'r1' }, 'admin')).rejects.toThrow(
        new ConflictException('Ese operador ya tiene pareja el 2026-10-30'),
      );
    });

    it('con evento activo de esa fecha: crea el kit del recinto con los artículos y lo asigna al operador', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja({ articulos: 'LAP:123, MOD' })]);

      const r = await service.crear({ fecha: DIA, operadorCdaId: 'op1', asistenteCdaId: 'as1', recintoId: 'r1', articulos: 'LAP:123, MOD' }, 'admin');

      expect(prisma.parejaCda.create.mock.calls[0][0].data).toEqual({
        fecha: FECHA,
        operadorCdaId: 'op1',
        asistenteCdaId: 'as1',
        recintoId: 'r1',
        articulos: 'LAP:123, MOD',
        creadoPorId: 'admin',
      });
      expect(kits.create).toHaveBeenCalledWith({
        eventoId: 'ev2',
        nombre: '957 — UE ATAHUALPA',
        recintoId: 'r1',
        otroDispositivo: true,
        detalleItems: [
          { itemId: 'iLap', serie: '123' },
          { itemId: 'iMod', serie: null },
        ],
      });
      expect(kits.asignar).toHaveBeenCalledWith('kNuevo', { operadorId: 'u1' });
      expect(prisma.parejaCda.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', kitId: null }, data: { kitId: 'kNuevo' } });
      expect(r).toEqual({ enApp: 1, kitsCreados: 1, sinKit: 0, errores: [] });
    });

    it('jornada iniciada: con justificación la pasa a la asignación; sin ella no crea el kit y lo explica', async () => {
      kits.estaCongelado.mockReturnValue(true);
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja({ articulos: 'LAP' })]);
      const sin = await service.crear({ fecha: DIA, operadorCdaId: 'op1', recintoId: 'r1', articulos: 'LAP' }, 'admin');
      expect(kits.create).not.toHaveBeenCalled();
      expect(sin.errores[0].error).toMatch(/congeladas/);

      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja({ articulos: 'LAP' })]);
      await service.crear({ fecha: DIA, operadorCdaId: 'op1', recintoId: 'r1', articulos: 'LAP', justificacion: 'Reemplazo de última hora' }, 'admin');
      expect(kits.asignar).toHaveBeenCalledWith('kNuevo', { operadorId: 'u1', justificacion: 'Reemplazo de última hora' });
    });

    it('artículos que no están en el catálogo: 400 antes de guardar', async () => {
      await expect(
        service.crear({ fecha: DIA, operadorCdaId: 'op1', recintoId: 'r1', articulos: 'LAP, XYZ' }, 'admin'),
      ).rejects.toThrow('Artículo no encontrado en el catálogo: XYZ');
      expect(prisma.parejaCda.create).not.toHaveBeenCalled();
    });
  });

  describe('aplicar', () => {
    it('el kit nuevo se llama "código — recinto", recortado a los 160 caracteres de la columna', async () => {
      const largo = 'U'.repeat(200);
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja({ recinto: { id: 'r1', codigoRecinto: '957', nombre: largo }, operador: { ...OPERADOR, usuarioId: 'u1' } })]);
      prisma.kitElectoral.findFirst.mockResolvedValue(null);

      await service.aplicar(DIA);

      expect(kits.create.mock.calls[0][0].nombre).toBe(`957 — ${largo}`.slice(0, 160));
      expect(kits.create.mock.calls[0][0].nombre).toHaveLength(160);
    });

    it('sin evento ACTIVO de esa fecha responde 400', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(null);
      await expect(service.aplicar(DIA)).rejects.toThrow(BadRequestException);
    });

    it('asigna el kit existente al operador (creándole la cuenta), crea los que faltan (también a la 2.ª pareja del recinto) y reporta errores sin cortar', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ operador: { ...OPERADOR, usuarioId: null } }),
        pareja({ id: 'p2', operadorCdaId: 'op2', operador: { ...OPERADOR, id: 'op2', apellidosNombres: 'SEGUNDO' }, creadoEn: new Date('2026-10-29T12:00:00Z') }),
        pareja({ id: 'p3', recintoId: 'r2', recinto: { id: 'r2', codigoRecinto: '1126', nombre: 'UE B' }, operador: { ...OPERADOR, id: 'op3', usuarioId: 'u3', apellidosNombres: 'TERCERO' } }),
        pareja({ id: 'p4', recintoId: 'r3', recinto: { id: 'r3', codigoRecinto: '1225', nombre: 'UE C' }, operador: { ...OPERADOR, id: 'op4', usuarioId: 'u4', apellidosNombres: 'CUARTO' } }),
      ]);
      prisma.operadorCda.findUnique.mockResolvedValueOnce({ usuarioId: 'uNuevo' });
      prisma.kitElectoral.findFirst
        .mockResolvedValueOnce({ id: 'k1', operadorId: 'uViejo' })
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'k3', operadorId: null })
        .mockResolvedValueOnce(null);
      kits.asignar
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new ConflictException('Este operador ya tiene kits asignados a otro recinto en este evento'));

      const r = await service.aplicar(DIA);

      expect(cuentas.crearOVincular).toHaveBeenCalledWith('op1');
      expect(prisma.kitElectoral.findFirst.mock.calls[0][0].where).toEqual({ eventoId: 'ev2', recintoId: 'r1', esPrueba: false, parejasCda: { none: {} }, estado: { in: ['EN_BODEGA', 'ASIGNADO'] } });
      expect(kits.asignar).toHaveBeenNthCalledWith(1, 'k1', { operadorId: 'uNuevo' });
      // La 2.ª pareja de r1 recibe su propio kit (otro dispositivo), no queda solo registrada.
      expect(kits.create).toHaveBeenNthCalledWith(1, { eventoId: 'ev2', nombre: '957 — UE ATAHUALPA', recintoId: 'r1', otroDispositivo: true });
      expect(kits.asignar).toHaveBeenNthCalledWith(2, 'kNuevo', { operadorId: 'u1' });
      // Recinto sin kit y pareja sin artículos: el kit se crea con los artículos por defecto del catálogo.
      expect(kits.create).toHaveBeenNthCalledWith(2, { eventoId: 'ev2', nombre: '1225 — UE C', recintoId: 'r3', otroDispositivo: true });
      expect(kits.asignar).toHaveBeenNthCalledWith(4, 'kNuevo', { operadorId: 'u4' });
      expect(r).toEqual({
        enApp: 3,
        kitsCreados: 2,
        sinKit: 0,
        errores: [{ pareja: 'TERCERO · 1126', error: 'Este operador ya tiene kits asignados a otro recinto en este evento' }],
      });
    });
  });

  describe('aplicar con dos kits en el recinto', () => {
    it('la pareja que ya tiene su kit lo conserva: no toma el otro kit del recinto', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ id: 'p2', kitId: 'k2', kit: { id: 'k2', codigoUnico: 'KIT-2', eventoId: 'ev2', operadorId: 'uViejo' } }),
      ]);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: 'k2', operadorId: 'uViejo' });

      await service.aplicar(DIA);

      expect(prisma.kitElectoral.findFirst.mock.calls[0][0].where).toEqual({ id: 'k2', eventoId: 'ev2' });
      expect(kits.asignar).toHaveBeenCalledWith('k2', { operadorId: 'u1' });
    });

    it('si su kit es de otro evento, busca el del recinto en este evento', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja({ kitId: 'kViejo' })]);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'k1', operadorId: null });

      await service.aplicar(DIA);

      expect(prisma.kitElectoral.findFirst.mock.calls[1][0].where).toMatchObject({ recintoId: 'r1', parejasCda: { none: {} } });
      expect(kits.asignar).toHaveBeenCalledWith('k1', { operadorId: 'u1' });
    });

    it('la pareja sin kit busca uno del recinto que no sea de otra pareja', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja()]);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: 'k1', operadorId: null });

      await service.aplicar(DIA);

      expect(prisma.kitElectoral.findFirst.mock.calls[0][0]).toMatchObject({
        where: { eventoId: 'ev2', recintoId: 'r1', esPrueba: false, parejasCda: { none: {} } },
        orderBy: { creadoEn: 'asc' },
      });
    });
  });

  it('aplicar: la pareja que ya tiene su kit (aunque haya salido) no da error', async () => {
    prisma.parejaCda.findMany.mockResolvedValueOnce([pareja({ kitId: 'k1' })]);
    prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: 'k1', codigoUnico: 'KIT-1', estado: 'RETORNADO', operadorId: 'u1' });

    const r = await service.aplicar(DIA);

    expect(kits.asignar).not.toHaveBeenCalled();
    expect(r).toMatchObject({ enApp: 1, errores: [] });
  });

  it('aplicar no reasigna un kit que ya salió de la Delegación: lo reporta', async () => {
    prisma.parejaCda.findMany.mockResolvedValueOnce([pareja()]);
    prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: 'k1', codigoUnico: 'KIT-1', estado: 'RETORNADO', operadorId: 'uOtro' });

    const r = await service.aplicar(DIA);

    expect(kits.asignar).not.toHaveBeenCalled();
    expect(r.errores).toEqual([{ pareja: 'PÉREZ ANA · 957', error: 'El kit KIT-1 ya salió de la Delegación: no se puede cambiar su operador' }]);
  });

  describe('Nuevo kit en un paso (página Kits)', () => {
    const EVENTO_KITS = { id: 'ev2', estado: 'ACTIVO', fechaJornada: FECHA };
    const DATOS = { eventoId: 'ev2', recintoId: 'r1', operadorCdaId: 'op1', asistenteCdaId: 'as1' };

    beforeEach(() => {
      prisma.eventoElectoral.findUnique.mockResolvedValue(EVENTO_KITS);
      prisma.operadorCda.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === 'op1'
            ? { grupo: 'OPERADOR', activo: true, usuarioId: 'u1' }
            : { grupo: 'ASISTENTE', activo: true, usuarioId: null },
        ),
      );
      prisma.recinto.findUnique.mockResolvedValue({ activo: true, tipo: 'CDA', codigoRecinto: '957', nombre: 'UE ATAHUALPA' });
      kits.asignar.mockResolvedValue({ id: 'kNuevo', operadorId: 'u1' });
    });
    afterEach(() => prisma.operadorCda.findUnique.mockReset());

    it('disponibles: sin pareja en la jornada del evento, sin kit en el evento, y recintos sin kit', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([{ operadorCdaId: 'opP', asistenteCdaId: 'asP' }]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([
        { recintoId: 'rK', operadorId: 'uK' },
        { recintoId: 'rL', operadorId: null },
      ]);

      await service.disponiblesParaKit('ev2');

      expect(prisma.parejaCda.findMany.mock.calls[0][0].where).toEqual({ fecha: FECHA });
      expect(prisma.kitElectoral.findMany.mock.calls[0][0].where).toEqual({ eventoId: 'ev2', esPrueba: false });
      const sinKitNiPareja = {
        activo: true,
        id: { notIn: ['opP', 'asP'] },
        OR: [{ usuarioId: null }, { usuarioId: { notIn: ['uK'] } }],
      };
      expect(prisma.operadorCda.findMany.mock.calls[0][0].where).toEqual({ grupo: 'OPERADOR', ...sinKitNiPareja });
      expect(prisma.operadorCda.findMany.mock.calls[1][0].where).toEqual({ grupo: 'ASISTENTE', ...sinKitNiPareja });
      expect(prisma.recinto.findMany.mock.calls[0][0].where).toEqual({ tipo: 'CDA', activo: true, id: { notIn: ['rK', 'rL'] } });
    });

    it('operador con iPhone y asistente con Android: el kit nuevo queda a nombre del asistente (le crea la cuenta)', async () => {
      prisma.operadorCda.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === 'op1'
            ? { grupo: 'OPERADOR', activo: true, usuarioId: 'u1', dispositivo: 'IPHONE' }
            : { grupo: 'ASISTENTE', activo: true, usuarioId: 'u2', dispositivo: 'ANDROID' },
        ),
      );
      await service.crearKitConPareja(DATOS, 'admin');
      expect(kits.asignar).toHaveBeenCalledWith('kNuevo', { operadorId: 'u2' });
    });

    it('crea el kit (artículos por defecto), lo asigna al operador y registra la pareja en la fecha de la jornada', async () => {
      const kit = await service.crearKitConPareja(DATOS, 'admin');

      expect(kits.create).toHaveBeenCalledWith({ eventoId: 'ev2', nombre: '957 — UE ATAHUALPA', recintoId: 'r1' });
      expect(kits.asignar).toHaveBeenCalledWith('kNuevo', { operadorId: 'u1' });
      expect(prisma.parejaCda.create).toHaveBeenCalledWith({
        data: { fecha: FECHA, operadorCdaId: 'op1', asistenteCdaId: 'as1', recintoId: 'r1', kitId: 'kNuevo', creadoPorId: 'admin' },
      });
      expect(kit).toEqual({ id: 'kNuevo', operadorId: 'u1' });
    });

    it('pasa los artículos elegidos y crea la cuenta del operador si no la tiene', async () => {
      prisma.operadorCda.findUnique
        .mockResolvedValueOnce({ grupo: 'OPERADOR', activo: true }) // validar integrantes
        .mockResolvedValueOnce({ usuarioId: null }) // sin cuenta todavía
        .mockResolvedValueOnce({ usuarioId: 'uNuevo' }); // tras asegurarCuenta
      const detalleItems = [{ itemId: 'iLap', serie: 'S1', estado: 'BUENO' as const }];

      await service.crearKitConPareja({ eventoId: 'ev2', recintoId: 'r1', operadorCdaId: 'op1', detalleItems }, 'admin');

      expect(cuentas.crearOVincular).toHaveBeenCalledWith('op1');
      expect(kits.create).toHaveBeenCalledWith(expect.objectContaining({ detalleItems }));
      expect(kits.asignar).toHaveBeenCalledWith('kNuevo', { operadorId: 'uNuevo' });
      expect(prisma.parejaCda.create.mock.calls[0][0].data.asistenteCdaId).toBeNull();
    });

    it('dos operadores no: ni crea el kit ni registra la pareja; la misma persona dos veces tampoco', async () => {
      prisma.operadorCda.findUnique.mockImplementation(() => Promise.resolve({ grupo: 'OPERADOR', activo: true, usuarioId: 'u1' }));
      await expect(service.crearKitConPareja({ ...DATOS, asistenteCdaId: 'op2' }, 'admin')).rejects.toThrow(
        'cada pareja es un Operador y un Asistente CDA',
      );
      await expect(service.crearKitConPareja({ ...DATOS, asistenteCdaId: 'op1' }, 'admin')).rejects.toThrow('Elija dos personas distintas');
      expect(kits.create).not.toHaveBeenCalled();
      expect(prisma.parejaCda.create).not.toHaveBeenCalled();
    });

    it('si el operador o el asistente ya tiene pareja ese día, no crea nada', async () => {
      prisma.parejaCda.findFirst.mockResolvedValueOnce({ operadorCdaId: 'otro', asistenteCdaId: 'as1' });

      await expect(service.crearKitConPareja(DATOS, 'admin')).rejects.toThrow(
        new ConflictException('El asistente ya tiene pareja el 2026-10-30'),
      );
      expect(kits.create).not.toHaveBeenCalled();
    });

    it('jornada iniciada sin justificación: lo explica sin crear el kit', async () => {
      kits.estaCongelado.mockReturnValue(true);

      await expect(service.crearKitConPareja(DATOS, 'admin')).rejects.toThrow(BadRequestException);
      expect(kits.create).not.toHaveBeenCalled();
    });

    it('si falla la asignación, borra el kit recién creado (no queda un kit suelto)', async () => {
      kits.asignar.mockRejectedValueOnce(new ConflictException('Este operador ya tiene kits asignados a otro recinto en este evento'));

      await expect(service.crearKitConPareja(DATOS, 'admin')).rejects.toThrow(ConflictException);
      expect(prisma.kitElectoral.delete).toHaveBeenCalledWith({ where: { id: 'kNuevo' } });
      expect(prisma.parejaCda.create).not.toHaveBeenCalled();
    });

    it('si además falla el borrado del kit, lo registra en el log y devuelve el error original', async () => {
      const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      kits.asignar.mockRejectedValueOnce(new ConflictException('choque'));
      prisma.kitElectoral.delete.mockRejectedValueOnce(new Error('FK'));

      await expect(service.crearKitConPareja(DATOS, 'admin')).rejects.toThrow('choque');
      expect(log).toHaveBeenCalledWith(expect.stringContaining('kNuevo'));
      log.mockRestore();
    });

    it('recinto que ya tiene kit real: KitsService lo rechaza y no se registra la pareja ni se borra nada', async () => {
      kits.create.mockRejectedValueOnce(new ConflictException('Este recinto ya tiene un kit asignado en este evento'));

      await expect(service.crearKitConPareja(DATOS, 'admin')).rejects.toThrow('Este recinto ya tiene un kit asignado');
      expect(kits.asignar).not.toHaveBeenCalled();
      expect(prisma.parejaCda.create).not.toHaveBeenCalled();
      expect(prisma.kitElectoral.delete).not.toHaveBeenCalled();
    });

    it('"otro dispositivo": pasa la marca a KitsService para aceptar el segundo kit del recinto', async () => {
      await service.crearKitConPareja({ ...DATOS, otroDispositivo: true }, 'admin');

      expect(kits.create).toHaveBeenCalledWith(expect.objectContaining({ recintoId: 'r1', otroDispositivo: true }));
    });

    it('evento inexistente: 404', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.crearKitConPareja(DATOS, 'admin')).rejects.toThrow('Evento no encontrado');
    });
  });

  describe('cargarPropuesta (propuesta editada en la web)', () => {
    beforeEach(() => {
      prisma.operadorCda.findMany.mockResolvedValue([
        { id: 'op1', cedula: '1710034065', grupo: 'OPERADOR', activo: true, apellidosNombres: 'PÉREZ ANA' },
      ]);
      prisma.recinto.findMany.mockResolvedValue([{ id: 'r1', codigoRecinto: '957', nombre: 'UE ATAHUALPA', tipo: 'CDA' }]);
    });

    it('pasa por las validaciones de la plantilla y nunca crea personas', async () => {
      prisma.parejaCda.create.mockResolvedValueOnce({ id: 'p1' });

      const r = await service.cargarPropuesta(
        [
          { cedulaOperador: '1710034065', cedulaAsistente: null, codigoRecinto: '957' },
          { cedulaOperador: '1712345675', codigoRecinto: '957' },
          { cedulaOperador: '', codigoRecinto: '957' },
        ],
        DIA,
        true,
        'admin',
        false,
      );

      expect(r.filas[0]).toMatchObject({ operador: { nombre: 'PÉREZ ANA' }, errores: [] });
      expect(r.filas[1].errores).toContain('Cédula nueva 1712345675: falta nombre_operador');
      expect(r.filas[2].errores.length).toBeGreaterThan(0);
      expect(prisma.operadorCda.create).not.toHaveBeenCalled();
      expect(prisma.parejaCda.create).toHaveBeenCalledTimes(1);
      expect(r).toMatchObject({ guardado: true, guardadas: 1, app: null });
    });

    it('numera las filas desde 1 (como la tabla de la web) y aplica las reglas de la plantilla', async () => {
      const r = await service.cargarPropuesta(
        [
          { cedulaOperador: '1710034065', codigoRecinto: '957' },
          { cedulaOperador: '1710034065', codigoRecinto: '957' },
        ],
        DIA,
        false,
        'admin',
      );
      expect(r.filas.map((f) => f.fila)).toEqual([1, 2]);
      expect(r.filas[1].errores).toContain('La cédula 1710034065 está repetida (fila 1)');
    });

    it('al guardar con "pasar a la app", pasa las parejas guardadas a la app', async () => {
      prisma.parejaCda.create.mockResolvedValueOnce({ id: 'p1' });
      await service.cargarPropuesta([{ cedulaOperador: '1710034065', codigoRecinto: '957' }], DIA, true, 'admin', true);
      expect(prisma.eventoElectoral.findFirst).toHaveBeenCalled();
    });

    it('vista previa: no guarda nada', async () => {
      const r = await service.cargarPropuesta([{ cedulaOperador: '1710034065', codigoRecinto: '957' }], DIA, false, 'admin');
      expect(r.guardado).toBe(false);
      expect(prisma.parejaCda.create).not.toHaveBeenCalled();
    });
  });

  describe('importar', () => {
    beforeEach(() => {
      prisma.operadorCda.findMany.mockResolvedValue([
        { id: 'op1', cedula: '1710034065', grupo: 'OPERADOR', activo: true, apellidosNombres: 'PÉREZ ANA' },
        { id: 'dig1', cedula: '1002003000', grupo: 'DIGITADOR', activo: true, apellidosNombres: 'DIGITADOR X' },
      ]);
      prisma.recinto.findMany.mockResolvedValue([
        { id: 'r1', codigoRecinto: '957', nombre: 'UE ATAHUALPA', tipo: 'CDA' },
        { id: 'rNo', codigoRecinto: '20', nombre: 'ESCUELA NO CDA', tipo: 'NO_CDA' },
      ]);
    });

    it('vista previa: no guarda; marca cédulas nuevas, avisa la 2.ª pareja del recinto y explica cada error', async () => {
      const file = await plantilla([
        { cedula_operador: '1710034065', cedula_asistente: '1713175071', nombre_asistente: 'RUIZ JUAN', codigo_recinto: '957', articulos: 'LAP' },
        { cedula_operador: '1002003000', codigo_recinto: '957' },
        { cedula_operador: '1713175071', codigo_recinto: '957' },
        { cedula_operador: '0401234562', codigo_recinto: '20' },
        { cedula_operador: '1712345675', nombre_operador: 'NUEVO OP', codigo_recinto: '957' },
      ]);

      const r = await service.importar(file, DIA, false, 'admin');

      expect(r.guardado).toBe(false);
      expect(prisma.parejaCda.create).not.toHaveBeenCalled();
      expect(prisma.operadorCda.create).not.toHaveBeenCalled();
      const [f1, f2, f3, f4, f5] = r.filas;
      expect(f1).toMatchObject({
        fila: 2,
        operador: { cedula: '1710034065', nombre: 'PÉREZ ANA', nuevo: false },
        asistente: { cedula: '1713175071', nombre: 'RUIZ JUAN', nuevo: true },
        recinto: { codigo: '957', nombre: 'UE ATAHUALPA' },
        errores: [],
      });
      expect(f2.errores).toContain('La cédula 1002003000 es de Digitadores, no de Operadores CDA');
      expect(f3.errores).toContain('La cédula 1713175071 está repetida (fila 2)');
      expect(f4.errores).toEqual(
        expect.arrayContaining(['Cédula nueva 0401234562: falta nombre_operador', 'El recinto 20 no es CDA']),
      );
      expect(f5.errores).toEqual([]);
      expect(f5.avisos).toContain('Segunda pareja en el recinto 957: solo queda registrada (el kit y la app son de la primera)');
    });

    it('al guardar crea las personas nuevas con su cuenta y las parejas válidas, y las pasa a la app', async () => {
      const file = await plantilla([
        { cedula_operador: '1710034065', cedula_asistente: '1713175071', nombre_asistente: 'RUIZ JUAN', codigo_recinto: '957' },
        { cedula_operador: '1002003000', codigo_recinto: '957' },
      ]);
      prisma.operadorCda.create.mockResolvedValueOnce({ id: 'asNuevo' });
      prisma.parejaCda.create.mockResolvedValueOnce({ id: 'p1' });

      const r = await service.importar(file, DIA, true, 'admin');

      expect(prisma.operadorCda.create.mock.calls[0][0].data).toMatchObject({
        cedula: '1713175071',
        apellidosNombres: 'RUIZ JUAN',
        grupo: 'ASISTENTE',
      });
      expect(cuentas.asegurarCuenta).toHaveBeenCalledWith(prisma, 'asNuevo', 'hash');
      // La persona nueva arranca con su cédula como contraseña.
      expect(cuentas.hashInicial).toHaveBeenCalledWith('1713175071');
      expect(prisma.parejaCda.create).toHaveBeenCalledTimes(1);
      expect(prisma.parejaCda.create.mock.calls[0][0].data).toMatchObject({ operadorCdaId: 'op1', asistenteCdaId: 'asNuevo', recintoId: 'r1' });
      expect(r).toMatchObject({ guardado: true, guardadas: 1 });
      expect(r.app).not.toBeNull();
    });

    it('no acepta dos operadores ni un asistente en la columna del operador: explica el error y no guarda', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([
        { id: 'op1', cedula: '1710034065', grupo: 'OPERADOR', activo: true, apellidosNombres: 'PÉREZ ANA' },
        { id: 'op2', cedula: '1712345675', grupo: 'OPERADOR', activo: true, apellidosNombres: 'MORA LUIS' },
        { id: 'as1', cedula: '1713175071', grupo: 'ASISTENTE', activo: true, apellidosNombres: 'RUIZ JUAN' },
      ]);
      prisma.recinto.findMany.mockResolvedValueOnce([
        { id: 'r1', codigoRecinto: '957', nombre: 'UE ATAHUALPA', tipo: 'CDA' },
        { id: 'r2', codigoRecinto: '958', nombre: 'UE B', tipo: 'CDA' },
      ]);
      const file = await plantilla([
        { cedula_operador: '1710034065', cedula_asistente: '1712345675', codigo_recinto: '957' },
        { cedula_operador: '1713175071', codigo_recinto: '958' },
      ]);
      prisma.parejaCda.create.mockResolvedValueOnce({ id: 'p1' }).mockResolvedValueOnce({ id: 'p2' });

      const r = await service.importar(file, DIA, true, 'admin', false);

      expect(r.filas.map((f) => f.errores)).toEqual([
        ['La cédula 1712345675 es de Operadores CDA, no de Asistentes CDA'],
        ['La cédula 1713175071 es de Asistentes CDA, no de Operadores CDA'],
      ]);
      expect(prisma.operadorCda.create).not.toHaveBeenCalled();
      expect(prisma.parejaCda.create).not.toHaveBeenCalled();
    });

    it('la misma cédula en las dos columnas de una fila es un error; también quien ya está hoy en la otra columna', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([{ fecha: FECHA, operadorCdaId: 'opHoy', asistenteCdaId: 'op1', recintoId: 'r9' }]);
      const file = await plantilla([
        { cedula_operador: '1710034065', cedula_asistente: '1710034065', codigo_recinto: '957' },
      ]);
      const r = await service.importar(file, DIA, false, 'admin');
      expect(r.filas[0].errores).toEqual(
        expect.arrayContaining(['La cédula 1710034065 está repetida (fila 2)', 'PÉREZ ANA ya tiene pareja el 2026-10-30']),
      );
    });

    it('guardar sin pasar a la app (lista histórica): no toca kits aunque haya evento activo de ese día', async () => {
      const file = await plantilla([{ cedula_operador: '1710034065', codigo_recinto: '957' }]);
      prisma.parejaCda.create.mockResolvedValueOnce({ id: 'p1' });
      const r = await service.importar(file, DIA, true, 'admin', false);
      expect(r).toMatchObject({ guardado: true, guardadas: 1, app: null });
      expect(prisma.eventoElectoral.findFirst).not.toHaveBeenCalled();
      expect(kits.asignar).not.toHaveBeenCalled();
    });

    it('rechaza .xls y más de 300 filas', async () => {
      await expect(service.importar({ originalname: 'p.xls', buffer: Buffer.from('x') } as Express.Multer.File, DIA, false, 'admin')).rejects.toThrow(
        'Use la plantilla en .xlsx',
      );
      const muchas = await plantilla(Array.from({ length: 301 }, () => ({ cedula_operador: '1710034065', codigo_recinto: '957' })));
      await expect(service.importar(muchas, DIA, false, 'admin')).rejects.toThrow('máximo 300');
    });

    it('nombres que parecen fórmulas de Excel no se aceptan', async () => {
      const file = await plantilla([{ cedula_operador: '1712345675', nombre_operador: '=HYPERLINK("x")', codigo_recinto: '957' }]);
      const r = await service.importar(file, DIA, false, 'admin');
      expect(r.filas[0].errores).toContain('nombre_operador no puede empezar con =, +, - o @');
    });

    it('el código de recinto se compara sin importar mayúsculas', async () => {
      prisma.recinto.findMany.mockResolvedValueOnce([{ id: 'rA', codigoRecinto: 'AB12', nombre: 'UE A', tipo: 'CDA' }]);
      const file = await plantilla([{ cedula_operador: '1710034065', codigo_recinto: 'ab12' }]);
      const r = await service.importar(file, DIA, false, 'admin');
      expect(r.filas[0].recinto).toMatchObject({ codigo: 'AB12' });
      expect(prisma.recinto.findMany.mock.calls[0][0].where).toEqual({ activo: true });
    });

    it('una cédula de 9 dígitos (Excel le quitó el 0 inicial) se completa', async () => {
      const file = await plantilla([{ cedula_operador: '401234562', nombre_operador: 'CERO', codigo_recinto: '957' }]);
      const r = await service.importar(file, DIA, false, 'admin');
      expect(r.filas[0].operador?.cedula).toBe('0401234562');
    });
  });

  describe('jornada en curso: el kit que ya salió de la Delegación', () => {
    const SALIO = (operadorId: string) => ({ id: 'k1', codigoUnico: 'KIT-1', eventoId: 'ev2', operadorId, estado: 'EN_TRANSITO' });

    beforeEach(() => {
      prisma.operadorCda.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id.startsWith('op') ? { grupo: 'OPERADOR', activo: true } : where.id.startsWith('as') ? { grupo: 'ASISTENTE', activo: true } : null,
        ),
      );
    });

    it('la lista dice si el kit ya salió y quién de la pareja lo lleva', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ kitId: 'k1', kit: SALIO('u1') }),
        pareja({
          id: 'p2',
          recintoId: 'r2',
          recinto: { id: 'r2', codigoRecinto: '1126', nombre: 'UE B' },
          operador: { ...OPERADOR, id: 'op2', usuarioId: 'u7' },
          asistente: { ...ASISTENTE, id: 'as2', usuarioId: 'u8' },
          kitId: 'k2',
          kit: { codigoUnico: 'KIT-2', eventoId: 'ev2', operadorId: 'u8', estado: 'ASIGNADO' },
        }),
      ]);
      const { parejas } = await service.listar(DIA);
      const de = (id: string) => parejas.find((p) => p.id === id)!;
      expect(de('p1')).toMatchObject({ kitSalio: true, quienLleva: 'OPERADOR' });
      expect(de('p2')).toMatchObject({ kitSalio: false, quienLleva: 'ASISTENTE' });
    });

    it('un kit de otro evento no cuenta como salido', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja({ kitId: 'k1', kit: { ...SALIO('u1'), eventoId: 'ev1' } })]);
      const { parejas } = await service.listar(DIA);
      expect(parejas[0]).toMatchObject({ kitSalio: false, quienLleva: null });
    });

    it('se puede cambiar al asistente si el kit lo lleva el operador: el kit se queda con él', async () => {
      prisma.parejaCda.findUnique.mockResolvedValue(pareja({ kitId: 'k1', kit: SALIO('u1') }));
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ asistenteCdaId: 'as2', asistente: { ...ASISTENTE, id: 'as2', usuarioId: 'u9' }, kitId: 'k1', kit: SALIO('u1') }),
      ]);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: 'k1', operadorId: 'u1', estado: 'EN_TRANSITO', codigoUnico: 'KIT-1' });

      const r = await service.editar('p1', { asistenteCdaId: 'as2' }, 'Se enfermó');

      expect(prisma.parejaCda.update).toHaveBeenCalled();
      expect(kits.asignar).not.toHaveBeenCalled();
      expect(r.errores).toEqual([]);
    });

    it('aunque ahora otro de la pareja tenga Android, el kit que salió sigue con quien lo lleva (sin error)', async () => {
      const operadorIphone = { ...OPERADOR, dispositivo: 'IPHONE' };
      const asistenteAndroid = { ...ASISTENTE, id: 'as2', usuarioId: 'u9', dispositivo: 'ANDROID' };
      prisma.parejaCda.findUnique.mockResolvedValue(pareja({ operador: operadorIphone, kitId: 'k1', kit: SALIO('u1') }));
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ operador: operadorIphone, asistenteCdaId: 'as2', asistente: asistenteAndroid, kitId: 'k1', kit: SALIO('u1') }),
      ]);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: 'k1', operadorId: 'u1', estado: 'EN_TRANSITO', codigoUnico: 'KIT-1' });

      const r = await service.editar('p1', { asistenteCdaId: 'as2' }, 'Cambio');

      expect(kits.asignar).not.toHaveBeenCalled();
      expect(r.errores).toEqual([]);
    });

    it('no se cambia a quien lleva el kit que ya salió: 409 claro y no guarda nada', async () => {
      prisma.parejaCda.findUnique.mockResolvedValue(pareja({ kitId: 'k1', kit: SALIO('u1') }));
      await expect(service.editar('p1', { operadorCdaId: 'op2' }, 'x')).rejects.toThrow(
        'PÉREZ ANA lleva el kit KIT-1, que ya salió de la Delegación: no se puede cambiar',
      );
      expect(prisma.parejaCda.update).not.toHaveBeenCalled();
    });

    it('tampoco al asistente si es él quien lleva el kit que salió', async () => {
      prisma.parejaCda.findUnique.mockResolvedValue(pareja({ kitId: 'k1', kit: SALIO('u2') }));
      await expect(service.editar('p1', { asistenteCdaId: 'as2' }, 'x')).rejects.toThrow(ConflictException);
      expect(prisma.parejaCda.update).not.toHaveBeenCalled();
    });

    it('intercambiar asistentes entre parejas cuyos kits salieron con los operadores: se puede y los kits no se tocan', async () => {
      const P1 = pareja({ kitId: 'k1', kit: SALIO('u1') });
      const P2 = pareja({
        id: 'p2',
        recintoId: 'r2',
        operadorCdaId: 'op2',
        asistenteCdaId: 'as2',
        operador: { ...OPERADOR, id: 'op2', usuarioId: 'u3' },
        asistente: { ...ASISTENTE, id: 'as2', usuarioId: 'u4' },
        kitId: 'k2',
        kit: { id: 'k2', codigoUnico: 'KIT-2', eventoId: 'ev2', operadorId: 'u3', estado: 'EN_TRANSITO' },
      });
      prisma.parejaCda.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(where.id === 'p1' ? P1 : P2));
      prisma.kitElectoral.findMany.mockResolvedValue([
        { id: 'k1', codigoUnico: 'KIT-1', estado: 'EN_TRANSITO', operadorId: 'u1' },
        { id: 'k2', codigoUnico: 'KIT-2', estado: 'EN_TRANSITO', operadorId: 'u3' },
      ]);

      await service.intercambiar('p1', 'p2', 'ASISTENTE', 'Reorganización');

      expect(prisma.parejaCda.update).toHaveBeenCalledTimes(3);
      expect(kits.quitarOperador).not.toHaveBeenCalled();
      expect(kits.asignar).not.toHaveBeenCalled();
    });

    it('cambiar el recinto de una pareja cuyo kit salió: 409 claro, sin escribir', async () => {
      prisma.parejaCda.findUnique.mockResolvedValue(pareja({ kitId: 'k1', kit: SALIO('u1') }));
      prisma.recinto.findUnique.mockResolvedValue({ activo: true, tipo: 'CDA' });
      await expect(service.editar('p1', { recintoId: 'r2' }, 'x')).rejects.toThrow(
        'El kit KIT-1 ya salió de la Delegación hacia su recinto: no se puede cambiar el recinto',
      );
      expect(prisma.parejaCda.update).not.toHaveBeenCalled();
    });

    it('intercambiar operadores cuando el kit que salió lo lleva el asistente: se puede, el kit sigue con él', async () => {
      const P1 = pareja({ kitId: 'k1', kit: SALIO('u2') });
      const P2 = pareja({ id: 'p2', recintoId: 'r2', operadorCdaId: 'op2', asistenteCdaId: 'as2', operador: { ...OPERADOR, id: 'op2', usuarioId: 'u3' }, asistente: { ...ASISTENTE, id: 'as2', usuarioId: 'u4' } });
      prisma.parejaCda.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(where.id === 'p1' ? P1 : P2));
      prisma.kitElectoral.findMany.mockResolvedValue([{ id: 'k1', codigoUnico: 'KIT-1', estado: 'EN_TRANSITO', operadorId: 'u2' }]);

      await service.intercambiar('p1', 'p2', 'OPERADOR', 'Cambio');

      expect(prisma.parejaCda.update).toHaveBeenCalled();
      expect(kits.quitarOperador).not.toHaveBeenCalled();
    });

    it('intercambiar operadores cuando uno lleva un kit que salió: 409', async () => {
      const P1 = pareja({ kitId: 'k1', kit: SALIO('u1') });
      const P2 = pareja({ id: 'p2', recintoId: 'r2', operadorCdaId: 'op2', asistenteCdaId: 'as2', operador: { ...OPERADOR, id: 'op2', usuarioId: 'u3' }, asistente: { ...ASISTENTE, id: 'as2', usuarioId: 'u4' } });
      prisma.parejaCda.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(where.id === 'p1' ? P1 : P2));
      prisma.kitElectoral.findMany.mockResolvedValue([{ id: 'k1', codigoUnico: 'KIT-1', estado: 'EN_TRANSITO', operadorId: 'u1' }]);
      await expect(service.intercambiar('p1', 'p2', 'OPERADOR', 'x')).rejects.toThrow('El kit KIT-1 ya salió');
      expect(prisma.parejaCda.update).not.toHaveBeenCalled();
    });

    it('al reaplicar, el kit que salió con alguien de la pareja no crea cuentas ni reasigna', async () => {
      const iphone = { ...OPERADOR, dispositivo: 'IPHONE' };
      const androidSinCuenta = { ...ASISTENTE, id: 'as2', usuarioId: null, dispositivo: 'ANDROID' };
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja({ operador: iphone, asistenteCdaId: 'as2', asistente: androidSinCuenta, kitId: 'k1', kit: SALIO('u1') })]);
      const r = await service.aplicar(DIA, 'x');
      expect(r).toMatchObject({ enApp: 1, errores: [] });
      expect(cuentas.crearOVincular).not.toHaveBeenCalled();
      expect(kits.asignar).not.toHaveBeenCalled();
    });

    it('intercambiar asistentes cuando uno de ellos lleva un kit que salió: 409 y no cambia nada', async () => {
      const P1 = pareja({ kitId: 'k1', kit: SALIO('u2') });
      const P2 = pareja({ id: 'p2', recintoId: 'r2', operadorCdaId: 'op2', asistenteCdaId: 'as2', operador: { ...OPERADOR, id: 'op2', usuarioId: 'u3' }, asistente: { ...ASISTENTE, id: 'as2', usuarioId: 'u4' } });
      prisma.parejaCda.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(where.id === 'p1' ? P1 : P2));
      prisma.kitElectoral.findMany.mockResolvedValue([{ id: 'k1', codigoUnico: 'KIT-1', estado: 'EN_TRANSITO', operadorId: 'u2' }]);

      await expect(service.intercambiar('p1', 'p2', 'ASISTENTE', 'x')).rejects.toThrow('El kit KIT-1 ya salió de la Delegación');
      expect(prisma.parejaCda.update).not.toHaveBeenCalled();
    });
  });

  describe('editar', () => {
    beforeEach(() => {
      prisma.operadorCda.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id.startsWith('op') ? { grupo: 'OPERADOR', activo: true } : where.id.startsWith('as') ? { grupo: 'ASISTENTE', activo: true } : null,
        ),
      );
      prisma.recinto.findUnique.mockResolvedValue({ activo: true, tipo: 'CDA' });
      prisma.parejaCda.findUnique.mockResolvedValue(pareja({ kitId: 'k1', kit: { id: 'k1', operadorId: 'u1', eventoId: 'ev2' } }));
    });

    it('el asistente no puede cambiarse por un operador (cada pareja es un Operador y un Asistente)', async () => {
      await expect(service.editar('p1', { asistenteCdaId: 'op2' })).rejects.toThrow('cada pareja es un Operador y un Asistente CDA');
      expect(prisma.parejaCda.update).not.toHaveBeenCalled();
    });

    it('al cambiar el asistente se comprueba que no tenga pareja ese día (sin contar esta)', async () => {
      await service.editar('p1', { asistenteCdaId: 'as2' });
      expect(prisma.parejaCda.findFirst.mock.calls[0][0].where).toEqual({
        fecha: FECHA,
        id: { not: 'p1' },
        OR: [{ operadorCdaId: { in: ['op1', 'as2'] } }, { asistenteCdaId: { in: ['op1', 'as2'] } }],
      });
    });

    it('si el nuevo integrante ya va en otra pareja del día, no guarda ni suelta el kit', async () => {
      prisma.parejaCda.findFirst.mockResolvedValueOnce({ operadorCdaId: 'as2', asistenteCdaId: null });
      await expect(service.editar('p1', { asistenteCdaId: 'as2', recintoId: 'r2' })).rejects.toThrow(
        new ConflictException('El asistente ya tiene pareja el 2026-10-30'),
      );
      expect(prisma.parejaCda.update).not.toHaveBeenCalled();
      expect(kits.quitarOperador).not.toHaveBeenCalled();
    });

    it('cambiar solo el recinto también comprueba a los dos integrantes (sin contar esta pareja)', async () => {
      await service.editar('p1', { recintoId: 'r2' });
      expect(prisma.parejaCda.findFirst.mock.calls[0][0].where).toMatchObject({ id: { not: 'p1' } });
      expect(prisma.parejaCda.update).toHaveBeenCalled();
    });

    it('una pareja anterior a la regla (dos operadores) puede cambiar de recinto o recibir un asistente de verdad', async () => {
      prisma.parejaCda.findUnique.mockResolvedValue(
        pareja({ asistenteCdaId: 'op2', asistente: { ...OPERADOR, id: 'op2', usuarioId: 'u9' } }),
      );
      await service.editar('p1', { recintoId: 'r2' });
      await service.editar('p1', { asistenteCdaId: 'as2' });
      expect(prisma.parejaCda.update).toHaveBeenCalledTimes(2);
      // Pero no recibe a otro operador como asistente.
      await expect(service.editar('p1', { asistenteCdaId: 'op3' })).rejects.toThrow('cada pareja es un Operador y un Asistente CDA');
    });

    it('cambiar solo el asistente no toca el kit', async () => {
      await service.editar('p1', { asistenteCdaId: 'as2' });
      expect(prisma.parejaCda.update.mock.calls[0][0]).toEqual({
        where: { id: 'p1' },
        data: { operadorCdaId: 'op1', asistenteCdaId: 'as2' },
      });
      expect(kits.quitarOperador).not.toHaveBeenCalled();
    });

    it('cambiar el recinto: valida que el kit anterior se pueda soltar, guarda y recién entonces lo suelta', async () => {
      await service.editar('p1', { recintoId: 'r2' }, 'Cambio de sede');
      expect(kits.quitarOperador.mock.calls).toEqual([
        ['k1', 'Cambio de sede', true],
        ['k1', 'Cambio de sede'],
      ]);
      expect(prisma.parejaCda.update.mock.calls[0][0].data).toEqual({ operadorCdaId: 'op1', asistenteCdaId: 'as1', recintoId: 'r2', kitId: null });
      expect(prisma.parejaCda.update.mock.invocationCallOrder[0]).toBeLessThan(kits.quitarOperador.mock.invocationCallOrder[1]);
    });

    it('si el cambio choca (persona ya emparejada ese día), el kit anterior no se suelta', async () => {
      prisma.parejaCda.update.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: 'uq_parejas_cda_fecha_operador' } }),
      );
      await expect(service.editar('p1', { recintoId: 'r2', operadorCdaId: 'op9' })).rejects.toThrow(ConflictException);
      expect(kits.quitarOperador.mock.calls).toEqual([['k1', undefined, true]]);
    });

    it('cambiar el operador: el kit pasa al nuevo (no se suelta antes) y solo se reaplica ese recinto', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ operadorCdaId: 'op2', operador: { ...OPERADOR, id: 'op2', usuarioId: 'u9' }, kitId: 'k1', kit: { codigoUnico: 'K', eventoId: 'ev2', operadorId: 'u1' } }),
        pareja({ id: 'pOtro', recintoId: 'r7', recinto: { id: 'r7', codigoRecinto: '7', nombre: 'OTRO' }, operador: { ...OPERADOR, id: 'op7', usuarioId: 'u7' } }),
      ]);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: 'k1', operadorId: 'u1' });
      await service.editar('p1', { operadorCdaId: 'op2' });
      expect(kits.quitarOperador).not.toHaveBeenCalled();
      expect(kits.asignar).toHaveBeenCalledTimes(1);
      expect(kits.asignar).toHaveBeenCalledWith('k1', { operadorId: 'u9' });
    });
  });

  describe('editar: quien sale pasa a reserva o queda libre', () => {
    beforeEach(() => {
      prisma.operadorCda.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id.startsWith('op') ? { grupo: 'OPERADOR', activo: true } : { grupo: 'ASISTENTE', activo: true }),
      );
      prisma.recinto.findUnique.mockResolvedValue({ activo: true, tipo: 'CDA' });
      prisma.parejaCda.findUnique.mockResolvedValue(pareja());
    });

    it('sin "pasa a reserva", quien sale queda libre (no se crea nada) y el cambio vuelve para la bitácora', async () => {
      const r = await service.editar('p1', { asistenteCdaId: 'as2' });
      expect(prisma.parejaCda.create).not.toHaveBeenCalled();
      expect(r.cambio).toEqual({
        antes: { operadorCdaId: 'op1', asistenteCdaId: 'as1', recintoId: 'r1' },
        despues: { operadorCdaId: 'op1', asistenteCdaId: 'as2', recintoId: 'r1' },
        aReserva: [],
      });
    });

    it('el asistente reemplazado queda en una reserva solo con él, el mismo día y en la misma transacción', async () => {
      const r = await service.editar('p1', { asistenteCdaId: 'as2' }, undefined, { aReserva: true, usuarioId: 'uAdmin' });
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.parejaCda.create).toHaveBeenCalledWith({
        data: { fecha: FECHA, operadorCdaId: null, asistenteCdaId: 'as1', recintoId: null, articulos: null, creadoPorId: 'uAdmin' },
      });
      // Primero sale de la pareja (únicos por día) y después entra a la reserva.
      expect(prisma.parejaCda.update.mock.invocationCallOrder[0]).toBeLessThan(prisma.parejaCda.create.mock.invocationCallOrder[0]);
      expect(r.cambio.aReserva).toEqual(['as1']);
    });

    it('el operador reemplazado queda en una reserva sin asistente', async () => {
      await service.editar('p1', { operadorCdaId: 'op2' }, undefined, { aReserva: true });
      expect(prisma.parejaCda.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ operadorCdaId: 'op1', asistenteCdaId: null, recintoId: null }),
      });
    });

    it('pareja anterior a la regla: quien sale va a la reserva en la columna de su cargo, no en la que estaba', async () => {
      prisma.parejaCda.findUnique.mockResolvedValue(pareja({ operadorCdaId: 'as7', operador: { ...ASISTENTE, id: 'as7' } }));
      await service.editar('p1', { operadorCdaId: 'op2' }, undefined, { aReserva: true });
      expect(prisma.parejaCda.create).toHaveBeenCalledWith({ data: expect.objectContaining({ operadorCdaId: null, asistenteCdaId: 'as7' }) });
    });

    it('si salen los dos a la vez, cada uno queda en su propia reserva', async () => {
      const r = await service.editar('p1', { operadorCdaId: 'op2', asistenteCdaId: 'as2' }, undefined, { aReserva: true });
      expect(prisma.parejaCda.create).toHaveBeenCalledTimes(2);
      expect(r.cambio.aReserva).toEqual(['op1', 'as1']);
    });

    it('dejar la pareja "sin asistente" también puede mandarlo a reserva', async () => {
      await service.editar('p1', { asistenteCdaId: null }, undefined, { aReserva: true });
      expect(prisma.parejaCda.create).toHaveBeenCalledWith({ data: expect.objectContaining({ operadorCdaId: null, asistenteCdaId: 'as1' }) });
    });

    it('cambiar solo el recinto no saca a nadie: no se crea reserva', async () => {
      const r = await service.editar('p1', { recintoId: 'r2' }, undefined, { aReserva: true });
      expect(prisma.parejaCda.create).not.toHaveBeenCalled();
      expect(r.cambio.despues.recintoId).toBe('r2');
    });

    it('si la reserva no se puede guardar (ya tiene pareja ese día), avisa como conflicto', async () => {
      prisma.parejaCda.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: 'uq_parejas_cda_fecha_asistente' } }),
      );
      await expect(service.editar('p1', { asistenteCdaId: 'as2' }, undefined, { aReserva: true })).rejects.toThrow(
        new ConflictException('Ese asistente ya tiene pareja el 2026-10-30'),
      );
    });

    it('al quitar una pareja devuelve cómo estaba (para la bitácora)', async () => {
      await expect(service.eliminar('p1')).resolves.toEqual({ operadorCdaId: 'op1', asistenteCdaId: 'as1', recintoId: 'r1' });
    });
  });

  describe('intercambiar con otra pareja del mismo día', () => {
    const P1 = pareja({ kitId: 'k1', kit: { id: 'k1', operadorId: 'u1', eventoId: 'ev2' } });
    const P2 = pareja({
      id: 'p2',
      recintoId: 'r2',
      operadorCdaId: 'op2',
      asistenteCdaId: 'as2',
      articulos: 'LAP',
      kitId: 'k2',
      operador: { ...OPERADOR, id: 'op2', usuarioId: 'u2' },
      kit: { id: 'k2', operadorId: 'u2', eventoId: 'ev2' },
    });

    beforeEach(() => {
      prisma.parejaCda.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'p1' ? P1 : where.id === 'p2' ? P2 : null),
      );
      prisma.kitElectoral.findMany.mockResolvedValue([
        { id: 'k1', codigoUnico: 'KIT-1', estado: 'ASIGNADO', operadorId: 'u1' },
        { id: 'k2', codigoUnico: 'KIT-2', estado: 'ASIGNADO', operadorId: 'u2' },
      ]);
    });

    it('una pareja anterior a la regla no pasa a nadie fuera de su cargo (operador que era asistente)', async () => {
      const VIEJA = { ...P2, operador: { ...ASISTENTE, id: 'as9', apellidosNombres: 'LEÓN MARÍA', usuarioId: 'u9' } };
      prisma.parejaCda.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'p1' ? P1 : where.id === 'p2' ? VIEJA : null),
      );

      await expect(service.intercambiar('p1', 'p2', 'OPERADOR')).rejects.toThrow(
        'LEÓN MARÍA es de Asistentes CDA: no puede ir como operador (cada pareja es un Operador y un Asistente CDA)',
      );
      expect(prisma.parejaCda.update).not.toHaveBeenCalled();
      expect(kits.quitarOperador).not.toHaveBeenCalled();
      // El recinto sí se puede intercambiar: no mueve a nadie de columna.
      await service.intercambiar('p1', 'p2', 'RECINTO');
      expect(prisma.parejaCda.update).toHaveBeenCalled();
    });

    it('recinto: suelta los dos kits (antes comprueba que se pueda), intercambia los recintos y reaplica los dos', async () => {
      await service.intercambiar('p1', 'p2', 'RECINTO', 'Cambio de sede');

      expect(prisma.kitElectoral.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['k1', 'k2'] }, eventoId: 'ev2' });
      expect(kits.quitarOperador.mock.calls).toEqual([
        ['k1', 'Cambio de sede', true],
        ['k2', 'Cambio de sede', true],
        ['k1', 'Cambio de sede'],
        ['k2', 'Cambio de sede'],
      ]);
      expect(prisma.parejaCda.update.mock.calls.map((c) => c[0])).toEqual([
        { where: { id: 'p1' }, data: { recintoId: 'r2', kitId: 'k2' } },
        { where: { id: 'p2' }, data: { recintoId: 'r1', kitId: 'k1' } },
      ]);
      expect(prisma.parejaCda.update.mock.invocationCallOrder[1]).toBeLessThan(kits.quitarOperador.mock.invocationCallOrder[2]);
      expect(prisma.parejaCda.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { fecha: FECHA, recintoId: { not: null } } }));
    });

    it('operador: cada operador queda con el asistente y el recinto del otro, sin chocar con "ya tiene pareja ese día"', async () => {
      await service.intercambiar('p1', 'p2', 'OPERADOR');

      expect(prisma.parejaCda.update.mock.calls.map((c) => c[0])).toEqual([
        { where: { id: 'p1' }, data: { asistenteCdaId: null } },
        { where: { id: 'p2' }, data: { asistenteCdaId: 'as1', recintoId: 'r1', articulos: null, kitId: 'k1' } },
        { where: { id: 'p1' }, data: { asistenteCdaId: 'as2', recintoId: 'r2', articulos: 'LAP', kitId: 'k2' } },
      ]);
      expect(kits.quitarOperador).toHaveBeenCalledTimes(4);
    });

    it('asistente: intercambia los asistentes y reaplica los dos recintos (puede cambiar quién tiene Android)', async () => {
      await service.intercambiar('p1', 'p2', 'ASISTENTE');

      expect(prisma.parejaCda.update.mock.calls.map((c) => c[0])).toEqual([
        { where: { id: 'p1' }, data: { asistenteCdaId: null } },
        { where: { id: 'p2' }, data: { asistenteCdaId: 'as1' } },
        { where: { id: 'p1' }, data: { asistenteCdaId: 'as2' } },
      ]);
      expect(kits.quitarOperador).toHaveBeenCalledTimes(4);
      expect(prisma.parejaCda.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { fecha: FECHA, recintoId: { not: null } } }));
    });

    it('si un kit ya salió de la Delegación, no cambia nada y dice cuál', async () => {
      prisma.kitElectoral.findMany.mockResolvedValueOnce([
        { id: 'k1', codigoUnico: 'KIT-1', estado: 'ASIGNADO', operadorId: 'u1' },
        { id: 'k2', codigoUnico: 'KIT-2', estado: 'RETORNADO', operadorId: 'u2' },
      ]);

      await expect(service.intercambiar('p1', 'p2', 'RECINTO')).rejects.toThrow(
        'El kit KIT-2 ya salió de la Delegación: no se puede cambiar su pareja',
      );
      expect(prisma.parejaCda.update).not.toHaveBeenCalled();
      expect(kits.quitarOperador).not.toHaveBeenCalled();
    });

    it('cada pareja se lleva el kit de su nuevo recinto (con dos parejas en el recinto, el kit no se va a la otra)', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ id: 'p3', creadoEn: new Date('2026-10-28T08:00:00Z'), recintoId: 'r2', operador: { ...OPERADOR, id: 'op3', usuarioId: 'u3' } }),
        pareja({ recintoId: 'r2', kitId: 'k2', operador: { ...OPERADOR, usuarioId: 'u1' } }),
      ]);
      // k2 es de p1: la otra pareja del recinto no lo encuentra como libre y recibe uno propio.
      prisma.kitElectoral.findFirst.mockImplementation(({ where }: { where: { id?: string } }) =>
        Promise.resolve(where.id === 'k2' ? { id: 'k2', operadorId: null, estado: 'ASIGNADO' } : null),
      );

      await service.intercambiar('p1', 'p2', 'RECINTO');

      expect(kits.asignar).toHaveBeenCalledWith('k2', { operadorId: 'u1' });
      expect(kits.asignar).toHaveBeenCalledWith('kNuevo', { operadorId: 'u3' });
      expect(kits.asignar).not.toHaveBeenCalledWith('k2', { operadorId: 'u3' });
    });

    it('jornada iniciada: sin justificación no cambia nada, aunque las parejas no tengan kit', async () => {
      kits.estaCongelado.mockReturnValue(true);
      prisma.parejaCda.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'p1' ? { ...P1, kitId: null } : { ...P2, kitId: null }),
      );

      await expect(service.intercambiar('p1', 'p2', 'RECINTO')).rejects.toThrow(BadRequestException);
      expect(prisma.parejaCda.update).not.toHaveBeenCalled();
    });

    it('intercambios que no cambian nada: 400', async () => {
      prisma.parejaCda.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'p1' ? P1 : { ...P2, recintoId: 'r1', asistenteCdaId: 'as1' }),
      );
      await expect(service.intercambiar('p1', 'p2', 'RECINTO')).rejects.toThrow('Las dos parejas ya tienen ese recinto');
      await expect(service.intercambiar('p1', 'p2', 'ASISTENTE')).rejects.toThrow('Las dos parejas ya tienen ese asistente');
      expect(prisma.parejaCda.update).not.toHaveBeenCalled();
    });

    it('si no se puede soltar un kit (jornada, evento reabierto), no se guarda nada', async () => {
      kits.quitarOperador.mockRejectedValueOnce(new BadRequestException('Las asignaciones están congeladas'));
      await expect(service.intercambiar('p1', 'p2', 'RECINTO')).rejects.toThrow('congeladas');
      expect(prisma.parejaCda.update).not.toHaveBeenCalled();
    });

    it('si la transacción choca (asistente ya emparejado), ningún kit queda suelto', async () => {
      prisma.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: 'uq_parejas_cda_fecha_asistente' } }),
      );
      await expect(service.intercambiar('p1', 'p2', 'OPERADOR')).rejects.toThrow('Ese asistente ya tiene pareja el 2026-10-30');
      expect(kits.quitarOperador.mock.calls).toEqual([
        ['k1', undefined, true],
        ['k2', undefined, true],
      ]);
    });

    it('pareja sin asistente: el otro pasa a tenerlo y ella queda sin asistente', async () => {
      prisma.parejaCda.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'p1' ? { ...P1, asistenteCdaId: null } : P2),
      );
      await service.intercambiar('p1', 'p2', 'ASISTENTE');
      expect(prisma.parejaCda.update.mock.calls.map((c) => c[0].data)).toEqual([
        { asistenteCdaId: null },
        { asistenteCdaId: null },
        { asistenteCdaId: 'as2' },
      ]);
    });

    it('solo entre dos parejas distintas del mismo día', async () => {
      await expect(service.intercambiar('p1', 'p1', 'RECINTO')).rejects.toThrow(BadRequestException);
      prisma.parejaCda.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'p1' ? P1 : { ...P2, fecha: new Date('2026-10-28T00:00:00Z') }),
      );
      await expect(service.intercambiar('p1', 'p2', 'RECINTO')).rejects.toThrow('Las dos parejas deben ser del mismo día');
      expect(prisma.parejaCda.update).not.toHaveBeenCalled();
    });
  });

  describe('el kit (la app y el nombre del QR) va a quien tiene Android', () => {
    const IPHONE = (x: object) => ({ ...x, dispositivo: 'IPHONE' });
    const ANDROID = (x: object) => ({ ...x, dispositivo: 'ANDROID' });

    it('operador con iPhone y asistente con Android: el kit va al asistente', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja({ operador: IPHONE(OPERADOR), asistente: ANDROID(ASISTENTE) })]);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: 'k1', operadorId: null, estado: 'EN_BODEGA' });
      await service.aplicar(DIA);
      expect(kits.asignar).toHaveBeenCalledWith('k1', { operadorId: 'u2' });
    });

    it('pareja de dos asistentes: el kit va al de Android; si nadie lo tiene, al de la primera columna', async () => {
      const AS2 = { ...ASISTENTE, id: 'as2', usuarioId: 'u5' };
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ operadorCdaId: 'as1', asistenteCdaId: 'as2', operador: IPHONE(ASISTENTE), asistente: ANDROID(AS2) }),
      ]);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: 'k1', operadorId: null, estado: 'EN_BODEGA' });
      await service.aplicar(DIA);
      expect(kits.asignar).toHaveBeenCalledWith('k1', { operadorId: 'u5' });

      kits.asignar.mockClear();
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ operadorCdaId: 'as1', asistenteCdaId: 'as2', operador: IPHONE(ASISTENTE), asistente: IPHONE(AS2) }),
      ]);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: 'k1', operadorId: null, estado: 'EN_BODEGA' });
      await service.aplicar(DIA);
      expect(kits.asignar).toHaveBeenCalledWith('k1', { operadorId: 'u2' });
    });

    it('operador con Android: el kit es del operador aunque el asistente también tenga Android', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja({ operador: ANDROID(OPERADOR), asistente: ANDROID(ASISTENTE) })]);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: 'k1', operadorId: null, estado: 'EN_BODEGA' });
      await service.aplicar(DIA);
      expect(kits.asignar).toHaveBeenCalledWith('k1', { operadorId: 'u1' });
    });

    it('recinto con dos parejas: cada una lleva su kit con su propia gente (no toma a la de Android de la otra)', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ operador: IPHONE(OPERADOR), asistente: IPHONE(ASISTENTE) }),
        pareja({
          id: 'p2',
          operadorCdaId: 'op2',
          asistenteCdaId: 'as2',
          creadoEn: new Date('2026-10-29T12:00:00Z'),
          operador: { ...OPERADOR, id: 'op2', usuarioId: 'u3', dispositivo: 'IPHONE' },
          asistente: { ...ASISTENTE, id: 'as2', usuarioId: null, dispositivo: 'ANDROID' },
        }),
      ]);
      prisma.operadorCda.findUnique.mockResolvedValueOnce({ usuarioId: 'u4' });
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: 'k1', operadorId: null, estado: 'EN_BODEGA' }).mockResolvedValueOnce(null);

      const r = await service.aplicar(DIA);

      // p1 no tiene Android: su kit queda con su operador (y la web avisa que no se podrá rastrear).
      expect(kits.asignar).toHaveBeenNthCalledWith(1, 'k1', { operadorId: 'u1' });
      // p2: se le crea la cuenta a su asistente con Android y lleva un kit propio.
      expect(cuentas.crearOVincular).toHaveBeenCalledWith('as2');
      expect(kits.asignar).toHaveBeenNthCalledWith(2, 'kNuevo', { operadorId: 'u4' });
      expect(r).toMatchObject({ enApp: 2, kitsCreados: 1 });
    });

    it('recinto con dos kits propios y una tercera pareja: cada una con el suyo', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ kitId: 'k1', operador: IPHONE(OPERADOR), asistente: IPHONE(ASISTENTE) }),
        pareja({
          id: 'p2',
          operadorCdaId: 'op2',
          asistenteCdaId: 'as2',
          kitId: 'k2',
          creadoEn: new Date('2026-10-29T11:00:00Z'),
          operador: { ...OPERADOR, id: 'op2', usuarioId: 'u3', dispositivo: 'IPHONE' },
          asistente: { ...ASISTENTE, id: 'as2', usuarioId: 'u4', dispositivo: 'IPHONE' },
        }),
        pareja({
          id: 'p3',
          operadorCdaId: 'op3',
          asistenteCdaId: null,
          asistente: null,
          creadoEn: new Date('2026-10-29T12:00:00Z'),
          operador: { ...OPERADOR, id: 'op3', usuarioId: 'u5', dispositivo: 'ANDROID' },
        }),
      ]);
      prisma.kitElectoral.findFirst
        .mockResolvedValueOnce({ id: 'k1', operadorId: null, estado: 'ASIGNADO' })
        .mockResolvedValueOnce({ id: 'k2', operadorId: null, estado: 'ASIGNADO' })
        .mockResolvedValueOnce(null);

      await service.aplicar(DIA);

      expect(kits.asignar.mock.calls).toEqual([
        ['k1', { operadorId: 'u1' }],
        ['k2', { operadorId: 'u3' }],
        ['kNuevo', { operadorId: 'u5' }],
      ]);
    });

    it('no elige a una persona oculta aunque tenga Android', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ operador: IPHONE(OPERADOR), asistente: { ...ANDROID(ASISTENTE), activo: false } }),
      ]);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: 'k1', operadorId: null, estado: 'EN_BODEGA' });
      await service.aplicar(DIA);
      expect(kits.asignar).toHaveBeenCalledWith('k1', { operadorId: 'u1' });
    });

    it('portador sin cuenta y kit sin operador: "Sin kit", no "En la app"', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ operador: IPHONE(OPERADOR), asistente: { ...ANDROID(ASISTENTE), usuarioId: null }, kitId: 'k1', kit: { codigoUnico: 'K', eventoId: 'ev2', operadorId: null } }),
      ]);
      const { parejas } = await service.listar(DIA);
      expect(parejas[0].estado).toBe('SIN_KIT');
    });

    it('nadie tiene Android: el kit queda con el operador', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja({ operador: IPHONE(OPERADOR), asistente: IPHONE(ASISTENTE) })]);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: 'k1', operadorId: null, estado: 'EN_BODEGA' });
      await service.aplicar(DIA);
      expect(kits.asignar).toHaveBeenCalledWith('k1', { operadorId: 'u1' });
    });

    it('la lista dice quién lleva el kit y lo marca "En la app" cuando lo tiene el asistente', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ operador: IPHONE(OPERADOR), asistente: ANDROID(ASISTENTE), kitId: 'k1', kit: { codigoUnico: 'KIT-1', eventoId: 'ev2', operadorId: 'u2' } }),
      ]);
      const { parejas } = await service.listar(DIA);
      expect(parejas[0].estado).toBe('EN_APP');
      expect(parejas[0].portador).toMatchObject({ id: 'as1', apellidosNombres: 'RUIZ JUAN', dispositivo: 'ANDROID' });
      expect(parejas[0].portador).not.toHaveProperty('usuarioId');
    });

    it('la segunda pareja del recinto también lleva kit: su portador es de ella', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja(),
        pareja({ id: 'p2', operadorCdaId: 'op2', asistenteCdaId: null, asistente: null, creadoEn: new Date('2026-10-29T12:00:00Z'), operador: { ...OPERADOR, id: 'op2', apellidosNombres: 'SEGUNDO' } }),
      ]);
      const { parejas } = await service.listar(DIA);
      expect(parejas.find((p) => p.id === 'p2')?.portador).toMatchObject({ id: 'op2' });
      expect(parejas.find((p) => p.id === 'p1')?.portador).toMatchObject({ id: 'op1' });
    });

    it('quitar la pareja suelta el kit aunque lo tenga su asistente', async () => {
      prisma.parejaCda.findUnique.mockResolvedValueOnce(
        pareja({ kitId: 'k1', kit: { id: 'k1', operadorId: 'u2', eventoId: 'ev2' }, asistente: { usuarioId: 'u2' } }),
      );
      await service.eliminar('p1');
      expect(kits.quitarOperador).toHaveBeenCalledWith('k1', undefined);
    });
  });

  describe('asignar el kit a una pareja (botón en la fila)', () => {
    beforeEach(() => prisma.parejaCda.findUnique.mockResolvedValue(pareja()));

    it('pasa a la app solo esa pareja: asigna el kit del recinto a su operador', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja(),
        pareja({ id: 'p2', recintoId: 'r2', recinto: { id: 'r2', codigoRecinto: '1126', nombre: 'UE B' }, operador: { ...OPERADOR, id: 'op2', usuarioId: 'u2' } }),
      ]);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: 'k1', operadorId: null, estado: 'EN_BODEGA' });

      const r = await service.asignarKit('p1', 'Llegó tarde a la lista');

      expect(kits.asignar).toHaveBeenCalledTimes(1);
      expect(kits.asignar).toHaveBeenCalledWith('k1', { operadorId: 'u1' });
      expect(r).toMatchObject({ enApp: 1, errores: [] });
    });

    it('sin evento ACTIVO con jornada ese día: 400 que lo explica', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(null);
      await expect(service.asignarKit('p1')).rejects.toThrow(`No hay un evento ACTIVO con jornada el ${DIA}`);
      expect(kits.asignar).not.toHaveBeenCalled();
    });

    it('la segunda pareja del recinto (la otra ya lleva el kit del recinto): recibe otro kit propio y no toca el de la otra', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ id: 'p0', kitId: 'k1', kit: { id: 'k1', operadorId: 'u0', eventoId: 'ev2', estado: 'ASIGNADO' }, operador: { ...OPERADOR, id: 'op0', usuarioId: 'u0' } }),
        pareja(),
      ]);
      // El kit k1 tiene pareja: no hay kit libre en el recinto.
      prisma.kitElectoral.findFirst.mockResolvedValueOnce(null);

      const r = await service.asignarKit('p1');

      expect(kits.create).toHaveBeenCalledWith(expect.objectContaining({ eventoId: 'ev2', recintoId: 'r1', otroDispositivo: true }));
      expect(kits.asignar).toHaveBeenCalledWith('kNuevo', { operadorId: 'u1' });
      expect(prisma.parejaCda.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', kitId: null }, data: { kitId: 'kNuevo' } });
      expect(r).toMatchObject({ enApp: 1, kitsCreados: 1, errores: [] });
    });

    it('doble clic / dos administradores: si la pareja ya recibió otro kit, no asigna y borra el kit recién creado', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja()]);
      prisma.parejaCda.updateMany.mockResolvedValueOnce({ count: 0 });

      const r = await service.asignarKit('p1');

      expect(kits.create).toHaveBeenCalledTimes(1);
      expect(prisma.kitElectoral.delete).toHaveBeenCalledWith({ where: { id: 'kNuevo' } });
      expect(kits.asignar).not.toHaveBeenCalled();
      expect(r.errores).toEqual([{ pareja: 'PÉREZ ANA · 957', error: expect.stringContaining('Otro pedido asignó este kit al mismo tiempo') }]);
    });

    it('si otra pareja tomó el mismo kit libre a la vez, se deshace el vínculo y no se asigna', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja()]);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: 'kLibre', operadorId: null, estado: 'EN_BODEGA' });
      prisma.parejaCda.count.mockResolvedValueOnce(1);

      const r = await service.asignarKit('p1');

      expect(prisma.parejaCda.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { kitId: null } });
      // El kit libre no era nuevo: no se borra.
      expect(prisma.kitElectoral.delete).not.toHaveBeenCalled();
      expect(kits.asignar).not.toHaveBeenCalled();
      expect(r.errores).toHaveLength(1);
    });

    it('el kit se vincula a la pareja antes de asignarlo (si asignar falla, la próxima vez usa el mismo y no crea otro)', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja()]);
      kits.asignar.mockRejectedValueOnce(new ConflictException('Este operador ya tiene kits asignados a otro recinto en este evento'));

      const r = await service.asignarKit('p1');

      expect(prisma.parejaCda.updateMany.mock.invocationCallOrder[0]).toBeLessThan(kits.asignar.mock.invocationCallOrder[0]);
      expect(prisma.kitElectoral.delete).not.toHaveBeenCalled();
      expect(r.errores).toEqual([{ pareja: 'PÉREZ ANA · 957', error: 'Este operador ya tiene kits asignados a otro recinto en este evento' }]);
    });

    it('recinto al tope de kits: el error vuelve en errores y las demás parejas siguen', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja(),
        pareja({ id: 'p2', recintoId: 'r2', recinto: { id: 'r2', codigoRecinto: '1126', nombre: 'UE B' }, operador: { ...OPERADOR, id: 'op2', usuarioId: 'u2', apellidosNombres: 'SEGUNDO' } }),
      ]);
      kits.create.mockRejectedValueOnce(new ConflictException('Este recinto ya tiene 5 kits (el máximo)'));

      const r = await service.aplicar(DIA);

      expect(r).toMatchObject({ enApp: 1, kitsCreados: 1, errores: [{ pareja: 'PÉREZ ANA · 957', error: 'Este recinto ya tiene 5 kits (el máximo)' }] });
      expect(kits.asignar).toHaveBeenCalledWith('kNuevo', { operadorId: 'u2' });
    });

    it('una pareja sin kit toma primero un kit libre del recinto (sin pareja) antes de crear otro', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja()]);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: 'kLibre', operadorId: null, estado: 'EN_BODEGA' });

      await service.asignarKit('p1');

      expect(prisma.kitElectoral.findFirst.mock.calls[0][0].where).toEqual({ eventoId: 'ev2', recintoId: 'r1', esPrueba: false, parejasCda: { none: {} }, estado: { in: ['EN_BODEGA', 'ASIGNADO'] } });
      expect(kits.create).not.toHaveBeenCalled();
      expect(kits.asignar).toHaveBeenCalledWith('kLibre', { operadorId: 'u1' });
    });

    it('si el kit no se puede asignar (p. ej. jornada iniciada sin justificación), el motivo vuelve en errores', async () => {
      kits.estaCongelado.mockReturnValue(true);
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja()]);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: 'k1', operadorId: null, estado: 'EN_BODEGA' });
      const r = await service.asignarKit('p1');
      expect(r.errores).toEqual([{ pareja: 'PÉREZ ANA · 957', error: expect.stringContaining('congeladas') }]);
      expect(kits.asignar).not.toHaveBeenCalled();
    });

    it('pareja inexistente: 404', async () => {
      prisma.parejaCda.findUnique.mockResolvedValueOnce(null);
      await expect(service.asignarKit('nada')).rejects.toThrow('Pareja no encontrada');
    });

  });

  it('la lista trae el dispositivo de cada persona', async () => {
    await service.listar(DIA);
    const include = prisma.parejaCda.findMany.mock.calls[0][0].include;
    expect(include.operador.select.dispositivo).toBe(true);
    expect(include.asistente.select.dispositivo).toBe(true);
  });

  describe('pasar personal a reserva', () => {
    const datos = { fecha: DIA, operadores: ['op1'], asistentes: ['as1'] };
    const personas = [
      { id: 'op1', grupo: 'OPERADOR', activo: true },
      { id: 'as1', grupo: 'ASISTENTE', activo: true },
    ];

    it('crea una reserva por persona, sin recinto ni kit', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce(personas);

      await expect(service.crearReservas(datos, 'admin')).resolves.toEqual({ creadas: 2 });

      const { data } = prisma.parejaCda.createMany.mock.calls[0][0];
      expect(data).toEqual([
        expect.objectContaining({ fecha: FECHA, operadorCdaId: 'op1', asistenteCdaId: null, recintoId: null, creadoPorId: 'admin' }),
        expect.objectContaining({ fecha: FECHA, operadorCdaId: null, asistenteCdaId: 'as1', recintoId: null, creadoPorId: 'admin' }),
      ]);
      expect(data[0].creadoEn.getTime()).toBeLessThan(data[1].creadoEn.getTime());
      expect(data[0]).not.toHaveProperty('kitId');
    });

    it.each([
      ['oculta', [{ id: 'op1', grupo: 'OPERADOR', activo: false }, personas[1]]],
      ['de otro cargo', [{ id: 'op1', grupo: 'ASISTENTE', activo: true }, personas[1]]],
      ['inexistente', [personas[1]]],
    ])('rechaza a una persona %s sin crear nada', async (_n, encontradas) => {
      prisma.operadorCda.findMany.mockResolvedValueOnce(encontradas);

      await expect(service.crearReservas(datos, 'admin')).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.parejaCda.createMany).not.toHaveBeenCalled();
    });

    it('rechaza si alguien ya tiene pareja o reserva ese día', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce(personas);
      prisma.parejaCda.findFirst.mockResolvedValueOnce({ id: 'p1' });

      await expect(service.crearReservas(datos, 'admin')).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.parejaCda.findFirst.mock.calls[0][0].where).toEqual({
        fecha: FECHA,
        OR: [{ operadorCdaId: { in: ['op1', 'as1'] } }, { asistenteCdaId: { in: ['op1', 'as1'] } }],
      });
      expect(prisma.parejaCda.createMany).not.toHaveBeenCalled();
    });
  });

  describe('copiar la lista a otro día', () => {
    const HACIA = '2026-11-04';
    const B = pareja({
      id: 'p2',
      recintoId: 'r2',
      recinto: { id: 'r2', codigoRecinto: '1126', nombre: 'UE B' },
      operadorCdaId: 'op2',
      asistenteCdaId: null,
      articulos: 'LAP',
      kitId: 'k2',
      operador: { ...OPERADOR, id: 'op2', apellidosNombres: 'MORA LUIS' },
      asistente: null,
    });

    beforeEach(() => {
      prisma.parejaCda.findMany.mockReset();
      prisma.operadorCda.findMany.mockResolvedValue([
        { id: 'op1', grupo: 'OPERADOR' },
        { id: 'as1', grupo: 'ASISTENTE' },
        { id: 'op2', grupo: 'OPERADOR' },
      ]);
      prisma.recinto.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
    });

    it('una pareja anterior a la regla (dos operadores o cargos al revés) no se copia: queda como historial', async () => {
      const DOS_OP = pareja({ asistenteCdaId: 'op2', asistente: { ...OPERADOR, id: 'op2', apellidosNombres: 'MORA LUIS' } });
      const AL_REVES = pareja({ id: 'p9', recintoId: 'r2', operadorCdaId: 'as1', asistenteCdaId: null, operador: { ...ASISTENTE }, asistente: null });
      prisma.parejaCda.findMany.mockResolvedValueOnce([DOS_OP, AL_REVES]).mockResolvedValueOnce([]);

      const r = await service.copiar(DIA, HACIA, 'uAdmin');

      expect(prisma.operadorCda.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['op1', 'op2', 'as1'] }, activo: true });
      expect(prisma.parejaCda.createMany).not.toHaveBeenCalled();
      expect(r).toEqual({
        copiadas: 0,
        omitidas: [
          { pareja: 'PÉREZ ANA · 957', motivo: 'El asistente ya no está disponible (oculto o no es Asistente CDA)' },
          { pareja: 'RUIZ JUAN · 957', motivo: 'El operador ya no está disponible (oculto o no es Operador CDA)' },
        ],
      });
    });

    it('omite la pareja cuyo recinto fue desactivado', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja(), B]).mockResolvedValueOnce([]);
      prisma.recinto.findMany.mockResolvedValueOnce([{ id: 'r1' }]);

      const r = await service.copiar(DIA, HACIA, 'uAdmin');

      expect(prisma.recinto.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['r1', 'r2'] }, activo: true, tipo: 'CDA' });
      expect(r).toEqual({ copiadas: 1, omitidas: [{ pareja: 'MORA LUIS · 1126', motivo: 'El recinto ya no está activo' }] });
    });

    it('si otro administrador copió al mismo tiempo (choque de únicos): 409, sin copia a medias', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja()]).mockResolvedValueOnce([]);
      prisma.parejaCda.createMany.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x', meta: { target: 'uq_parejas_cda_fecha_operador' } }),
      );
      await expect(service.copiar(DIA, HACIA, 'uAdmin')).rejects.toThrow(ConflictException);
    });

    it('copia operador, asistente, recinto y artículos (sin kit ni paso a la app), en el mismo orden', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja({ kitId: 'k1' }), B]).mockResolvedValueOnce([]);

      const r = await service.copiar(DIA, HACIA, 'uAdmin');

      expect(prisma.parejaCda.findMany.mock.calls[0][0].where).toEqual({ fecha: FECHA });
      expect(prisma.parejaCda.findMany.mock.calls[1][0].where).toEqual({ fecha: new Date(`${HACIA}T00:00:00Z`) });
      const data = prisma.parejaCda.createMany.mock.calls[0][0].data;
      expect(data.map(({ creadoEn, ...d }: { creadoEn: Date }) => d)).toEqual([
        { fecha: new Date(`${HACIA}T00:00:00Z`), recintoId: 'r1', operadorCdaId: 'op1', asistenteCdaId: 'as1', articulos: null, creadoPorId: 'uAdmin' },
        { fecha: new Date(`${HACIA}T00:00:00Z`), recintoId: 'r2', operadorCdaId: 'op2', asistenteCdaId: null, articulos: 'LAP', creadoPorId: 'uAdmin' },
      ]);
      expect(data[0].creadoEn.getTime()).toBeLessThan(data[1].creadoEn.getTime());
      expect(kits.asignar).not.toHaveBeenCalled();
      expect(kits.create).not.toHaveBeenCalled();
      expect(r).toEqual({ copiadas: 2, omitidas: [] });
    });

    it('omite, con el motivo, a quien ya tiene pareja ese día o está oculto', async () => {
      const C = pareja({ id: 'p3', operadorCdaId: 'op3', asistenteCdaId: 'as3', operador: { ...OPERADOR, id: 'op3', apellidosNombres: 'VEGA RITA' } });
      const D = pareja({ id: 'p4', operadorCdaId: 'op4', asistenteCdaId: null, asistente: null, operador: { ...OPERADOR, id: 'op4', apellidosNombres: 'OCULTO' } });
      prisma.parejaCda.findMany
        .mockResolvedValueOnce([pareja(), B, C, D])
        .mockResolvedValueOnce([{ operadorCdaId: 'op2', asistenteCdaId: 'as3' }]);
      prisma.operadorCda.findMany.mockResolvedValueOnce([
        { id: 'op1', grupo: 'OPERADOR' },
        { id: 'as1', grupo: 'ASISTENTE' },
        { id: 'op2', grupo: 'OPERADOR' },
        { id: 'op3', grupo: 'OPERADOR' },
        { id: 'as3', grupo: 'ASISTENTE' },
      ]);

      const r = await service.copiar(DIA, HACIA, 'uAdmin');

      expect(prisma.parejaCda.createMany.mock.calls[0][0].data).toHaveLength(1);
      expect(r).toEqual({
        copiadas: 1,
        omitidas: [
          { pareja: 'MORA LUIS · 1126', motivo: 'El operador ya tiene pareja ese día' },
          { pareja: 'VEGA RITA · 957', motivo: 'El asistente ya tiene pareja ese día' },
          { pareja: 'OCULTO · 957', motivo: 'El operador ya no está disponible (oculto o no es Operador CDA)' },
        ],
      });
    });

    it('si nada se puede copiar, no escribe', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja()]).mockResolvedValueOnce([{ operadorCdaId: 'op1', asistenteCdaId: null }]);
      const r = await service.copiar(DIA, HACIA, 'uAdmin');
      expect(prisma.parejaCda.createMany).not.toHaveBeenCalled();
      expect(r.copiadas).toBe(0);
    });

    it('el mismo día o un día sin parejas: 400', async () => {
      await expect(service.copiar(DIA, DIA, 'uAdmin')).rejects.toThrow(BadRequestException);
      prisma.parejaCda.findMany.mockResolvedValueOnce([]);
      await expect(service.copiar(DIA, HACIA, 'uAdmin')).rejects.toThrow(`El ${DIA} no tiene parejas para copiar`);
    });
  });

  describe('eliminar y QR', () => {
    it('quitar la pareja le quita el kit del evento activo al operador', async () => {
      prisma.parejaCda.findUnique.mockResolvedValueOnce(
        pareja({ kitId: 'k1', kit: { id: 'k1', operadorId: 'u1', eventoId: 'ev2' } }),
      );
      await service.eliminar('p1', 'Se enfermó');
      expect(kits.quitarOperador).toHaveBeenCalledWith('k1', 'Se enfermó');
      expect(prisma.parejaCda.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    });

    it('quitar no toca el kit si lo tiene otra persona, ni si es de un evento que ya no está activo', async () => {
      prisma.parejaCda.findUnique.mockResolvedValueOnce(pareja({ kitId: 'k1', kit: { id: 'k1', operadorId: 'otro', eventoId: 'ev2' } }));
      await service.eliminar('p1');
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(null);
      prisma.parejaCda.findUnique.mockResolvedValueOnce(pareja({ kitId: 'k1', kit: { id: 'k1', operadorId: 'u1', eventoId: 'ev1' } }));
      await service.eliminar('p1');
      expect(kits.quitarOperador).not.toHaveBeenCalled();
      expect(prisma.parejaCda.delete).toHaveBeenCalledTimes(2);
    });

    it('si el kit ya salió (no se puede quitar el operador), la pareja no se borra', async () => {
      prisma.parejaCda.findUnique.mockResolvedValueOnce(pareja({ kitId: 'k1', kit: { id: 'k1', operadorId: 'u1', eventoId: 'ev2' } }));
      kits.quitarOperador.mockRejectedValueOnce(new ConflictException('El kit ya salió'));
      await expect(service.eliminar('p1')).rejects.toThrow('El kit ya salió');
      expect(prisma.parejaCda.delete).not.toHaveBeenCalled();
    });

    it('QR de la lista: solo los kits de sus parejas; sin kits responde 400', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([{ kitId: 'k1' }, { kitId: 'k2' }]);
      await service.qr(DIA);
      expect(kits.generatePdfQr).toHaveBeenCalledWith({ kitIds: ['k1', 'k2'] });

      prisma.parejaCda.findMany.mockResolvedValueOnce([]);
      await expect(service.qr(DIA)).rejects.toThrow(BadRequestException);
    });
  });

  describe('parejas de reserva (sin recinto)', () => {
    const RESERVA = pareja({ id: 'pR', recintoId: null, recinto: null, operadorCdaId: 'op7', asistenteCdaId: null, asistente: null, operador: { ...OPERADOR, id: 'op7', apellidosNombres: 'SOLANO PEDRO', usuarioId: 'u7' } });
    /** findMany de parejas: las de reserva solo cuando se piden (recintoId: null). */
    const delDia = (titulares: unknown[], reserva: unknown[]) =>
      prisma.parejaCda.findMany.mockImplementation(({ where }: { where?: { recintoId?: unknown } }) =>
        Promise.resolve(where?.recintoId === null ? reserva : titulares),
      );

    it('listar: las de reserva van aparte, sin recinto ni kit, y no entran a la lista de recintos', async () => {
      delDia([pareja()], [RESERVA]);

      const dia = await service.listar(DIA);

      expect(dia.parejas.map((p) => p.id)).toEqual(['p1']);
      expect(dia.reserva).toMatchObject([
        { id: 'pR', fecha: DIA, operador: { id: 'op7', apellidosNombres: 'SOLANO PEDRO', dispositivo: null }, asistente: null },
      ]);
      expect(prisma.parejaCda.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { fecha: FECHA, recintoId: null } }));
    });

    it('importar: RESERVA en codigo_recinto deja la pareja registrada sin recinto y no la pasa a la app', async () => {
      prisma.operadorCda.findMany.mockResolvedValue([{ id: 'op1', cedula: '1710034065', grupo: 'OPERADOR', activo: true, apellidosNombres: 'PÉREZ ANA' }]);
      prisma.recinto.findMany.mockResolvedValue([{ id: 'r1', codigoRecinto: '957', nombre: 'UE ATAHUALPA', tipo: 'CDA' }]);
      prisma.parejaCda.create.mockResolvedValueOnce({ id: 'pR' });
      const file = await plantilla([{ cedula_operador: '1710034065', codigo_recinto: 'reserva' }]);

      const previa = await service.importar(file, DIA, false, 'admin');
      expect(previa.filas[0]).toMatchObject({ reserva: true, recinto: null, errores: [] });

      const r = await service.importar(await plantilla([{ cedula_operador: '1710034065', codigo_recinto: 'RESERVA' }]), DIA, true, 'admin');
      expect(prisma.parejaCda.create.mock.calls[0][0].data).toMatchObject({ operadorCdaId: 'op1', recintoId: null });
      expect(r.guardadas).toBe(1);
      expect(r.app).toMatchObject({ enApp: 0, kitsCreados: 0 });
      expect(kits.create).not.toHaveBeenCalled();
      expect(kits.asignar).not.toHaveBeenCalled();
    });

    it('pasar a reserva: suelta el kit (antes comprueba), deja la pareja sin recinto ni kit y reaplica el recinto', async () => {
      prisma.parejaCda.findUnique.mockResolvedValueOnce(pareja({ kitId: 'k1', kit: { id: 'k1', operadorId: 'u1', eventoId: 'ev2', estado: 'ASIGNADO' } }));

      await service.pasarAReserva('p1', 'Se cambió de turno');

      expect(kits.quitarOperador.mock.calls).toEqual([
        ['k1', 'Se cambió de turno', true],
        ['k1', 'Se cambió de turno'],
      ]);
      expect(prisma.parejaCda.updateMany).toHaveBeenCalledWith({ where: { id: 'p1', recintoId: 'r1' }, data: { recintoId: null, kitId: null } });
      expect(prisma.parejaCda.updateMany.mock.invocationCallOrder[0]).toBeLessThan(kits.quitarOperador.mock.invocationCallOrder[1]);
    });

    it('pasar a reserva con doble clic: el segundo pedido no suelta el kit otra vez', async () => {
      prisma.parejaCda.findUnique.mockResolvedValueOnce(pareja({ kitId: 'k1', kit: { id: 'k1', operadorId: 'u1', eventoId: 'ev2', estado: 'ASIGNADO' } }));
      prisma.parejaCda.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.pasarAReserva('p1')).rejects.toThrow(ConflictException);
      expect(kits.quitarOperador.mock.calls).toEqual([['k1', undefined, true]]);
    });

    it('asignar recinto con doble clic: el segundo pedido no la ubica dos veces', async () => {
      prisma.parejaCda.findUnique.mockResolvedValueOnce(RESERVA);
      prisma.recinto.findUnique.mockResolvedValueOnce({ activo: true, tipo: 'CDA', codigoRecinto: '957', nombre: 'UE ATAHUALPA' });
      prisma.parejaCda.updateMany.mockResolvedValueOnce({ count: 0 });
      delDia([], []);

      await expect(service.asignarRecinto('pR', 'r1')).rejects.toThrow(ConflictException);
    });

    it('editar no ubica una pareja de reserva (eso es "Asignar a recinto"), pero sí le cambia el asistente', async () => {
      prisma.parejaCda.findUnique.mockResolvedValue(RESERVA);
      await expect(service.editar('pR', { recintoId: 'r1' })).rejects.toThrow('Esta pareja es de reserva: use "Asignar a recinto"');

      prisma.operadorCda.findUnique.mockResolvedValue({ grupo: 'ASISTENTE', activo: true });
      await service.editar('pR', { asistenteCdaId: 'as1' });
      expect(prisma.parejaCda.update).toHaveBeenCalledWith({ where: { id: 'pR' }, data: { operadorCdaId: 'op7', asistenteCdaId: 'as1' } });
    });

    it('intercambiar el recinto entre dos parejas de reserva no tiene sentido', async () => {
      prisma.parejaCda.findUnique.mockResolvedValue(RESERVA);
      await expect(service.intercambiar('pR', 'pR2', 'RECINTO')).rejects.toThrow('Las dos parejas son de reserva');
    });

    it('importar: una reserva con artículos avisa que se usan al asignarle recinto', async () => {
      prisma.operadorCda.findMany.mockResolvedValue([{ id: 'op1', cedula: '1710034065', grupo: 'OPERADOR', activo: true, apellidosNombres: 'PÉREZ ANA' }]);
      const file = await plantilla([{ cedula_operador: '1710034065', codigo_recinto: 'RESERVA', articulos: 'LAP' }]);

      const r = await service.importar(file, DIA, false, 'admin');

      expect(r.filas[0].errores).toEqual([]);
      expect(r.filas[0].avisos).toContain('Pareja de reserva: los artículos se usan cuando se le asigne un recinto');
    });

    it('pasar a reserva: si el kit ya salió de la Delegación no cambia nada; una de reserva no se vuelve a pasar', async () => {
      prisma.parejaCda.findUnique.mockResolvedValueOnce(
        pareja({ kitId: 'k1', kit: { id: 'k1', operadorId: 'u1', eventoId: 'ev2', estado: 'EN_TRANSITO', codigoUnico: 'KIT-1' } }),
      );
      await expect(service.pasarAReserva('p1')).rejects.toThrow(ConflictException);

      prisma.parejaCda.findUnique.mockResolvedValueOnce(RESERVA);
      await expect(service.pasarAReserva('pR')).rejects.toThrow('Esta pareja ya es de reserva');
      expect(prisma.parejaCda.update).not.toHaveBeenCalled();
      expect(kits.quitarOperador).not.toHaveBeenCalled();
    });

    it('asignar a un recinto libre: la ubica (solo si sigue de reserva) y la pasa a la app', async () => {
      prisma.parejaCda.findUnique.mockResolvedValueOnce(RESERVA);
      prisma.recinto.findUnique.mockResolvedValueOnce({ activo: true, tipo: 'CDA', codigoRecinto: '957', nombre: 'UE ATAHUALPA' });
      delDia([], []);

      await service.asignarRecinto('pR', 'r1');

      expect(prisma.parejaCda.updateMany).toHaveBeenCalledWith({ where: { id: 'pR', recintoId: null }, data: { recintoId: 'r1' } });
      expect(prisma.parejaCda.update).not.toHaveBeenCalled();
    });

    it('asignar a un recinto con pareja: se intercambian (la titular pasa a reserva y le cede su kit)', async () => {
      const TITULAR = pareja({ kitId: 'k1', kit: { id: 'k1', operadorId: 'u1', eventoId: 'ev2', estado: 'ASIGNADO' } });
      prisma.parejaCda.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === 'pR' ? RESERVA : where.id === 'p1' ? TITULAR : null),
      );
      prisma.recinto.findUnique.mockResolvedValueOnce({ activo: true, tipo: 'CDA', codigoRecinto: '957', nombre: 'UE ATAHUALPA' });
      prisma.kitElectoral.findMany.mockResolvedValue([{ id: 'k1', codigoUnico: 'KIT-1', estado: 'ASIGNADO', operadorId: 'u1' }]);
      delDia([TITULAR], [RESERVA]);

      await service.asignarRecinto('pR', 'r1', 'Reemplazo');

      // (las siguientes son del paso a la app con la lista simulada, que no cambia)
      expect(prisma.parejaCda.update.mock.calls.slice(0, 2).map((c) => c[0])).toEqual([
        { where: { id: 'pR' }, data: { recintoId: 'r1', kitId: 'k1' } },
        { where: { id: 'p1' }, data: { recintoId: null, kitId: null } },
      ]);
      expect(kits.quitarOperador).toHaveBeenCalledWith('k1', 'Reemplazo');
    });

    it('asignar recinto: rechaza una pareja que ya tiene recinto y un recinto que no es CDA', async () => {
      prisma.parejaCda.findUnique.mockResolvedValueOnce(pareja());
      await expect(service.asignarRecinto('p1', 'r2')).rejects.toThrow(BadRequestException);

      prisma.parejaCda.findUnique.mockResolvedValueOnce(RESERVA);
      prisma.recinto.findUnique.mockResolvedValueOnce({ activo: true, tipo: 'NO_CDA', codigoRecinto: '20', nombre: 'X' });
      await expect(service.asignarRecinto('pR', 'rNo')).rejects.toThrow('El recinto no es CDA');
      expect(prisma.parejaCda.updateMany).not.toHaveBeenCalled();
    });

    it('copiar la lista lleva también las parejas de reserva (sin recinto)', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja(), RESERVA]).mockResolvedValueOnce([]);
      prisma.operadorCda.findMany.mockResolvedValue([
        { id: 'op1', grupo: 'OPERADOR' },
        { id: 'as1', grupo: 'ASISTENTE' },
        { id: 'op7', grupo: 'OPERADOR' },
      ]);
      prisma.recinto.findMany.mockResolvedValue([{ id: 'r1' }]);

      const r = await service.copiar(DIA, '2026-11-05', 'uAdmin');

      expect(r).toEqual({ copiadas: 2, omitidas: [] });
      expect(prisma.recinto.findMany.mock.calls[0][0].where.id).toEqual({ in: ['r1'] });
      expect(prisma.parejaCda.createMany.mock.calls[0][0].data.map((d: { recintoId: string | null }) => d.recintoId)).toEqual(['r1', null]);
    });

    it('copiar: una pareja de reserva cuyo operador ya tiene pareja ese día se omite y lo dice', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([RESERVA]).mockResolvedValueOnce([{ operadorCdaId: 'op7', asistenteCdaId: null }]);
      prisma.operadorCda.findMany.mockResolvedValue([{ id: 'op7', grupo: 'OPERADOR' }]);

      const r = await service.copiar(DIA, '2026-11-05', 'uAdmin');

      expect(r).toEqual({ copiadas: 0, omitidas: [{ pareja: 'SOLANO PEDRO · Reserva', motivo: 'El operador ya tiene pareja ese día' }] });
    });

    it('una pareja de reserva no recibe kit hasta tener recinto', async () => {
      prisma.parejaCda.findUnique.mockResolvedValue(RESERVA);
      await expect(service.asignarKit('pR')).rejects.toThrow('Esta pareja es de reserva: asígnele un recinto para darle kit');
      expect(kits.create).not.toHaveBeenCalled();
    });

    describe('reserva incompleta: solo el asistente', () => {
      const VEGA = { ...ASISTENTE, id: 'as9', apellidosNombres: 'VEGA SAMAEL', cedula: '1004424790', usuarioId: null };
      const SOLO_AS = pareja({ id: 'pA', recintoId: null, recinto: null, operadorCdaId: null, operador: null, asistenteCdaId: 'as9', asistente: VEGA });

      it('listar: sale en la reserva con el operador vacío', async () => {
        delDia([], [SOLO_AS]);
        const dia = await service.listar(DIA);
        expect(dia.reserva).toMatchObject([{ id: 'pA', operador: null, asistente: { id: 'as9', apellidosNombres: 'VEGA SAMAEL' } }]);
      });

      it('importar: RESERVA acepta una fila con solo el asistente (avisa que falta el operador) y la guarda sin él', async () => {
        prisma.operadorCda.findMany.mockResolvedValue([{ id: 'as9', cedula: '1004424790', grupo: 'ASISTENTE', activo: true, apellidosNombres: 'VEGA SAMAEL' }]);
        prisma.parejaCda.create.mockResolvedValueOnce({ id: 'pA' });
        const fila = { cedula_asistente: '1004424790', codigo_recinto: 'RESERVA' };

        const previa = await service.importar(await plantilla([fila]), DIA, false, 'admin');
        expect(previa.filas[0]).toMatchObject({ reserva: true, operador: null, asistente: { cedula: '1004424790' }, errores: [] });
        expect(previa.filas[0].avisos).toContain('Reserva sin operador: complétela antes de asignarle un recinto');

        const r = await service.importar(await plantilla([fila]), DIA, true, 'admin');
        expect(prisma.parejaCda.create.mock.calls[0][0].data).toMatchObject({ operadorCdaId: null, asistenteCdaId: 'as9', recintoId: null });
        expect(r.guardadas).toBe(1);
        expect(prisma.operadorCda.create).not.toHaveBeenCalled();
      });

      it('importar: sin operador solo vale en RESERVA y con asistente', async () => {
        prisma.operadorCda.findMany.mockResolvedValue([{ id: 'as9', cedula: '1004424790', grupo: 'ASISTENTE', activo: true, apellidosNombres: 'VEGA SAMAEL' }]);
        prisma.recinto.findMany.mockResolvedValue([{ id: 'r1', codigoRecinto: '957', nombre: 'UE ATAHUALPA', tipo: 'CDA' }]);
        const file = await plantilla([
          { cedula_asistente: '1004424790', codigo_recinto: '957' },
          { codigo_recinto: 'RESERVA', articulos: 'LAP' },
        ]);

        const r = await service.importar(file, DIA, true, 'admin');

        for (const f of r.filas) expect(f.errores.join(' ')).toContain('Falta el operador: solo una pareja de RESERVA puede ir sin operador');
        expect(r.guardadas).toBe(0);
        expect(prisma.parejaCda.create).not.toHaveBeenCalled();
      });

      it('editar: "Completar" pone al operador; quitarle el asistente la dejaría vacía', async () => {
        prisma.parejaCda.findUnique.mockResolvedValue(SOLO_AS);
        prisma.operadorCda.findUnique.mockResolvedValue({ grupo: 'OPERADOR', activo: true });

        await service.editar('pA', { operadorCdaId: 'op1' });
        expect(prisma.parejaCda.update).toHaveBeenCalledWith({ where: { id: 'pA' }, data: { operadorCdaId: 'op1', asistenteCdaId: 'as9' } });
        // Comprueba que el operador esté libre ese día en cualquier columna.
        expect(prisma.parejaCda.findFirst.mock.calls[0][0].where.OR).toEqual([
          { operadorCdaId: { in: ['op1', 'as9'] } },
          { asistenteCdaId: { in: ['op1', 'as9'] } },
        ]);

        prisma.parejaCda.update.mockClear();
        await expect(service.editar('pA', { asistenteCdaId: null })).rejects.toThrow('La pareja de reserva no puede quedar sin nadie');
        expect(prisma.parejaCda.update).not.toHaveBeenCalled();
      });

      it('editar: el asistente que se completa no puede estar en otra pareja ese día', async () => {
        prisma.parejaCda.findUnique.mockResolvedValue(RESERVA);
        prisma.operadorCda.findUnique.mockResolvedValue({ grupo: 'ASISTENTE', activo: true });
        prisma.parejaCda.findFirst.mockResolvedValueOnce({ operadorCdaId: null, asistenteCdaId: 'as9' });

        await expect(service.editar('pR', { asistenteCdaId: 'as9' })).rejects.toThrow(`El asistente ya tiene pareja el ${DIA}`);
        expect(prisma.parejaCda.update).not.toHaveBeenCalled();
      });

      it('asignar a recinto: no se puede sin operador (el kit va a su nombre)', async () => {
        prisma.parejaCda.findUnique.mockResolvedValueOnce(SOLO_AS);
        await expect(service.asignarRecinto('pA', 'r1')).rejects.toThrow(
          'Esta reserva no tiene operador: complétela con un Operador CDA antes de asignarle un recinto',
        );
        expect(prisma.parejaCda.updateMany).not.toHaveBeenCalled();
        expect(prisma.parejaCda.update).not.toHaveBeenCalled();
      });

      it('intercambiar: sin operador no cambia recinto ni operador, y el asistente solo si no queda vacía', async () => {
        prisma.parejaCda.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === 'pA' ? SOLO_AS : where.id === 'pR' ? RESERVA : pareja()),
        );
        await expect(service.intercambiar('pA', 'p1', 'RECINTO')).rejects.toThrow('Esta reserva no tiene operador');
        await expect(service.intercambiar('pA', 'p1', 'OPERADOR')).rejects.toThrow('Esta reserva no tiene operador');
        // RESERVA no tiene asistente: VEGA se iría y pA quedaría sin nadie.
        await expect(service.intercambiar('pA', 'pR', 'ASISTENTE')).rejects.toThrow('La pareja de reserva no puede quedar sin nadie');
        expect(prisma.parejaCda.update).not.toHaveBeenCalled();

        // Desde la reserva sin operador: se libera primero el asistente de la otra (la base no deja una pareja vacía).
        await service.intercambiar('pA', 'p1', 'ASISTENTE');
        expect(prisma.parejaCda.update.mock.calls.map((c) => c[0])).toEqual([
          { where: { id: 'p1' }, data: { asistenteCdaId: null } },
          { where: { id: 'pA' }, data: { asistenteCdaId: 'as1' } },
          { where: { id: 'p1' }, data: { asistenteCdaId: 'as9' } },
        ]);
      });

      it('intercambiar asistentes entre dos reservas sin operador: 400 (quedaría una vacía por un instante)', async () => {
        const OTRA = { ...SOLO_AS, id: 'pB', asistenteCdaId: 'as8', asistente: { ...VEGA, id: 'as8', apellidosNombres: 'ZAMBRANO HAROL' } };
        prisma.parejaCda.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve(where.id === 'pA' ? SOLO_AS : OTRA));
        await expect(service.intercambiar('pA', 'pB', 'ASISTENTE')).rejects.toThrow('Las dos reservas no tienen operador');
        expect(prisma.parejaCda.update).not.toHaveBeenCalled();
      });

      it('copiar: lleva la reserva sin operador; si su asistente ya tiene pareja, la omite con su nombre', async () => {
        prisma.parejaCda.findMany.mockResolvedValueOnce([SOLO_AS]).mockResolvedValueOnce([]);
        prisma.operadorCda.findMany.mockResolvedValue([{ id: 'as9', grupo: 'ASISTENTE' }]);
        expect(await service.copiar(DIA, '2026-11-05', 'uAdmin')).toEqual({ copiadas: 1, omitidas: [] });
        expect(prisma.parejaCda.createMany.mock.calls[0][0].data[0]).toMatchObject({ operadorCdaId: null, asistenteCdaId: 'as9', recintoId: null });

        prisma.parejaCda.findMany.mockResolvedValueOnce([SOLO_AS]).mockResolvedValueOnce([{ operadorCdaId: 'op1', asistenteCdaId: 'as9' }]);
        expect(await service.copiar(DIA, '2026-11-05', 'uAdmin')).toEqual({
          copiadas: 0,
          omitidas: [{ pareja: 'VEGA SAMAEL · Reserva', motivo: 'El asistente ya tiene pareja ese día' }],
        });
      });

      it('quitarla solo la borra (no tiene kit)', async () => {
        prisma.parejaCda.findUnique.mockResolvedValueOnce(SOLO_AS);
        await service.eliminar('pA');
        expect(prisma.parejaCda.delete).toHaveBeenCalledWith({ where: { id: 'pA' } });
        expect(kits.quitarOperador).not.toHaveBeenCalled();
      });
    });

    it('quitar una pareja de reserva solo la borra', async () => {
      prisma.parejaCda.findUnique.mockResolvedValueOnce(RESERVA);
      await service.eliminar('pR');
      expect(prisma.parejaCda.delete).toHaveBeenCalledWith({ where: { id: 'pR' } });
      expect(kits.quitarOperador).not.toHaveBeenCalled();
    });
  });

  describe('reporte imprimible de la lista', () => {
    it('arma el Excel y el PDF con la lista del día (la misma que ve la pestaña)', async () => {
      prisma.parejaCda.findMany.mockResolvedValue([pareja({ kitId: 'k1', kit: { codigoUnico: 'KIT-1', eventoId: 'ev2', operadorId: 'u1' } })]);

      const xlsx = await service.reporte(DIA, 'xlsx');
      const pdf = await service.reporte(DIA, 'pdf');

      expect(prisma.parejaCda.findMany.mock.calls[0][0].where).toEqual({ fecha: FECHA, recintoId: { not: null } });
      expect(xlsx.nombre).toBe(`parejas_cda_${DIA}_${DIA}.xlsx`);
      expect(pdf.tipo).toBe('application/pdf');
      expect(pdf.contenido.subarray(0, 4).toString()).toBe('%PDF');
    });

    it('la hoja de reserva sale de las parejas de reserva del día, no de todos los activos sin pareja', async () => {
      const reserva = [
        {
          id: 'r1',
          fecha: DIA,
          operador: { id: 'o9', apellidosNombres: 'RESERVA OP', cedula: '1001', telefono: null, dispositivo: null, grupo: 'OPERADOR' as const },
          asistente: null,
        },
      ];
      jest.spyOn(service, 'listar').mockResolvedValue({ fecha: DIA, evento: null, congelado: false, parejas: [{ id: 'x' }] as never, reserva, recintosSinPareja: [] });
      const libres = jest.spyOn(service, 'disponibles');
      const generar = jest.spyOn(reporteParejasModulo, 'reporteParejas').mockReturnValue({
        titulo: 't', detalle: 'd', archivo: 'parejas_cda', desde: DIA, hasta: DIA, modo: 'GENERAL', tablas: [],
      });

      try {
        await service.reporte(DIA, 'xlsx');

        expect(libres).not.toHaveBeenCalled();
        expect(generar.mock.calls[0][0].reserva).toEqual(reserva);
      } finally {
        generar.mockRestore();
      }
    });

    it('día sin parejas: 400', async () => {
      jest.spyOn(service, 'listar').mockResolvedValue({ fecha: DIA, evento: null, congelado: false, parejas: [], reserva: [], recintosSinPareja: [] });
      await expect(service.reporte(DIA, 'pdf')).rejects.toThrow(BadRequestException);
    });
  });
});
