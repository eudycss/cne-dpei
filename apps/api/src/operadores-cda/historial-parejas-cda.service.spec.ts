import { HistorialParejasCdaService } from './historial-parejas-cda.service';
import type { PrismaService } from '../db/prisma.service';

describe('HistorialParejasCdaService.buscar', () => {
  const prisma = {
    $queryRaw: jest.fn(),
    operadorCda: { findMany: jest.fn() },
    recinto: { findMany: jest.fn() },
    parejaCda: { findMany: jest.fn() },
  };
  const service = new HistorialParejasCdaService(prisma as unknown as PrismaService);

  beforeEach(() => jest.clearAllMocks());

  it('un NO CDA buscado trae su CDA con quiénes fueron', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([]) // ninguna persona
      .mockResolvedValueOnce([{ id: 'n1' }]); // el NO CDA
    prisma.operadorCda.findMany.mockResolvedValue([]);
    prisma.recinto.findMany
      .mockResolvedValueOnce([{ id: 'n1', codigoRecinto: '2001', nombre: 'Escuelita', tipo: 'NO_CDA', cdaDestinoId: 'r1' }])
      .mockResolvedValueOnce([{ id: 'r1', codigoRecinto: '971', nombre: 'UE Chaltura' }]);
    prisma.parejaCda.findMany.mockResolvedValue([
      {
        fecha: new Date('2026-11-05T00:00:00Z'),
        recinto: { id: 'r1', codigoRecinto: '971', nombre: 'UE Chaltura' },
        operador: { id: 'p1', apellidosNombres: 'PEREZ ANA' },
        asistente: null,
        kit: null,
      },
    ]);

    const r = await service.buscar('2001');

    expect(prisma.recinto.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: { in: ['r1'] }, tipo: 'CDA' } }),
    );
    expect(r.recintos).toEqual([
      {
        id: 'r1',
        codigo: '971',
        nombre: 'UE Chaltura',
        noCdas: [{ codigo: '2001', nombre: 'Escuelita' }],
        asignaciones: [{ fecha: '2026-11-05', operador: 'PEREZ ANA', asistente: null, kit: null }],
      },
    ]);
  });

  it('una persona en reserva y más de 500 parejas: muestra 500 y avisa que hay más', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'p1' }]).mockResolvedValueOnce([]);
    prisma.operadorCda.findMany.mockResolvedValue([{ id: 'p1', apellidosNombres: 'PEREZ ANA', cedula: '1', grupo: 'OPERADOR' }]);
    prisma.recinto.findMany.mockResolvedValue([]);
    const reserva = {
      fecha: new Date('2026-11-05T00:00:00Z'),
      recinto: null,
      operador: { id: 'p1', apellidosNombres: 'PEREZ ANA' },
      asistente: null,
      kit: null,
    };
    prisma.parejaCda.findMany.mockResolvedValue(Array.from({ length: 501 }, () => reserva));

    const r = await service.buscar('perez');

    expect(prisma.parejaCda.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 501 }));
    expect(r.truncado).toBe(true);
    expect(r.personas[0].asignaciones).toHaveLength(500);
    expect(r.personas[0].asignaciones[0]).toEqual({ fecha: '2026-11-05', recinto: null, como: 'OPERADOR', pareja: null });
  });

  it('un NO CDA sin CDA asignado no trae ningún recinto', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'n9' }]);
    prisma.operadorCda.findMany.mockResolvedValue([]);
    prisma.recinto.findMany
      .mockResolvedValueOnce([{ id: 'n9', codigoRecinto: '2009', nombre: 'Suelta', tipo: 'NO_CDA', cdaDestinoId: null }])
      .mockResolvedValueOnce([]);

    await expect(service.buscar('2009')).resolves.toEqual({ personas: [], recintos: [], truncado: false });
  });

  it('sin personas ni recintos que coincidan no consulta parejas', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.operadorCda.findMany.mockResolvedValue([]);
    prisma.recinto.findMany.mockResolvedValue([]);

    await expect(service.buscar('zzzz')).resolves.toEqual({ personas: [], recintos: [], truncado: false });
    expect(prisma.parejaCda.findMany).not.toHaveBeenCalled();
  });
});
