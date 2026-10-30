import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';

import { ParejasCdaService } from './parejas-cda.service';
import { PrismaService } from '../db/prisma.service';
import { CuentasCdaService } from './cuentas-cda.service';
import { KitsService } from '../kits/kits.service';

const DIA = '2026-10-30';
const FECHA = new Date(`${DIA}T00:00:00Z`);
const EVENTO = { id: 'ev2', nombre: 'Prueba Técnica 2' };
const RECINTO = { id: 'r1', codigoRecinto: '957', nombre: 'UE ATAHUALPA' };
const OPERADOR = { id: 'op1', apellidosNombres: 'PÉREZ ANA', cedula: '1710034065', telefono: null, usuarioId: 'u1' };
const ASISTENTE = { id: 'as1', apellidosNombres: 'RUIZ JUAN', cedula: '1713175071', telefono: null, usuarioId: 'u2' };

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

  describe('listar', () => {
    it('busca el evento ACTIVO cuya jornada es ese día', async () => {
      await service.listar(DIA);
      expect(prisma.eventoElectoral.findFirst.mock.calls[0][0].where).toEqual({ estado: 'ACTIVO', fechaJornada: FECHA });
      expect(prisma.parejaCda.findMany.mock.calls[0][0].where).toEqual({ fecha: FECHA });
    });

    it('estados: en la app, sin kit y la segunda del mismo recinto solo registrada', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ kitId: 'k1', kit: { codigoUnico: 'KIT-1', eventoId: 'ev2', operadorId: 'u1' } }),
        pareja({ id: 'p2', operadorCdaId: 'op2', operador: { ...OPERADOR, id: 'op2', usuarioId: 'u3' }, asistente: null, creadoEn: new Date('2026-10-29T11:00:00Z') }),
        pareja({ id: 'p3', recintoId: 'r2', recinto: { id: 'r2', codigoRecinto: '1126', nombre: 'UE B' }, operador: { ...OPERADOR, id: 'op3' } }),
      ]);

      const r = await service.listar(DIA);

      expect(r.evento).toEqual(EVENTO);
      expect(r.congelado).toBe(false);
      expect(r.parejas.map((p) => [p.id, p.estado, p.recintoCompartido])).toEqual([
        ['p1', 'EN_APP', true],
        ['p2', 'SOLO_REGISTRADA', true],
        ['p3', 'SIN_KIT', false],
      ]);
      expect(r.parejas[0]).toMatchObject({ fecha: DIA, kitCodigo: 'KIT-1', recinto: { codigo: '957', nombre: 'UE ATAHUALPA' } });
      expect(r.parejas[1].asistente).toBeNull();
    });

    it('recinto con dos dispositivos: cada pareja con su propio kit está en la app', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ kitId: 'k1', kit: { codigoUnico: 'KIT-1', eventoId: 'ev2', operadorId: 'u1' } }),
        pareja({
          id: 'p2',
          operadorCdaId: 'op2',
          operador: { ...OPERADOR, id: 'op2', usuarioId: 'u3' },
          kitId: 'k2',
          kit: { codigoUnico: 'KIT-2', eventoId: 'ev2', operadorId: 'u3' },
          creadoEn: new Date('2026-10-29T11:00:00Z'),
        }),
        pareja({ id: 'p3', operadorCdaId: 'op3', operador: { ...OPERADOR, id: 'op3' }, creadoEn: new Date('2026-10-29T12:00:00Z') }),
      ]);

      const r = await service.listar(DIA);

      expect(r.parejas.map((p) => [p.id, p.estado, p.recintoCompartido])).toEqual([
        ['p1', 'EN_APP', true],
        ['p2', 'EN_APP', true],
        ['p3', 'SOLO_REGISTRADA', true],
      ]);
    });

    it('dos kits en el recinto y ninguna pareja de sobra: no se avisa "recinto compartido"', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ kitId: 'k1', kit: { codigoUnico: 'KIT-1', eventoId: 'ev2', operadorId: 'u1' } }),
        pareja({ id: 'p2', operadorCdaId: 'op2', operador: { ...OPERADOR, id: 'op2', usuarioId: 'u3' }, kitId: 'k2', kit: { codigoUnico: 'KIT-2', eventoId: 'ev2', operadorId: 'u3' } }),
      ]);

      const r = await service.listar(DIA);

      expect(r.parejas.map((p) => p.recintoCompartido)).toEqual([false, false]);
    });

    it('la pareja con kit propio va a la app aunque otra sin kit se haya registrado antes en el recinto', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ id: 'pA', creadoEn: new Date('2026-10-29T09:00:00Z') }),
        pareja({ id: 'pB', operadorCdaId: 'op2', operador: { ...OPERADOR, id: 'op2', usuarioId: 'u3' }, kitId: 'k2', kit: { codigoUnico: 'KIT-2', eventoId: 'ev2', operadorId: 'u3' } }),
      ]);

      const r = await service.listar(DIA);

      expect(r.parejas.map((p) => [p.id, p.estado])).toEqual([
        ['pA', 'SOLO_REGISTRADA'],
        ['pB', 'EN_APP'],
      ]);
    });

    it('sin evento activo de esa fecha: la lista queda pendiente', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(null);
      prisma.parejaCda.findMany.mockResolvedValueOnce([pareja()]);
      const r = await service.listar(DIA);
      expect(r.evento).toBeNull();
      expect(r.parejas[0].estado).toBe('PENDIENTE_EVENTO');
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
              : where.id === 'dig1'
                ? { id: 'dig1', grupo: 'DIGITADOR', activo: true }
                : null,
        ),
      );
      prisma.recinto.findUnique.mockResolvedValue({ ...RECINTO, activo: true, tipo: 'CDA' });
      prisma.parejaCda.create.mockResolvedValue({ id: 'p1' });
    });

    it('el operador debe ser de Operadores CDA y el asistente de Asistentes CDA', async () => {
      await expect(service.crear({ fecha: DIA, operadorCdaId: 'as1', recintoId: 'r1' }, 'admin')).rejects.toThrow(BadRequestException);
      await expect(
        service.crear({ fecha: DIA, operadorCdaId: 'op1', asistenteCdaId: 'dig1', recintoId: 'r1' }, 'admin'),
      ).rejects.toThrow('no es de Asistentes CDA');
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
        nombre: 'Kit Recinto 957',
        recintoId: 'r1',
        detalleItems: [
          { itemId: 'iLap', serie: '123' },
          { itemId: 'iMod', serie: null },
        ],
      });
      expect(kits.asignar).toHaveBeenCalledWith('kNuevo', { operadorId: 'u1' });
      expect(prisma.parejaCda.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { kitId: 'kNuevo' } });
      expect(r).toEqual({ enApp: 1, kitsCreados: 1, sinKit: 0, soloRegistradas: 0, errores: [] });
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
    it('sin evento ACTIVO de esa fecha responde 400', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(null);
      await expect(service.aplicar(DIA)).rejects.toThrow(BadRequestException);
    });

    it('asigna el kit existente al operador (creándole la cuenta), crea el que falta, cuenta la segunda pareja y reporta errores sin cortar', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ operador: { ...OPERADOR, usuarioId: null } }),
        pareja({ id: 'p2', operadorCdaId: 'op2', operador: { ...OPERADOR, id: 'op2', apellidosNombres: 'SEGUNDO' }, creadoEn: new Date('2026-10-29T12:00:00Z') }),
        pareja({ id: 'p3', recintoId: 'r2', recinto: { id: 'r2', codigoRecinto: '1126', nombre: 'UE B' }, operador: { ...OPERADOR, id: 'op3', usuarioId: 'u3', apellidosNombres: 'TERCERO' } }),
        pareja({ id: 'p4', recintoId: 'r3', recinto: { id: 'r3', codigoRecinto: '1225', nombre: 'UE C' }, operador: { ...OPERADOR, id: 'op4', usuarioId: 'u4', apellidosNombres: 'CUARTO' } }),
      ]);
      prisma.operadorCda.findUnique.mockResolvedValueOnce({ usuarioId: 'uNuevo' });
      prisma.kitElectoral.findFirst
        .mockResolvedValueOnce({ id: 'k1', operadorId: 'uViejo' })
        .mockResolvedValueOnce({ id: 'k3', operadorId: null })
        .mockResolvedValueOnce(null);
      kits.asignar.mockResolvedValueOnce({}).mockRejectedValueOnce(new ConflictException('Este operador ya tiene kits asignados a otro recinto en este evento'));

      const r = await service.aplicar(DIA);

      expect(cuentas.asegurarCuenta).toHaveBeenCalledWith(prisma, 'op1', 'hash');
      expect(prisma.kitElectoral.findFirst.mock.calls[0][0].where).toEqual({ eventoId: 'ev2', recintoId: 'r1', esPrueba: false, parejasCda: { none: {} } });
      expect(kits.asignar).toHaveBeenNthCalledWith(1, 'k1', { operadorId: 'uNuevo' });
      // Recinto sin kit y pareja sin artículos: el kit se crea con los artículos por defecto del catálogo.
      expect(kits.create).toHaveBeenCalledWith({ eventoId: 'ev2', nombre: 'Kit Recinto 1225', recintoId: 'r3' });
      expect(kits.asignar).toHaveBeenNthCalledWith(3, 'kNuevo', { operadorId: 'u4' });
      expect(r).toEqual({
        enApp: 2,
        kitsCreados: 1,
        sinKit: 0,
        soloRegistradas: 1,
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

      expect(cuentas.asegurarCuenta).toHaveBeenCalledWith(prisma, 'op1', 'hash');
      expect(kits.create).toHaveBeenCalledWith(expect.objectContaining({ detalleItems }));
      expect(kits.asignar).toHaveBeenCalledWith('kNuevo', { operadorId: 'uNuevo' });
      expect(prisma.parejaCda.create.mock.calls[0][0].data.asistenteCdaId).toBeNull();
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
      expect(prisma.parejaCda.create).toHaveBeenCalledTimes(1);
      expect(prisma.parejaCda.create.mock.calls[0][0].data).toMatchObject({ operadorCdaId: 'op1', asistenteCdaId: 'asNuevo', recintoId: 'r1' });
      expect(r).toMatchObject({ guardado: true, guardadas: 1 });
      expect(r.app).not.toBeNull();
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
      expect(r.filas[0].operador.cedula).toBe('0401234562');
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
      expect(prisma.parejaCda.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { fecha: FECHA } }));
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

    it('asistente: intercambia solo los asistentes y no toca los kits', async () => {
      const r = await service.intercambiar('p1', 'p2', 'ASISTENTE');

      expect(prisma.parejaCda.update.mock.calls.map((c) => c[0])).toEqual([
        { where: { id: 'p1' }, data: { asistenteCdaId: null } },
        { where: { id: 'p2' }, data: { asistenteCdaId: 'as1' } },
        { where: { id: 'p1' }, data: { asistenteCdaId: 'as2' } },
      ]);
      expect(kits.quitarOperador).not.toHaveBeenCalled();
      expect(kits.asignar).not.toHaveBeenCalled();
      expect(r).toEqual({ enApp: 0, kitsCreados: 0, sinKit: 0, soloRegistradas: 0, errores: [] });
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
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: 'k2', operadorId: null, estado: 'ASIGNADO' });

      await service.intercambiar('p1', 'p2', 'RECINTO');

      expect(kits.asignar).toHaveBeenCalledTimes(1);
      expect(kits.asignar).toHaveBeenCalledWith('k2', { operadorId: 'u1' });
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

    it('la segunda pareja del recinto (el kit lo lleva la otra): 409 que lo explica, sin tocar kits', async () => {
      prisma.parejaCda.findMany.mockResolvedValueOnce([
        pareja({ id: 'p0', kitId: 'k1', operador: { ...OPERADOR, id: 'op0', usuarioId: 'u0' } }),
        pareja(),
      ]);
      await expect(service.asignarKit('p1')).rejects.toThrow('comparte el recinto con otra que lleva el kit');
      expect(kits.asignar).not.toHaveBeenCalled();
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
      prisma.operadorCda.findMany.mockResolvedValue([{ id: 'op1' }, { id: 'as1' }, { id: 'op2' }]);
      prisma.recinto.findMany.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);
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
      prisma.operadorCda.findMany.mockResolvedValueOnce([{ id: 'op1' }, { id: 'as1' }, { id: 'op2' }, { id: 'op3' }, { id: 'as3' }]);

      const r = await service.copiar(DIA, HACIA, 'uAdmin');

      expect(prisma.parejaCda.createMany.mock.calls[0][0].data).toHaveLength(1);
      expect(r).toEqual({
        copiadas: 1,
        omitidas: [
          { pareja: 'MORA LUIS · 1126', motivo: 'El operador ya tiene pareja ese día' },
          { pareja: 'VEGA RITA · 957', motivo: 'El asistente ya tiene pareja ese día' },
          { pareja: 'OCULTO · 957', motivo: 'El operador está oculto' },
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
});
