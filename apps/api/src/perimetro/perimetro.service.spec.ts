import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { crearPlanPerimetroSchema, guardarPlanPerimetroSchema } from '@cne/shared-validation';
import {
  MENSAJE_EVENTO_CERRADO,
  MENSAJE_PERSONAS_INVALIDAS,
  MENSAJE_PLAN_CAMBIADO,
  PerimetroService,
} from './perimetro.service';
import { MENSAJE_EVENTO_REABIERTO } from '../common/evento-no-reabierto.guard';
import type { PrismaService } from '../db/prisma.service';
import type { StorageService } from '../storage/storage.service';

const EVENTO = '11111111-1111-4111-8111-111111111111';
const PLAN = '33333333-3333-4333-8333-333333333333';
const P1 = '22222222-2222-4222-8222-222222222222';
const P2 = '44444444-4444-4444-8444-444444444444';
const LEIDO = '2026-11-18T10:00:00.000Z';
const ANILLO: [number, number][] = [
  [0.35, -78.11],
  [0.351, -78.11],
  [0.351, -78.111],
];

const filaPlan = (extra: Record<string, unknown> = {}) => ({
  id: PLAN,
  eventoId: EVENTO,
  nombre: 'Coliseo',
  lugar: null,
  perimetro: ANILLO,
  zonas: [],
  vallas: [],
  ajustes: { pctMujeres: 50, largoValla: 2.5, mostrarNombres: true, alinearVallas: true },
  vista: null,
  version: 4,
  actualizadoEn: new Date('2026-11-18T10:05:00.000Z'),
  puestos: [
    {
      id: 'pu1',
      orden: 1,
      lat: 0.35,
      lng: -78.11,
      etiqueta: null,
      operadorCdaId: P1,
      operador: { id: P1, apellidosNombres: 'PÉREZ JUAN', fotoKey: 'k1' },
    },
    { id: 'pu2', orden: 2, lat: 0.351, lng: -78.11, etiqueta: 'Policía 1', operadorCdaId: null, operador: null },
  ],
  ...extra,
});

describe('PerimetroService', () => {
  const prisma = {
    planPerimetro: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), delete: jest.fn() },
    puestoPerimetro: { groupBy: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    eventoElectoral: { findUnique: jest.fn() },
    operadorCda: { count: jest.fn() },
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  // La transacción ve las mismas lecturas (evento, personas, plan) que el cliente normal.
  const tx = {
    planPerimetro: {
      findUnique: prisma.planPerimetro.findUnique,
      create: prisma.planPerimetro.create,
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    puestoPerimetro: { deleteMany: jest.fn(), createMany: jest.fn() },
    eventoElectoral: prisma.eventoElectoral,
    operadorCda: prisma.operadorCda,
  };
  const storage = { readDecrypted: jest.fn() };
  let service: PerimetroService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.eventoElectoral.findUnique.mockResolvedValue({ estado: 'ACTIVO', reabiertoEn: null });
    prisma.operadorCda.count.mockResolvedValue(1);
    prisma.puestoPerimetro.findMany.mockResolvedValue([]);
    prisma.planPerimetro.findUnique.mockResolvedValue(filaPlan());
    prisma.planPerimetro.create.mockResolvedValue(filaPlan());
    tx.planPerimetro.updateMany.mockResolvedValue({ count: 1 });
    tx.planPerimetro.findUniqueOrThrow.mockResolvedValue(filaPlan());
    service = new PerimetroService(prisma as unknown as PrismaService, storage as unknown as StorageService);
  });

  describe('detalle', () => {
    it('de la persona solo devuelve id, nombre y si tiene foto', async () => {
      const d = await service.detalle(PLAN);
      expect(d.puestos[0].persona).toEqual({ id: P1, nombre: 'PÉREZ JUAN', tieneFoto: true });
      expect(d.puestos[1]).toMatchObject({ persona: null, etiqueta: 'Policía 1' });
      expect(JSON.stringify(d)).not.toContain('k1');
      expect(d.actualizadoEn).toBe('2026-11-18T10:05:00.000Z');
      expect(d.version).toBe(4);
      expect(d.avisos).toEqual([]);
      // La consulta no pide cédula, cargo, sexo ni teléfono.
      const select = prisma.planPerimetro.findUnique.mock.calls[0][0].include.puestos.include.operador.select;
      expect(Object.keys(select).sort()).toEqual(['apellidosNombres', 'fotoKey', 'id']);
    });

    it('descarta el JSON dañado y lo avisa en vez de fallar', async () => {
      prisma.planPerimetro.findUnique.mockResolvedValue(filaPlan({ zonas: [{ basura: true }], perimetro: [[0, 0]] }));
      const d = await service.detalle(PLAN);
      expect(d.zonas).toEqual([]);
      expect(d.perimetro).toBeNull();
      expect(d.avisos).toEqual(['Se descartó el perímetro porque estaba dañado', 'Se descartó las zonas porque estaba dañado']);
    });

    it('avisa (sin bloquear) si una persona también está en otro plan del evento', async () => {
      prisma.puestoPerimetro.findMany.mockResolvedValue([
        { operador: { apellidosNombres: 'PÉREZ JUAN' }, plan: { nombre: 'Delegación' } },
      ]);
      const d = await service.detalle(PLAN);
      expect(d.avisos).toEqual(['PÉREZ JUAN también está en el plan «Delegación»']);
      expect(prisma.puestoPerimetro.findMany.mock.calls[0][0].where).toEqual({
        operadorCdaId: { in: [P1] },
        plan: { eventoId: EVENTO, id: { not: PLAN } },
      });
    });

    it('404 si el plan no existe', async () => {
      prisma.planPerimetro.findUnique.mockResolvedValue(null);
      await expect(service.detalle(PLAN)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listar', () => {
    it('cuenta puestos y puestos con persona por plan', async () => {
      prisma.planPerimetro.findMany.mockResolvedValue([
        { id: PLAN, eventoId: EVENTO, nombre: 'Coliseo', lugar: 'Ibarra', actualizadoEn: new Date(LEIDO) },
        { id: 'otro', eventoId: EVENTO, nombre: 'Vacío', lugar: null, actualizadoEn: new Date(LEIDO) },
      ]);
      prisma.puestoPerimetro.groupBy.mockResolvedValue([{ planId: PLAN, _count: { _all: 5, operadorCdaId: 3 } }]);
      const r = await service.listar(EVENTO);
      expect(r.map((p) => [p.nombre, p.puestos, p.puestosConPersona])).toEqual([
        ['Coliseo', 5, 3],
        ['Vacío', 0, 0],
      ]);
    });

    it('sin planes no consulta los puestos', async () => {
      prisma.planPerimetro.findMany.mockResolvedValue([]);
      expect(await service.listar(EVENTO)).toEqual([]);
      expect(prisma.puestoPerimetro.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('crear', () => {
    const input = crearPlanPerimetroSchema.parse({
      eventoId: EVENTO,
      nombre: 'Coliseo',
      puestos: [{ lat: 0.35, lng: -78.11, operadorCdaId: P1 }, { lat: 0.351, lng: -78.11, etiqueta: 'Policía 1' }],
    });

    it('crea el plan con sus puestos numerados y quién lo creó', async () => {
      await service.crear(input, 'u1');
      const data = prisma.planPerimetro.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ eventoId: EVENTO, nombre: 'Coliseo', creadoPorId: 'u1', actualizadoPorId: 'u1' });
      expect(data.puestos.create).toEqual([
        { orden: 1, lat: 0.35, lng: -78.11, operadorCdaId: P1, etiqueta: null },
        { orden: 2, lat: 0.351, lng: -78.11, operadorCdaId: null, etiqueta: 'Policía 1' },
      ]);
    });

    it('rechaza personas inactivas o que no existen', async () => {
      prisma.operadorCda.count.mockResolvedValue(0);
      await expect(service.crear(input, 'u1')).rejects.toThrow(new BadRequestException(MENSAJE_PERSONAS_INVALIDAS));
      expect(prisma.operadorCda.count.mock.calls[0][0].where).toEqual({ id: { in: [P1] }, activo: true });
      expect(prisma.planPerimetro.create).not.toHaveBeenCalled();
    });

    it('no consulta personas si ningún puesto tiene una', async () => {
      await service.crear(crearPlanPerimetroSchema.parse({ eventoId: EVENTO, nombre: 'X' }), 'u1');
      expect(prisma.operadorCda.count).not.toHaveBeenCalled();
    });

    it.each([
      ['cerrado', { estado: 'CERRADO', reabiertoEn: null }, MENSAJE_EVENTO_CERRADO],
      ['reabierto solo para consulta', { estado: 'CERRADO', reabiertoEn: new Date() }, MENSAJE_EVENTO_REABIERTO],
    ])('no deja crear en un evento %s', async (_caso, evento, mensaje) => {
      prisma.eventoElectoral.findUnique.mockResolvedValue(evento);
      await expect(service.crear(input, 'u1')).rejects.toThrow(new ForbiddenException(mensaje));
      expect(prisma.planPerimetro.create).not.toHaveBeenCalled();
    });

    it('404 si el evento no existe', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValue(null);
      await expect(service.crear(input, 'u1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('guardar', () => {
    const input = guardarPlanPerimetroSchema.parse({
      version: 4,
      nombre: 'Coliseo 2',
      puestos: [{ lat: 0.35, lng: -78.11, operadorCdaId: P2 }],
    });

    it('escribe solo si la versión sigue siendo la leída, la sube y reemplaza los puestos', async () => {
      await service.guardar(PLAN, input, 'u2');
      const upd = tx.planPerimetro.updateMany.mock.calls[0][0];
      expect(upd.where).toEqual({ id: PLAN, version: 4 });
      expect(upd.data).toMatchObject({ nombre: 'Coliseo 2', actualizadoPorId: 'u2', version: { increment: 1 } });
      expect(tx.puestoPerimetro.deleteMany).toHaveBeenCalledWith({ where: { planId: PLAN } });
      expect(tx.puestoPerimetro.createMany).toHaveBeenCalledWith({
        data: [{ orden: 1, lat: 0.35, lng: -78.11, operadorCdaId: P2, etiqueta: null, planId: PLAN }],
      });
    });

    it('409 si otra persona guardó antes, sin tocar los puestos', async () => {
      tx.planPerimetro.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.guardar(PLAN, input, 'u2')).rejects.toThrow(new ConflictException(MENSAJE_PLAN_CAMBIADO));
      expect(tx.puestoPerimetro.deleteMany).not.toHaveBeenCalled();
    });

    it('un plan sin puestos no llama a createMany', async () => {
      await service.guardar(PLAN, guardarPlanPerimetroSchema.parse({ version: 4, nombre: 'X' }), 'u2');
      expect(tx.puestoPerimetro.createMany).not.toHaveBeenCalled();
    });

    it.each([
      ['cerrado', { estado: 'CERRADO', reabiertoEn: null }, MENSAJE_EVENTO_CERRADO],
      ['reabierto solo para consulta', { estado: 'CERRADO', reabiertoEn: new Date() }, MENSAJE_EVENTO_REABIERTO],
    ])('no deja guardar si el evento está %s', async (_caso, evento, mensaje) => {
      prisma.eventoElectoral.findUnique.mockResolvedValue(evento);
      await expect(service.guardar(PLAN, input, 'u2')).rejects.toThrow(new ForbiddenException(mensaje));
      expect(tx.planPerimetro.updateMany).not.toHaveBeenCalled();
    });

    it('rechaza personas inactivas sin escribir nada', async () => {
      prisma.operadorCda.count.mockResolvedValue(0);
      await expect(service.guardar(PLAN, input, 'u2')).rejects.toThrow(new BadRequestException(MENSAJE_PERSONAS_INVALIDAS));
      expect(prisma.operadorCda.count.mock.calls[0][0].where).toEqual({ id: { in: [P2] }, activo: true });
      expect(tx.planPerimetro.updateMany).not.toHaveBeenCalled();
    });

    it('404 si el plan no existe', async () => {
      prisma.planPerimetro.findUnique.mockResolvedValue(null);
      await expect(service.guardar(PLAN, input, 'u2')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('eliminar', () => {
    it('borra el plan de un evento editable', async () => {
      expect(await service.eliminar(PLAN)).toEqual({ id: PLAN });
      expect(prisma.planPerimetro.delete).toHaveBeenCalledWith({ where: { id: PLAN } });
    });

    it('no borra planes de un evento cerrado', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValue({ estado: 'CERRADO', reabiertoEn: null });
      await expect(service.eliminar(PLAN)).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.planPerimetro.delete).not.toHaveBeenCalled();
    });
  });

  describe('foto', () => {
    it('solo entrega la foto de alguien que está en ese plan', async () => {
      prisma.puestoPerimetro.findFirst.mockResolvedValue({ operador: { fotoKey: 'k1' } });
      storage.readDecrypted.mockResolvedValue(Buffer.from('jpg'));
      expect(await service.foto(PLAN, P1)).toEqual(Buffer.from('jpg'));
      expect(prisma.puestoPerimetro.findFirst.mock.calls[0][0].where).toEqual({ planId: PLAN, operadorCdaId: P1 });
    });

    it('404 si la persona no está en el plan o no tiene foto', async () => {
      prisma.puestoPerimetro.findFirst.mockResolvedValue(null);
      await expect(service.foto(PLAN, P2)).rejects.toBeInstanceOf(NotFoundException);
      prisma.puestoPerimetro.findFirst.mockResolvedValue({ operador: { fotoKey: null } });
      await expect(service.foto(PLAN, P1)).rejects.toBeInstanceOf(NotFoundException);
      expect(storage.readDecrypted).not.toHaveBeenCalled();
    });
  });
});
