import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MODULO_WEB_IDS, PERMISO_IDS } from '@cne/shared-validation';

import { MATRIZ_TTL_MS, PermisosModulosService } from './permisos-modulos.service';
import { PrismaService } from '../db/prisma.service';

describe('PermisosModulosService', () => {
  let service: PermisosModulosService;

  const prisma = {
    rolModulo: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    rolPermiso: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    rol: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };

  const fila = (rol: string, modulo: string) => ({ modulo, rol: { nombre: rol } });
  const accion = (rol: string, permiso: string) => ({ permiso, rol: { nombre: rol } });

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.rolModulo.deleteMany.mockReturnValue('delete-op');
    prisma.rolModulo.createMany.mockReturnValue('create-op');
    prisma.rolPermiso.deleteMany.mockReturnValue('delete-permisos-op');
    prisma.rolPermiso.createMany.mockReturnValue('create-permisos-op');
    prisma.rolPermiso.findMany.mockResolvedValue([]);
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
        { rol: 'TECNICO_SUPERVISOR', modulos: ['kits', 'alertas'], permisos: [] },
        { rol: 'LECTOR', modulos: ['reportes'], permisos: [] },
        { rol: 'ASISTENTE_TRANSVERSAL', modulos: [], permisos: [] },
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
      const { modulos, permisos } = await service.misModulos(['ADMINISTRADOR']);
      expect(modulos).toEqual([...MODULO_WEB_IDS]);
      expect(permisos).toEqual([...PERMISO_IDS]);
      expect(prisma.rolModulo.findMany).not.toHaveBeenCalled();
    });

    it('el operador CDA no ve ningún módulo de la web', async () => {
      expect(await service.misModulos(['OPERADOR_CDA'])).toEqual({ modulos: [], permisos: [] });
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

  describe('acciones por rol', () => {
    it('la matriz trae las acciones de cada rol, sin las que superan su techo', async () => {
      prisma.rolModulo.findMany.mockResolvedValueOnce([]);
      prisma.rolPermiso.findMany.mockResolvedValueOnce([
        accion('ASISTENTE_TRANSVERSAL', 'cda.carnets.emitir'),
        accion('ASISTENTE_TRANSVERSAL', 'cda.asistencia.marcar'),
        accion('LECTOR', 'cda.asistencia.marcar'),
        accion('ASISTENTE_TRANSVERSAL', 'accion-vieja'),
      ]);
      const { roles } = await service.matriz();
      expect(roles.find((r) => r.rol === 'ASISTENTE_TRANSVERSAL')?.permisos).toEqual([
        'cda.asistencia.marcar',
        'cda.carnets.emitir',
      ]);
      expect(roles.find((r) => r.rol === 'LECTOR')?.permisos).toEqual([]);
    });

    it('una acción solo cuenta si el mismo rol ve su módulo', async () => {
      prisma.rolModulo.findMany.mockResolvedValueOnce([fila('TECNICO_SUPERVISOR', 'operadores-cda')]);
      prisma.rolPermiso.findMany.mockResolvedValueOnce([
        accion('TECNICO_SUPERVISOR', 'cda.asistencia.qr'),
        // El asistente tiene la acción pero el admin le quitó el módulo CDAs.
        accion('ASISTENTE_TRANSVERSAL', 'cda.carnets.emitir'),
      ]);
      const { permisos } = await service.misModulos(['TECNICO_SUPERVISOR', 'ASISTENTE_TRANSVERSAL']);
      expect(permisos).toEqual(['cda.asistencia.qr']);
    });

    it('con acciones en el cuerpo, las reemplaza en la misma transacción', async () => {
      prisma.rol.findUnique.mockResolvedValueOnce({ id: 'rol-aet' });
      const r = await service.actualizar('ASISTENTE_TRANSVERSAL', ['operadores-cda'], ['cda.asistencia.qr']);
      expect(prisma.rolPermiso.deleteMany).toHaveBeenCalledWith({ where: { rolId: 'rol-aet' } });
      expect(prisma.rolPermiso.createMany).toHaveBeenCalledWith({ data: [{ rolId: 'rol-aet', permiso: 'cda.asistencia.qr' }] });
      expect(prisma.$transaction).toHaveBeenCalledWith(['delete-op', 'create-op', 'delete-permisos-op', 'create-permisos-op']);
      expect(r.permisos).toEqual(['cda.asistencia.qr']);
    });

    it('sin acciones en el cuerpo (web vieja) no las toca y devuelve las guardadas', async () => {
      prisma.rol.findUnique.mockResolvedValueOnce({ id: 'rol-aet' });
      prisma.rolPermiso.findMany.mockResolvedValueOnce([{ permiso: 'cda.asistencia.marcar' }]);
      const r = await service.actualizar('ASISTENTE_TRANSVERSAL', ['operadores-cda']);
      expect(prisma.rolPermiso.deleteMany).not.toHaveBeenCalled();
      expect(r.permisos).toEqual(['cda.asistencia.marcar']);
    });

    it('rechaza acciones fuera del techo del rol', async () => {
      await expect(service.actualizar('LECTOR', [], ['cda.asistencia.marcar'])).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
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
      expect(prisma.rolPermiso.deleteMany).not.toHaveBeenCalled();
      expect(r).toEqual({ rol: 'TECNICO_SUPERVISOR', modulos: ['kits', 'alertas'], permisos: [] });
    });

    it('permite dejar un rol sin módulos', async () => {
      prisma.rol.findUnique.mockResolvedValueOnce({ id: 'rol-lec' });
      await expect(service.actualizar('LECTOR', [])).resolves.toEqual({ rol: 'LECTOR', modulos: [], permisos: [] });
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
  describe('caché de la matriz', () => {
    afterEach(() => jest.useRealTimers());

    it('los guards no consultan la base en cada request', async () => {
      prisma.rolModulo.findMany.mockResolvedValue([]);
      await service.misModulos(['ASISTENTE_TRANSVERSAL']);
      await service.misModulos(['ASISTENTE_TRANSVERSAL']);
      await service.matriz();
      expect(prisma.rolModulo.findMany).toHaveBeenCalledTimes(1);
    });

    it('vence a los 10 s', async () => {
      jest.useFakeTimers();
      prisma.rolModulo.findMany.mockResolvedValue([]);
      await service.matriz();
      jest.advanceTimersByTime(MATRIZ_TTL_MS + 1);
      await service.matriz();
      expect(prisma.rolModulo.findMany).toHaveBeenCalledTimes(2);
    });

    it('al guardar un cambio se descarta en el acto: quitar una acción rige de inmediato', async () => {
      prisma.rolModulo.findMany.mockResolvedValue([fila('ASISTENTE_TRANSVERSAL', 'operadores-cda')]);
      prisma.rolPermiso.findMany.mockResolvedValueOnce([accion('ASISTENTE_TRANSVERSAL', 'cda.asistencia.marcar')]);
      expect((await service.misModulos(['ASISTENTE_TRANSVERSAL'])).permisos).toEqual(['cda.asistencia.marcar']);

      prisma.rol.findUnique.mockResolvedValueOnce({ id: 'rol-aet' });
      await service.actualizar('ASISTENTE_TRANSVERSAL', ['operadores-cda'], []);
      prisma.rolPermiso.findMany.mockResolvedValueOnce([]);
      expect((await service.misModulos(['ASISTENTE_TRANSVERSAL'])).permisos).toEqual([]);
    });

    it('dos requests a la vez comparten una sola consulta', async () => {
      let soltar!: (v: unknown[]) => void;
      prisma.rolModulo.findMany.mockReturnValueOnce(new Promise((r) => (soltar = r)));
      const ambos = Promise.all([service.matriz(), service.misModulos(['LECTOR'])]);
      soltar([]);
      await ambos;
      expect(prisma.rolModulo.findMany).toHaveBeenCalledTimes(1);
    });

    it('una lectura que empieza durante el guardado no deja la matriz vieja en caché', async () => {
      prisma.rolModulo.findMany.mockResolvedValue([]);
      prisma.rol.findUnique.mockResolvedValueOnce({ id: 'rol-aet' });
      let commit!: () => void;
      prisma.$transaction.mockReturnValueOnce(new Promise<void>((r) => (commit = r)));
      const guardando = service.actualizar('ASISTENTE_TRANSVERSAL', ['operadores-cda'], []);
      await new Promise((r) => setImmediate(r));
      await service.matriz(); // lee (y cachea) antes del commit
      commit();
      await guardando;
      await service.matriz();
      expect(prisma.rolModulo.findMany).toHaveBeenCalledTimes(2);
    });

    it('un error de la base no queda guardado', async () => {
      prisma.rolModulo.findMany.mockRejectedValueOnce(new Error('caída')).mockResolvedValueOnce([]);
      await expect(service.matriz()).rejects.toThrow('caída');
      await expect(service.matriz()).resolves.toBeDefined();
    });
  });
});
