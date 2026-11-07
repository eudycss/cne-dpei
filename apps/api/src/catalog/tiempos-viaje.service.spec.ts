import { BadRequestException } from '@nestjs/common';
import { TiemposViajeService } from './tiempos-viaje.service';

const R1 = '11111111-1111-4111-8111-111111111111';
const R2 = '22222222-2222-4222-8222-222222222222';

describe('TiemposViajeService', () => {
  const prisma = {
    recinto: { findMany: jest.fn(), count: jest.fn(), updateMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
  };
  const service = new TiemposViajeService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.recinto.updateMany.mockResolvedValue({ count: 1 });
  });

  it('lista solo los CDA activos con su tiempo, lo medido y el sugerido (margen 30)', async () => {
    prisma.recinto.findMany.mockResolvedValue([
      { id: R1, codigoRecinto: '1126', nombre: 'UE CHALTURA', tiempoDpiMin: null, canton: { nombre: 'ANTONIO ANTE' } },
      { id: R2, codigoRecinto: '1298', nombre: 'UE OTRA', tiempoDpiMin: 90, canton: { nombre: 'ANTONIO ANTE' } },
    ]);
    prisma.$queryRaw.mockResolvedValue([{ recintoId: R1, maxMin: 41.6, viajes: 2 }]);

    const r = await service.listar();

    expect(prisma.recinto.findMany.mock.calls[0][0].where).toEqual({ tipo: 'CDA', activo: true });
    expect(r.margenMin).toBe(30);
    expect(r.recintos).toEqual([
      expect.objectContaining({ id: R1, codigo: '1126', tiempoMin: null, medidoMaxMin: 42, viajesMedidos: 2, sugeridoMin: 75, origenSugerido: 'MEDIDO' }),
      expect.objectContaining({ id: R2, tiempoMin: 90, medidoMaxMin: null, sugeridoMin: 75, origenSugerido: 'CANTON' }),
    ]);
  });

  it('la consulta de viajes excluye las llegadas manuales y los registros absurdos', async () => {
    prisma.recinto.findMany.mockResolvedValue([]);
    prisma.$queryRaw.mockResolvedValue([]);
    await service.listar();
    const [partes, ...valores] = prisma.$queryRaw.mock.calls[0];
    const sql = (partes as string[]).join('?');
    expect(sql).toContain('registrado_por_id IS NULL');
    expect(sql).toContain('PARTITION BY evento_id, operador_id ORDER BY ocurrido_en, registrado_en, id');
    expect(valores).toEqual([1, 360]);
  });

  it('guarda varios tiempos en una sola transacción (null quita el tiempo)', async () => {
    prisma.recinto.count.mockResolvedValue(2);
    const r = await service.guardar({ tiempos: [{ recintoId: R1, minutos: 60 }, { recintoId: R2, minutos: null }] });
    expect(prisma.recinto.count).toHaveBeenCalledWith({ where: { id: { in: [R1, R2] }, tipo: 'CDA', activo: true } });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.recinto.updateMany.mock.calls).toEqual([
      [{ where: { id: R1, tipo: 'CDA', activo: true }, data: { tiempoDpiMin: 60 } }],
      [{ where: { id: R2, tipo: 'CDA', activo: true }, data: { tiempoDpiMin: null } }],
    ]);
    expect(r).toEqual({ actualizados: 2 });
  });

  it('si un CDA se desactiva entre la revisión y el guardado, rechaza todo con 400', async () => {
    prisma.recinto.count.mockResolvedValue(2);
    prisma.recinto.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await expect(service.guardar({ tiempos: [{ recintoId: R1, minutos: 60 }, { recintoId: R2, minutos: 60 }] })).rejects.toThrow(
      'Un CDA cambió mientras tanto: recargue la lista',
    );
  });

  it('rechaza recintos que no son CDA activos sin guardar nada', async () => {
    prisma.recinto.count.mockResolvedValue(1);
    await expect(service.guardar({ tiempos: [{ recintoId: R1, minutos: 60 }, { recintoId: R2, minutos: 60 }] })).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
