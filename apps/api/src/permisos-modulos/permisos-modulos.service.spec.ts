import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MODULO_WEB_IDS } from '@cne/shared-validation';

import { PermisosModulosService } from './permisos-modulos.service';
import { PrismaService } from '../db/prisma.service';

describe('PermisosModulosService', () => {
  let service: PermisosModulosService;

  const prisma = {
    rolModulo: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    rol: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };

  const fila = (rol: string, modulo: string) => ({ modulo, rol: { nombre: rol } });

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.rolModulo.deleteMany.mockReturnValue('delete-op');
    prisma.rolModulo.createMany.mockReturnValue('create-op');
    prisma.$transaction.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [PermisosModulosService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(PermisosModulosService);
  });

  describe('matriz', () => {
    it('devuelve los tres roles configurables, con sus módulos en el orden del catálogo', async () => {
      prisma.rolModulo.findMany.mockResolvedValueOnce([
        fila('TECNICO_SUPERVISOR', 'alertas'),
        fila('TECNICO_SUPERVISOR', 'kits'),
        fila('LECTOR', 'reportes'),
      ]);
      const { roles } = await service.matriz();
      expect(roles).toEqual([
        { rol: 'TECNICO_SUPERVISOR', modulos: ['kits', 'alertas'] },
        { rol: 'LECTOR', modulos: ['reportes'] },
        { rol: 'ASISTENTE_TRANSVERSAL', modulos: [] },
      ]);
    });

    it('descarta filas fuera del techo del rol o con ids desconocidos', async () => {
      prisma.rolModulo.findMany.mockResolvedValueOnce([
        fila('LECTOR', 'alertas'),
        fila('LECTOR', 'modulo-viejo'),
        fila('LECTOR', 'kits'),
      ]);
      const { roles } = await service.matriz();
      expect(roles.find((r) => r.rol === 'LECTOR')?.modulos).toEqual(['kits']);
    });
  });

  describe('misModulos', () => {
    it('el administrador ve todos sin consultar la base', async () => {
      const { modulos } = await service.misModulos(['ADMINISTRADOR']);
      expect(modulos).toEqual([...MODULO_WEB_IDS]);
      expect(prisma.rolModulo.findMany).not.toHaveBeenCalled();
    });

    it('el operador CDA no ve ningún módulo de la web', async () => {
      expect(await service.misModulos(['OPERADOR_CDA'])).toEqual({ modulos: [] });
    });

    it('une los módulos de todos los roles del usuario', async () => {
      prisma.rolModulo.findMany.mockResolvedValueOnce([
        fila('LECTOR', 'reportes'),
        fila('ASISTENTE_TRANSVERSAL', 'cadena-custodia'),
        fila('TECNICO_SUPERVISOR', 'alertas'),
      ]);
      const { modulos } = await service.misModulos(['LECTOR', 'ASISTENTE_TRANSVERSAL']);
      expect(modulos).toEqual(['cadena-custodia', 'reportes']);
    });
  });

  describe('actualizar', () => {
    it('reemplaza los módulos del rol en una sola transacción', async () => {
      prisma.rol.findUnique.mockResolvedValueOnce({ id: 'rol-tec' });
      const r = await service.actualizar('TECNICO_SUPERVISOR', ['alertas', 'kits']);
      expect(prisma.rolModulo.deleteMany).toHaveBeenCalledWith({ where: { rolId: 'rol-tec' } });
      expect(prisma.rolModulo.createMany).toHaveBeenCalledWith({
        data: [
          { rolId: 'rol-tec', modulo: 'alertas' },
          { rolId: 'rol-tec', modulo: 'kits' },
        ],
      });
      expect(prisma.$transaction).toHaveBeenCalledWith(['delete-op', 'create-op']);
      expect(r).toEqual({ rol: 'TECNICO_SUPERVISOR', modulos: ['kits', 'alertas'] });
    });

    it('permite dejar un rol sin módulos', async () => {
      prisma.rol.findUnique.mockResolvedValueOnce({ id: 'rol-lec' });
      await expect(service.actualizar('LECTOR', [])).resolves.toEqual({ rol: 'LECTOR', modulos: [] });
    });

    it.each(['ADMINISTRADOR', 'OPERADOR_CDA', 'INVENTADO'])('rechaza configurar el rol %s', async (rol) => {
      await expect(service.actualizar(rol, [])).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rechaza módulos fuera del techo del API para ese rol', async () => {
      await expect(service.actualizar('LECTOR', ['kits', 'alertas'])).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('404 si el rol no existe en la base', async () => {
      prisma.rol.findUnique.mockResolvedValueOnce(null);
      await expect(service.actualizar('LECTOR', ['kits'])).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
