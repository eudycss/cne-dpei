import { convocadosEntre } from './convocatoria';
import type { PrismaService } from '../db/prisma.service';

const fecha = (dia: string) => new Date(`${dia}T00:00:00Z`);

describe('convocadosEntre', () => {
  const prisma = {
    parejaCda: { findMany: jest.fn() },
    convocatoriaCda: { findMany: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.parejaCda.findMany.mockResolvedValue([
      { fecha: fecha('2026-11-05'), operadorCdaId: 'op1', asistenteCdaId: 'as1' },
      // Reserva sin asistente.
      { fecha: fecha('2026-11-05'), operadorCdaId: 'op2', asistenteCdaId: null },
    ]);
    prisma.convocatoriaCda.findMany.mockResolvedValue([
      { fecha: fecha('2026-11-05'), operadorId: 'dig1' },
      { fecha: fecha('2026-11-06'), operadorId: 'dig2' },
    ]);
  });

  it('busca Parejas y Convocatoria en el rango de días', async () => {
    await convocadosEntre(prisma as unknown as PrismaService, '2026-11-05', '2026-11-06');
    const rango = { gte: fecha('2026-11-05'), lte: fecha('2026-11-06') };
    expect(prisma.parejaCda.findMany.mock.calls[0][0].where).toEqual({ fecha: rango });
    expect(prisma.convocatoriaCda.findMany.mock.calls[0][0].where).toEqual({ fecha: rango });
  });

  it('convoca al operador, al asistente y a la reserva de Parejas, y a los marcados a mano, solo su día', async () => {
    const c = await convocadosEntre(prisma as unknown as PrismaService, '2026-11-05', '2026-11-06');
    for (const id of ['op1', 'as1', 'op2', 'dig1']) expect(c.es('2026-11-05', id)).toBe(true);
    expect(c.es('2026-11-06', 'op1')).toBe(false);
    expect(c.es('2026-11-06', 'dig2')).toBe(true);
    expect(c.es('2026-11-05', 'dig2')).toBe(false);
    expect(c.es('2026-11-07', 'op1')).toBe(false);
  });

  it('distingue a los que vienen de Parejas', async () => {
    const c = await convocadosEntre(prisma as unknown as PrismaService, '2026-11-05', '2026-11-06');
    expect(c.esPorPareja('2026-11-05', 'as1')).toBe(true);
    expect(c.esPorPareja('2026-11-05', 'dig1')).toBe(false);
  });
});
