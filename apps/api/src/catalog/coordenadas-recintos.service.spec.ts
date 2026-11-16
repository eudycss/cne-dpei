import { CoordenadasRecintosService } from './coordenadas-recintos.service';

describe('CoordenadasRecintosService', () => {
  const prisma = { $queryRaw: jest.fn() };
  const service = new CoordenadasRecintosService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('arma la comparación con las marcaciones agrupadas por recinto', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { id: 'r1', codigo: '1', nombre: 'UE UNO', canton: 'COTACACHI', lat: 0.227472, lng: -78.632139 },
        { id: 'r2', codigo: '2', nombre: 'UE DOS', canton: 'IBARRA', lat: 0.35, lng: -78.12 },
      ])
      .mockResolvedValueOnce([
        { recintoId: 'r1', lat: 0.2315, lng: -78.6284, metros: 620 },
        { recintoId: 'r1', lat: 0.2314, lng: -78.6283, metros: 630 },
        { recintoId: 'r1', lat: 0.2316, lng: -78.6285, metros: 640 },
      ]);

    const r = await service.listar();

    expect(r.umbralMetros).toBe(150);
    expect(r.minMarcas).toBe(3);
    // r2 no tiene marcaciones: no aparece.
    expect(r.recintos).toHaveLength(1);
    expect(r.recintos[0]).toMatchObject({ id: 'r1', marcas: 3, medianaMetros: 630, sospechosa: true });
  });

  it('respeta el umbral pedido', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: 'r1', codigo: '1', nombre: 'UE UNO', canton: 'X', lat: 0.2, lng: -78.6 }])
      .mockResolvedValueOnce([
        { recintoId: 'r1', lat: 0.2, lng: -78.6, metros: 200 },
        { recintoId: 'r1', lat: 0.2, lng: -78.6, metros: 200 },
        { recintoId: 'r1', lat: 0.2, lng: -78.6, metros: 200 },
      ]);
    expect((await service.listar(300)).recintos[0].sospechosa).toBe(false);
  });
});
