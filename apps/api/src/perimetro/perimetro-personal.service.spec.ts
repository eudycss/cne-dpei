import { NotFoundException } from '@nestjs/common';
import { propuestaPersonalPerimetroSchema } from '@cne/shared-validation';
import { PerimetroPersonalService } from './perimetro-personal.service';
import type { PrismaService } from '../db/prisma.service';

const PLAN = '33333333-3333-4333-8333-333333333333';
const EVENTO = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';

describe('PerimetroPersonalService', () => {
  const prisma = {
    planPerimetro: { findUnique: jest.fn() },
    operadorCda: { findMany: jest.fn() },
    cargoCda: { findMany: jest.fn() },
    $queryRaw: jest.fn(),
  };
  let service: PerimetroPersonalService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.planPerimetro.findUnique.mockResolvedValue({ eventoId: EVENTO });
    service = new PerimetroPersonalService(prisma as unknown as PrismaService);
  });

  describe('candidatos', () => {
    it('solo personal activo que no está en este plan; devuelve id, nombre y si está en otro plan del evento', async () => {
      prisma.operadorCda.findMany.mockResolvedValue([
        { id: A, apellidosNombres: 'PÉREZ JUAN', puestosPerimetro: [{ id: 'x' }] },
        { id: 'b', apellidosNombres: 'RUIZ ANA', puestosPerimetro: [] },
      ]);
      const r = await service.candidatos(PLAN, { centro: 'CPE', cargo: 'DIGITADOR' });
      expect(r).toEqual([
        { id: A, nombre: 'PÉREZ JUAN', enOtroPlan: true },
        { id: 'b', nombre: 'RUIZ ANA', enOtroPlan: false },
      ]);
      const arg = prisma.operadorCda.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({
        activo: true,
        grupo: 'DIGITADOR',
        cargoCda: { centro: 'CPE' },
        puestosPerimetro: { none: { planId: PLAN } },
      });
      // Uno de más para que la web sepa si hay más de 100.
      expect(arg.take).toBe(101);
      // No se piden datos personales de más (nada de cédula, cargo, sexo ni teléfono).
      expect(Object.keys(arg.select).sort()).toEqual(['apellidosNombres', 'id', 'puestosPerimetro']);
      expect(arg.select.puestosPerimetro.where).toEqual({ plan: { eventoId: EVENTO } });
      // Sin texto no busca por SQL.
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('con texto filtra por los ids que coinciden (sin tildes, en SQL)', async () => {
      prisma.$queryRaw.mockResolvedValue([{ id: A }]);
      prisma.operadorCda.findMany.mockResolvedValue([]);
      await service.candidatos(PLAN, { buscar: 'perez' });
      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(prisma.operadorCda.findMany.mock.calls[0][0].where.id).toEqual({ in: [A] });
    });

    it('404 si el plan no existe', async () => {
      prisma.planPerimetro.findUnique.mockResolvedValue(null);
      await expect(service.candidatos(PLAN, {})).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('propuesta', () => {
    it('reparte por % de mujeres, prefiere a quien no está en otro plan y no devuelve el sexo', async () => {
      prisma.operadorCda.findMany.mockResolvedValue([
        { id: 'm-otro', apellidosNombres: 'A', sexo: 'M', puestosPerimetro: [{ id: 'x' }] },
        { id: 'm1', apellidosNombres: 'B', sexo: 'M', puestosPerimetro: [] },
        { id: 'f1', apellidosNombres: 'C', sexo: 'F', puestosPerimetro: [] },
      ]);
      const body = propuestaPersonalPerimetroSchema.parse({ total: 2, pctMujeres: 50, excluir: [A] });
      const r = await service.propuesta(PLAN, body);
      // Un hombre y una mujer, y quien ya está en otro plan queda fuera mientras haya otros.
      expect(r.personas.map((p) => p.id).sort()).toEqual(['f1', 'm1']);
      expect(r.faltan).toBe(0);
      expect(JSON.stringify(r)).not.toContain('sexo');
      const where = prisma.operadorCda.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ activo: true, id: { notIn: [A] }, puestosPerimetro: { none: { planId: PLAN } } });
    });

    it('dice cuántos puestos faltan si no alcanza el personal', async () => {
      prisma.operadorCda.findMany.mockResolvedValue([{ id: 'm1', apellidosNombres: 'B', sexo: 'M', puestosPerimetro: [] }]);
      const r = await service.propuesta(PLAN, propuestaPersonalPerimetroSchema.parse({ total: 3, pctMujeres: 50 }));
      expect(r).toEqual({ personas: [{ id: 'm1', nombre: 'B', enOtroPlan: false }], faltan: 2 });
    });
  });

  it('cargos: activos, por centro y orden', async () => {
    prisma.cargoCda.findMany.mockResolvedValue([{ clave: 'OPERADOR', nombre: 'Operadores CDA', centro: 'CDA' }]);
    expect(await service.cargos()).toEqual([{ clave: 'OPERADOR', nombre: 'Operadores CDA', centro: 'CDA' }]);
    expect(prisma.cargoCda.findMany.mock.calls[0][0].where).toEqual({ activo: true });
  });
});
