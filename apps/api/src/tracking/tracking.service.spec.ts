import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { checklistDesdeBd, TrackingService } from './tracking.service';
import { PrismaService } from '../db/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { AlertasService } from '../alertas/alertas.service';

describe('TrackingService', () => {
  let service: TrackingService;

  const prisma = {
    eventoElectoral: { findFirst: jest.fn() },
    kitElectoral: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    recinto: { findUnique: jest.fn(), findMany: jest.fn() },
    configAlerta: { findUnique: jest.fn() },
    militar: { findFirst: jest.fn() },
    parejaCda: { findMany: jest.fn() },
    eventoTracking: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    recepcionKit: { findFirst: jest.fn(), findMany: jest.fn() },
    recepcionDpiKit: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    entregaCustodioKit: { findUnique: jest.fn() },
    usuario: { findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    asignacionSupervisor: { findFirst: jest.fn(), findMany: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn((arr: Promise<unknown>[]) => Promise.all(arr)),
  };

  const notifications = {
    encolarSalidaDpi: jest.fn(),
    encolarLlegadaRecinto: jest.fn(),
    encolarSalidaRecinto: jest.fn(),
    encolarLlegadaDpi: jest.fn(),
  };

  const storage = {
    saveEncrypted: jest.fn(),
    exists: jest.fn(),
    readDecrypted: jest.fn(),
  };

  const alertas = {
    generarKitNoCorresponde: jest.fn(),
    generarEntregaMilitarNoRegistrada: jest.fn(),
    generarLlegadaFueraDeRango: jest.fn(),
  };

  const eventoId = '22222222-2222-2222-2222-222222222222';
  const operadorId = '11111111-1111-1111-1111-111111111111';
  const recintoId = '44444444-4444-4444-4444-444444444444';
  const kitId = '33333333-3333-3333-3333-333333333333';
  const ocurridoEn = '2026-06-23T10:00:00.000Z';
  const geo = { latitud: 0.35, longitud: -78.11, ocurridoEn };

  const evento = { id: eventoId, nombre: 'Evento Test', estado: 'ACTIVO' };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((arr: Promise<unknown>[]) => Promise.all(arr));
    prisma.parejaCda.findMany.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        TrackingService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: StorageService, useValue: storage },
        { provide: AlertasService, useValue: alertas },
      ],
    }).compile();

    service = moduleRef.get(TrackingService);
  });

  /** Valores interpolados del INSERT sobre `tabla` ($queryRaw es un tagged template). */
  function valoresInsert(tabla: string): unknown[] {
    const llamada = prisma.$queryRaw.mock.calls.find(([sql]) =>
      (sql as TemplateStringsArray).join('?').includes(`INSERT INTO ${tabla}`),
    );
    if (!llamada) throw new Error(`No hubo INSERT en ${tabla}`);
    return llamada.slice(1);
  }

  describe('miAsignacion', () => {
    it('lanza NotFoundException si no hay evento activo', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(null);
      await expect(service.miAsignacion(operadorId)).rejects.toThrow(NotFoundException);
    });

    it('lanza NotFoundException si el operador no tiene kits', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);
      await expect(service.miAsignacion(operadorId)).rejects.toThrow(NotFoundException);
    });

    it('lanza NotFoundException si los kits no tienen recinto asignado', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ id: kitId, recintoId: null }]);
      await expect(service.miAsignacion(operadorId)).rejects.toThrow(NotFoundException);
    });

    it('lanza ConflictException si los kits apuntan a varios recintos', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([
        { id: kitId, recintoId },
        { id: 'k2', recintoId: '55555555-5555-5555-5555-555555555555' },
      ]);
      await expect(service.miAsignacion(operadorId)).rejects.toThrow(ConflictException);
    });

    it('incluye la coordenada y el margen de la Delegación cuando ya están configurados', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ id: kitId, recintoId, codigoUnico: 'K001' }]);
      prisma.recinto.findUnique.mockResolvedValueOnce({ id: recintoId, canton: null });
      prisma.$queryRaw
        .mockResolvedValueOnce([{ lat: -0.35, lng: -78.12 }]) // coords recinto
        .mockResolvedValueOnce([{ lat: 0.35849, lng: -78.11886 }]); // coords delegación
      prisma.configAlerta.findUnique.mockResolvedValueOnce({
        margenLlegadaMetros: 120,
        margenLlegadaDpiMetros: 200,
      });
      prisma.recinto.findMany.mockResolvedValueOnce([]); // noCdas
      prisma.militar.findFirst.mockResolvedValueOnce(null);
      prisma.$transaction.mockResolvedValueOnce([null, null, null, null, null, [], []]);

      const result = await service.miAsignacion(operadorId);

      expect(result.delegacion).toEqual({ latitud: 0.35849, longitud: -78.11886 });
      expect(result.margenLlegadaDpiMetros).toBe(200);
      expect(result.margenLlegadaMetros).toBe(120);
    });

    it('expone items con las etiquetas del catálogo vinculadas al kit', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([
        {
          id: kitId,
          recintoId,
          codigoUnico: 'K001',
          contenidos: null,
          itemsContenido: [{ item: { etiqueta: 'Computador' } }, { item: { etiqueta: 'Mouse' } }],
        },
      ]);
      prisma.recinto.findUnique.mockResolvedValueOnce({ id: recintoId, canton: null });
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      prisma.configAlerta.findUnique.mockResolvedValueOnce(null);
      prisma.recinto.findMany.mockResolvedValueOnce([]);
      prisma.militar.findFirst.mockResolvedValueOnce(null);
      prisma.$transaction.mockResolvedValueOnce([null, null, null, null, null, [], []]);

      const result = await service.miAsignacion(operadorId);

      expect(result.kits[0].items).toEqual(['Computador', 'Mouse']);
    });

    it('devuelve delegacion=null y el margen por defecto si aún no hay coordenada configurada', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ id: kitId, recintoId, codigoUnico: 'K001' }]);
      prisma.recinto.findUnique.mockResolvedValueOnce({ id: recintoId, canton: null });
      prisma.$queryRaw
        .mockResolvedValueOnce([]) // sin coords de recinto
        .mockResolvedValueOnce([]); // sin coords de delegación
      prisma.configAlerta.findUnique.mockResolvedValueOnce(null);
      prisma.recinto.findMany.mockResolvedValueOnce([]);
      prisma.militar.findFirst.mockResolvedValueOnce(null);
      prisma.$transaction.mockResolvedValueOnce([null, null, null, null, null, [], []]);

      const result = await service.miAsignacion(operadorId);

      expect(result.delegacion).toBeNull();
      expect(result.margenLlegadaDpiMetros).toBe(150);
    });

    it('trae la unidad de contingencia de su CDA (o null si no está configurada)', async () => {
      const preparar = (recinto: object) => {
        prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
        prisma.kitElectoral.findMany.mockResolvedValueOnce([{ id: kitId, recintoId, codigoUnico: 'K001' }]);
        prisma.recinto.findUnique.mockResolvedValueOnce({ id: recintoId, canton: null, ...recinto });
        prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
        prisma.configAlerta.findUnique.mockResolvedValueOnce(null);
        prisma.recinto.findMany.mockResolvedValueOnce([]);
        prisma.militar.findFirst.mockResolvedValueOnce(null);
        prisma.$transaction.mockResolvedValueOnce([null, null, null, null, null, [], []]);
      };
      preparar({ contingenciaNombre: 'UE Juan Montalvo', contingenciaDireccion: 'Gran Colombia y Mariscal Sucre' });
      expect((await service.miAsignacion(operadorId)).contingencia).toEqual({
        nombre: 'UE Juan Montalvo',
        direccion: 'Gran Colombia y Mariscal Sucre',
      });

      preparar({ contingenciaNombre: 'CPE', contingenciaDireccion: null });
      expect((await service.miAsignacion(operadorId)).contingencia).toEqual({ nombre: 'CPE', direccion: null });

      preparar({ contingenciaNombre: null, contingenciaDireccion: null });
      expect((await service.miAsignacion(operadorId)).contingencia).toBeNull();
    });

    describe('su pareja del recinto', () => {
      function mockAsignacion() {
        prisma.eventoElectoral.findFirst.mockResolvedValueOnce({ ...evento, fechaJornada: new Date('2026-11-01T00:00:00Z') });
        prisma.kitElectoral.findMany.mockResolvedValueOnce([{ id: kitId, recintoId, codigoUnico: 'K001' }]);
        prisma.recinto.findUnique.mockResolvedValueOnce({ id: recintoId, canton: null });
        prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
        prisma.configAlerta.findUnique.mockResolvedValueOnce(null);
        prisma.recinto.findMany.mockResolvedValueOnce([]);
        prisma.militar.findFirst.mockResolvedValueOnce(null);
        prisma.$transaction.mockResolvedValueOnce([null, null, null, null, null, [], []]);
      }

      const persona = (apellidosNombres: string, grupo: 'OPERADOR' | 'ASISTENTE', usuarioId: string | null, telefono: string | null = null) => ({
        apellidosNombres,
        telefono,
        grupo,
        usuarioId,
      });

      it('trae a las dos personas de su pareja (el día de la jornada, en su recinto) y marca quién es usted', async () => {
        mockAsignacion();
        prisma.parejaCda.findMany.mockResolvedValueOnce([
          { kitId, operador: persona('PÉREZ ANA', 'OPERADOR', 'otro', '0991234567'), asistente: persona('RUIZ JUAN', 'ASISTENTE', operadorId, '0987654321') },
        ]);

        const result = await service.miAsignacion(operadorId);

        const datos = { select: { apellidosNombres: true, telefono: true, grupo: true, usuarioId: true } };
        expect(prisma.parejaCda.findMany.mock.calls[0][0]).toEqual({
          where: { fecha: new Date('2026-11-01T00:00:00Z'), recintoId },
          orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }],
          // Solo nombre, teléfono y cargo de cada uno: nada de cédula ni correo.
          select: { kitId: true, operador: datos, asistente: datos },
        });
        expect(result.pareja).toEqual([
          { nombre: 'PÉREZ ANA', cargo: 'Operador CDA', telefono: '0991234567', esUsted: false },
          // Su propio teléfono no hace falta en la app.
          { nombre: 'RUIZ JUAN', cargo: 'Asistente CDA · lleva el kit', telefono: null, esUsted: true },
        ]);
      });

      it('si van varias parejas al recinto, quien ingresa ve a todas: la suya primero y las demás como 2.ª, 3.ª pareja', async () => {
        mockAsignacion();
        prisma.parejaCda.findMany.mockResolvedValueOnce([
          // Registrada antes, pero no es la de quien tiene la sesión.
          { kitId: null, operador: persona('TABI DORIAN', 'OPERADOR', null, '0963637455'), asistente: persona('BENAVIDES ROBERTO', 'ASISTENTE', 'u2', '0981611201') },
          { kitId, operador: persona('TORRES MELANI', 'OPERADOR', operadorId, '0967794853'), asistente: persona('VELA MONICA', 'ASISTENTE', 'u3', '0988166326') },
          { kitId: null, operador: persona('LOPEZ ANA', 'OPERADOR', null), asistente: null },
        ]);

        const { pareja } = await service.miAsignacion(operadorId);

        expect(pareja).toEqual([
          { nombre: 'TORRES MELANI', cargo: 'Operador CDA · lleva el kit', telefono: null, esUsted: true },
          { nombre: 'VELA MONICA', cargo: 'Asistente CDA', telefono: '0988166326', esUsted: false },
          { nombre: 'TABI DORIAN', cargo: 'Operador CDA · 2.ª pareja', telefono: '0963637455', esUsted: false },
          { nombre: 'BENAVIDES ROBERTO', cargo: 'Asistente CDA · 2.ª pareja', telefono: '0981611201', esUsted: false },
          { nombre: 'LOPEZ ANA', cargo: 'Operador CDA · 3.ª pareja', telefono: null, esUsted: false },
        ]);
      });

      it('si quien tiene el kit no está en ninguna pareja, la del kit va primero', async () => {
        mockAsignacion();
        prisma.parejaCda.findMany.mockResolvedValueOnce([
          { kitId: null, operador: persona('B OPERADOR', 'OPERADOR', null), asistente: null },
          { kitId, operador: persona('A OPERADOR', 'OPERADOR', 'otro'), asistente: persona('A ASISTENTE', 'ASISTENTE', null) },
        ]);

        const { pareja } = await service.miAsignacion(operadorId);

        expect(pareja?.map((p) => `${p.nombre} | ${p.cargo}`)).toEqual([
          'A OPERADOR | Operador CDA',
          'A ASISTENTE | Asistente CDA',
          'B OPERADOR | Operador CDA · 2.ª pareja',
        ]);
        expect(pareja?.some((p) => p.esUsted)).toBe(false);
      });

      it('su pareja va primero aunque otra tenga su kit, y la 4.ª pareja también se numera', async () => {
        mockAsignacion();
        prisma.parejaCda.findMany.mockResolvedValueOnce([
          { kitId, operador: persona('A', 'OPERADOR', null), asistente: null },
          { kitId: null, operador: persona('B', 'OPERADOR', operadorId), asistente: null },
          { kitId: 'kit-ajeno', operador: persona('C', 'OPERADOR', null), asistente: null },
          { kitId: null, operador: persona('D', 'ASISTENTE', null), asistente: null },
        ]);

        const { pareja } = await service.miAsignacion(operadorId);

        expect(pareja?.map((p) => `${p.nombre} | ${p.cargo}`)).toEqual([
          'B | Operador CDA · lleva el kit',
          'A | Operador CDA · 2.ª pareja',
          'C | Operador CDA · 3.ª pareja',
          'D | Asistente CDA · 4.ª pareja',
        ]);
      });

      it('pareja de dos operadores, sin asistente o sin pareja registrada', async () => {
        mockAsignacion();
        prisma.parejaCda.findMany.mockResolvedValueOnce([
          { kitId, operador: persona('PÉREZ ANA', 'OPERADOR', operadorId), asistente: persona('MORA LUIS', 'OPERADOR', null) },
        ]);
        expect((await service.miAsignacion(operadorId)).pareja?.map((p) => p.cargo)).toEqual(['Operador CDA · lleva el kit', 'Operador CDA']);

        mockAsignacion();
        prisma.parejaCda.findMany.mockResolvedValueOnce([{ kitId, operador: persona('PÉREZ ANA', 'OPERADOR', operadorId), asistente: null }]);
        expect((await service.miAsignacion(operadorId)).pareja).toHaveLength(1);

        mockAsignacion();
        expect((await service.miAsignacion(operadorId)).pareja).toEqual([]);
      });
    });

    it('indica si el operador ya hizo la prueba de conexión', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ id: kitId, recintoId, codigoUnico: 'K001' }]);
      prisma.recinto.findUnique.mockResolvedValueOnce({ id: recintoId, canton: null });
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      prisma.configAlerta.findUnique.mockResolvedValueOnce(null);
      prisma.recinto.findMany.mockResolvedValueOnce([]);
      prisma.militar.findFirst.mockResolvedValueOnce(null);
      // [salidaDpi, llegada, pruebaConexion, salidaRecinto, llegadaDpi, recepciones, noCda]
      prisma.$transaction.mockResolvedValueOnce([{ id: 's' }, { id: 'l' }, { id: 'p' }, null, null, [], []]);

      const result = await service.miAsignacion(operadorId);

      expect(result.yaRegistroLlegada).toBe(true);
      expect(result.yaRegistroPruebaConexion).toBe(true);
      expect(result.yaRegistroSalidaRecinto).toBe(false);
    });
  });

  describe('reporteFlujoCdas', () => {
    it('incluye la prueba de conexión, el cantón y el id del operador de cada CDA', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ recintoId, operadorId, codigoUnico: 'K001' }]);
      prisma.recinto.findMany.mockResolvedValueOnce([
        { id: recintoId, codigoRecinto: '1961', nombre: 'UE García Moreno', canton: { id: 1, nombre: 'Ibarra' } },
      ]);
      prisma.usuario.findMany.mockResolvedValueOnce([
        { id: operadorId, nombres: 'Willy', apellidos: 'Paspuel', cedula: '1002003001' },
      ]);
      prisma.eventoTracking.findMany.mockResolvedValueOnce([
        { operadorId, tipo: 'LLEGADA_RECINTO', ocurridoEn: new Date('2026-10-01T16:55:00.000Z') },
        { operadorId, tipo: 'PRUEBA_CONEXION', ocurridoEn: new Date('2026-10-01T17:00:00.000Z') },
      ]);

      const [fila] = await service.reporteFlujoCdas();

      expect(fila).toMatchObject({
        operadorId,
        cantonId: 1,
        cantonNombre: 'Ibarra',
        llegadaRecintoEn: '2026-10-01T16:55:00.000Z',
        pruebaConexionEn: '2026-10-01T17:00:00.000Z',
        salidaRecintoEn: null,
      });
      expect(prisma.eventoTracking.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tipo: { in: expect.arrayContaining(['PRUEBA_CONEXION']) },
          }),
        }),
      );
      expect(fila.llegadaDpiManual).toBe(false);
    });

    it('marca la llegada al DPEI registrada desde la web por un administrador', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ recintoId, operadorId, codigoUnico: 'K001' }]);
      prisma.recinto.findMany.mockResolvedValueOnce([
        { id: recintoId, codigoRecinto: '1961', nombre: 'UE García Moreno', canton: { id: 1, nombre: 'Ibarra' } },
      ]);
      prisma.usuario.findMany.mockResolvedValueOnce([
        { id: operadorId, nombres: 'Willy', apellidos: 'Paspuel', cedula: '1002003001' },
      ]);
      prisma.eventoTracking.findMany.mockResolvedValueOnce([
        { operadorId, tipo: 'SALIDA_RECINTO', ocurridoEn: new Date('2026-10-01T22:00:00.000Z'), registradoPorId: null },
        { operadorId, tipo: 'LLEGADA_DPI', ocurridoEn: new Date('2026-10-02T01:00:00.000Z'), registradoPorId: 'admin-1' },
      ]);

      const [fila] = await service.reporteFlujoCdas();

      expect(fila).toMatchObject({ llegadaDpiEn: '2026-10-02T01:00:00.000Z', llegadaDpiManual: true });
      expect(prisma.eventoTracking.findMany.mock.calls[0][0].select).toEqual({
        operadorId: true,
        tipo: true,
        ocurridoEn: true,
        registradoPorId: true,
      });
    });
  });

  describe('registrarPruebaConexion', () => {
    it('lanza NotFoundException si no hay evento activo', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(null);
      await expect(service.registrarPruebaConexion(operadorId, { ocurridoEn })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza BadRequestException si aún no registró la llegada al recinto', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null) // sin prueba previa
        .mockResolvedValueOnce(null); // sin llegada
      await expect(service.registrarPruebaConexion(operadorId, { ocurridoEn })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.eventoTracking.create).not.toHaveBeenCalled();
    });

    it('es idempotente: si ya existe la devuelve sin crear otra (reenvío de la cola offline)', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst.mockResolvedValueOnce({ id: 'prueba-1', ocurridoEn: new Date(ocurridoEn) });

      const result = await service.registrarPruebaConexion(operadorId, {
        ocurridoEn: '2026-06-23T11:00:00.000Z',
        desdeOffline: true,
      });

      expect(result).toEqual({ id: 'prueba-1', ocurridoEn });
      expect(prisma.eventoTracking.create).not.toHaveBeenCalled();
    });

    it('registra la prueba en el recinto de la llegada y conserva desdeOffline', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ recintoId });
      prisma.eventoTracking.create.mockResolvedValueOnce({ id: 'prueba-2', ocurridoEn: new Date(ocurridoEn) });

      const result = await service.registrarPruebaConexion(operadorId, { ocurridoEn, desdeOffline: true });

      expect(result).toEqual({ id: 'prueba-2', ocurridoEn });
      expect(prisma.eventoTracking.create).toHaveBeenCalledWith({
        data: {
          eventoId,
          operadorId,
          tipo: 'PRUEBA_CONEXION',
          recintoId,
          ocurridoEn: new Date(ocurridoEn),
          desdeOffline: true,
        },
        select: { id: true, ocurridoEn: true },
      });
    });

    it('si otra petición la insertó a la vez (índice único), devuelve la que quedó', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null) // aún no existía al consultar
        .mockResolvedValueOnce({ recintoId }) // llegada
        .mockResolvedValueOnce({ id: 'ganadora', ocurridoEn: new Date(ocurridoEn) });
      prisma.eventoTracking.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));

      await expect(service.registrarPruebaConexion(operadorId, { ocurridoEn })).resolves.toEqual({
        id: 'ganadora',
        ocurridoEn,
      });
    });

    it('rechaza una fecha que no es ISO', async () => {
      await expect(service.registrarPruebaConexion(operadorId, { ocurridoEn: 'ayer' })).rejects.toThrow();
      expect(prisma.eventoElectoral.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('registrarSalidaDpi', () => {
    it('lanza NotFoundException si no hay evento activo', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(null);
      await expect(service.registrarSalidaDpi(operadorId, geo as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza ConflictException si ya registró la salida del DPI', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst.mockResolvedValueOnce({ id: 'tk1' });
      await expect(service.registrarSalidaDpi(operadorId, geo as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('registra la salida e encola la notificación', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst.mockResolvedValueOnce(null); // sin salida previa
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ recintoId });
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'new-tracking-id' }]);
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Ana', apellidos: 'López' });
      prisma.recinto.findUnique.mockResolvedValueOnce({ nombre: 'CDA 1' });

      const result = await service.registrarSalidaDpi(operadorId, geo as any);

      expect(result.id).toBe('new-tracking-id');
      expect(notifications.encolarSalidaDpi).toHaveBeenCalledTimes(1);
    });
  });

  describe('validarKit', () => {
    it('lanza NotFoundException si el kit no existe en el evento activo', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.validarKit(operadorId, 'ABCD2345')).rejects.toThrow(NotFoundException);
    });

    it('lanza BadRequestException si el kit no le pertenece al operador', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({ id: kitId, operadorId: 'otro' });
      await expect(service.validarKit(operadorId, 'ABCD2345')).rejects.toThrow(BadRequestException);
    });

    it('devuelve el kit con yaRecibido=true si ya hay recepción', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({
        id: kitId,
        operadorId,
        codigoUnico: 'ABCD2345',
        nombre: 'Kit 1',
        contenidos: null,
      });
      prisma.recepcionKit.findFirst.mockResolvedValueOnce({ id: 'rk1' });

      const result = await service.validarKit(operadorId, 'ABCD2345');

      expect(result.yaRecibido).toBe(true);
      expect(result.id).toBe(kitId);
    });

    it('expone items con las etiquetas del catálogo vinculadas al kit', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({
        id: kitId,
        operadorId,
        codigoUnico: 'ABCD2345',
        nombre: 'Kit 1',
        contenidos: null,
        itemsContenido: [{ item: { etiqueta: 'Computador' } }],
      });
      prisma.recepcionKit.findFirst.mockResolvedValueOnce(null);

      const result = await service.validarKit(operadorId, 'ABCD2345');

      expect(result.items).toEqual(['Computador']);
    });
  });

  describe('validarKitRetorno', () => {
    const adminRoles = ['ADMINISTRADOR'] as any;

    it('usa las etiquetas de la relación cuando el kit las tiene', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({
        id: kitId,
        codigoUnico: 'ABCD2345',
        nombre: 'Kit 1',
        operadorId,
        estado: 'EN_RETORNO',
        contenidos: 'Acta, sobres', // legacy, no debería usarse porque hay relación
        itemsContenido: [
          { itemId: 'i1', serie: '5CD445577S', estado: 'BUENO', item: { etiqueta: 'Computador' } },
          { itemId: 'i2', serie: null, estado: 'REGULAR', item: { etiqueta: 'Mouse' } },
        ],
      });
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Ana', apellidos: 'López' });
      prisma.recepcionDpiKit.findFirst.mockResolvedValueOnce(null);

      const result = await service.validarKitRetorno('sup1', adminRoles, 'ABCD2345');

      // Cada fila trae serie y el estado con el que salió el artículo.
      expect(result.items).toEqual([
        { texto: 'Computador', marcado: true, itemId: 'i1', serie: '5CD445577S', estado: 'BUENO' },
        { texto: 'Mouse', marcado: true, itemId: 'i2', serie: null, estado: 'REGULAR' },
      ]);
    });

    it('sin relación, cae al parseo del texto legacy de contenidos (sin regresión)', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({
        id: kitId,
        codigoUnico: 'ABCD2345',
        nombre: 'Kit 1',
        operadorId,
        estado: 'RETORNADO',
        contenidos: 'Acta, sobres',
        itemsContenido: [],
      });
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Ana', apellidos: 'López' });
      prisma.recepcionDpiKit.findFirst.mockResolvedValueOnce(null);

      const result = await service.validarKitRetorno('sup1', adminRoles, 'ABCD2345');

      expect(result.items).toEqual([
        { texto: 'Acta', marcado: true },
        { texto: 'sobres', marcado: true },
      ]);
    });

    it('el ASISTENTE_TRANSVERSAL valida el kit de cualquier operador sin asignación de supervisor', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({
        id: kitId,
        codigoUnico: 'ABCD2345',
        nombre: 'Kit 1',
        operadorId,
        estado: 'EN_RETORNO',
        contenidos: null,
        itemsContenido: [{ itemId: 'i1', serie: null, estado: 'BUENO', item: { etiqueta: 'Computador' } }],
      });
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Ana', apellidos: 'López' });
      prisma.recepcionDpiKit.findFirst.mockResolvedValueOnce(null);

      const result = await service.validarKitRetorno('asist1', ['ASISTENTE_TRANSVERSAL'], 'ABCD2345');

      expect(prisma.asignacionSupervisor.findFirst).not.toHaveBeenCalled();
      expect(result.items).toHaveLength(1);
    });

    it('un kit EN_RETORNO o RETORNADO no tiene la salida pendiente', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({
        id: kitId, codigoUnico: 'ABCD2345', nombre: 'Kit 1', operadorId, estado: 'RETORNADO',
        contenidos: 'Acta', itemsContenido: [],
      });
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Ana', apellidos: 'López' });
      prisma.recepcionDpiKit.findFirst.mockResolvedValueOnce(null);

      const result = await service.validarKitRetorno('asist1', ['ASISTENTE_TRANSVERSAL'], 'ABCD2345');

      expect(result.salidaPendiente).toBe(false);
    });

    it.each(['ENTREGADO', 'EN_RECINTO'])(
      'un kit %s (salida del recinto aún sin sincronizar) se puede verificar y avisa que la salida está pendiente',
      async (estado) => {
        prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
        prisma.kitElectoral.findUnique.mockResolvedValueOnce({
          id: kitId, codigoUnico: 'ABCD2345', nombre: 'Kit 1', operadorId, estado,
          contenidos: 'Acta', itemsContenido: [],
        });
        prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Ana', apellidos: 'López' });
        prisma.recepcionDpiKit.findFirst.mockResolvedValueOnce(null);

        const result = await service.validarKitRetorno('asist1', ['ASISTENTE_TRANSVERSAL'], 'ABCD2345');

        expect(result.salidaPendiente).toBe(true);
      },
    );

    it.each(['EN_BODEGA', 'ASIGNADO'])('un kit %s (el operador nunca lo recibió) sigue rechazado', async (estado) => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({
        id: kitId, codigoUnico: 'ABCD2345', nombre: 'Kit 1', operadorId, estado,
        contenidos: 'Acta', itemsContenido: [],
      });

      await expect(
        service.validarKitRetorno('asist1', ['ASISTENTE_TRANSVERSAL'], 'ABCD2345'),
      ).rejects.toThrow('El operador todavía no recibió este kit');
    });

    it('un kit sin artículos ni contenidos devuelve la lista vacía (se verifica igual)', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({
        id: kitId, codigoUnico: 'ABCD2345', nombre: 'Kit 1', operadorId, estado: 'RETORNADO',
        contenidos: null, itemsContenido: [],
      });
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Ana', apellidos: 'López' });
      prisma.recepcionDpiKit.findFirst.mockResolvedValueOnce(null);

      const result = await service.validarKitRetorno('asist1', ['ASISTENTE_TRANSVERSAL'], 'ABCD2345');

      expect(result.items).toEqual([]);
    });

    it('un rol no transversal sin asignación sobre ese operador recibe 400', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({
        id: kitId,
        codigoUnico: 'ABCD2345',
        nombre: 'Kit 1',
        operadorId,
        estado: 'EN_RETORNO',
        contenidos: null,
        itemsContenido: [],
      });
      prisma.asignacionSupervisor.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.validarKitRetorno('sup1', ['TECNICO_SUPERVISOR'], 'ABCD2345'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('checklistDesdeBd (acta de retorno)', () => {
    const contenido = [
      { itemId: 'i1', serie: '5CD445577S', estado: 'BUENO' as const, item: { etiqueta: 'Computador' } },
      { itemId: 'i2', serie: null, estado: 'BUENO' as const, item: { etiqueta: 'Cargador' } },
    ];

    it('toma texto y serie de la BD; del cliente solo marcado y estado', () => {
      const r = checklistDesdeBd(contenido, [
        { texto: 'Otro texto', marcado: true, itemId: 'i1', serie: 'FALSA', estado: 'REGULAR' },
        { texto: 'Cargador', marcado: false, itemId: 'i2' },
      ]);
      expect(r).toEqual([
        { texto: 'Computador', marcado: true, itemId: 'i1', serie: '5CD445577S', estado: 'REGULAR' },
        { texto: 'Cargador', marcado: false, itemId: 'i2', serie: null, estado: 'BUENO' },
      ]);
    });

    it('rechaza un ítem que no es del kit o que falte alguno', () => {
      expect(() =>
        checklistDesdeBd(contenido, [
          { texto: 'a', marcado: true, itemId: 'i1' },
          { texto: 'b', marcado: true, itemId: 'i2' },
          { texto: 'c', marcado: true, itemId: 'ajeno' },
        ]),
      ).toThrow(BadRequestException);
      expect(() => checklistDesdeBd(contenido, [{ texto: 'a', marcado: true, itemId: 'i1' }])).toThrow(
        BadRequestException,
      );
      expect(() =>
        checklistDesdeBd(contenido, [
          { texto: 'a', marcado: true, itemId: 'i1' },
          { texto: 'sin id', marcado: true },
        ]),
      ).toThrow(BadRequestException);
    });

    it('kits legacy sin ítems de catálogo guardan solo texto y marcado', () => {
      expect(checklistDesdeBd([], [{ texto: 'Acta', marcado: true, serie: 'x', estado: 'MALO' }], 'Acta')).toEqual([
        { texto: 'Acta', marcado: true },
      ]);
    });

    it('kits legacy: el texto sale de contenidos y se exige cada fila (no vale la lista vacía)', () => {
      expect(() => checklistDesdeBd([], [], 'Acta, sobres')).toThrow(BadRequestException);
      expect(() => checklistDesdeBd([], [{ texto: 'Acta', marcado: true }], 'Acta, sobres')).toThrow(
        BadRequestException,
      );
      expect(() =>
        checklistDesdeBd([], [{ texto: 'Acta', marcado: true }, { texto: 'Inventado', marcado: true }], 'Acta, sobres'),
      ).toThrow(BadRequestException);
      expect(
        checklistDesdeBd([], [{ texto: 'sobres', marcado: false }, { texto: 'Acta', marcado: true }], 'Acta, sobres'),
      ).toEqual([
        { texto: 'Acta', marcado: true },
        { texto: 'sobres', marcado: false },
      ]);
    });

    it('un kit sin artículos ni contenidos guarda la lista vacía aunque el cliente mande filas', () => {
      expect(checklistDesdeBd([], [{ texto: 'Inventado', marcado: true }], null)).toEqual([]);
    });

    it('un kit con artículos de catálogo no acepta la lista vacía', () => {
      expect(() => checklistDesdeBd(contenido, [])).toThrow(BadRequestException);
    });
  });

  describe('confirmarVerificacionKitRetorno', () => {
    const input = { kitId, items: [{ texto: 'Computador', marcado: true }] };
    const kit = { id: kitId, eventoId, operadorId, estado: 'RETORNADO' };

    it('con la salida ya sincronizada (RETORNADO) queda salidaPendiente=false', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kit);
      prisma.recepcionDpiKit.findFirst.mockResolvedValueOnce(null);
      prisma.recepcionDpiKit.create.mockResolvedValueOnce({ id: 'r1', confirmadoEn: new Date(ocurridoEn) });

      await service.confirmarVerificacionKitRetorno('asist1', ['ASISTENTE_TRANSVERSAL'], input);

      expect(prisma.recepcionDpiKit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ salidaPendiente: false }),
      });
    });

    it.each(['ENTREGADO', 'EN_RECINTO'])(
      'un kit %s se verifica y queda constancia de que la salida del recinto estaba pendiente',
      async (estado) => {
        prisma.kitElectoral.findUnique.mockResolvedValueOnce({ ...kit, estado });
        prisma.recepcionDpiKit.findFirst.mockResolvedValueOnce(null);
        prisma.recepcionDpiKit.create.mockResolvedValueOnce({ id: 'r1', confirmadoEn: new Date(ocurridoEn) });

        await service.confirmarVerificacionKitRetorno('asist1', ['ASISTENTE_TRANSVERSAL'], input);

        expect(prisma.recepcionDpiKit.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ salidaPendiente: true }),
        });
      },
    );

    it.each(['EN_BODEGA', 'ASIGNADO'])('un kit %s (el operador nunca lo recibió) no se puede verificar', async (estado) => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({ ...kit, estado });

      await expect(
        service.confirmarVerificacionKitRetorno('asist1', ['ASISTENTE_TRANSVERSAL'], input),
      ).rejects.toThrow('El operador todavía no recibió este kit');
      expect(prisma.recepcionDpiKit.create).not.toHaveBeenCalled();
    });

    it('un kit sin artículos registrados se verifica con la lista vacía', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({ ...kit, contenidos: null, itemsContenido: [] });
      prisma.recepcionDpiKit.findFirst.mockResolvedValueOnce(null);
      prisma.recepcionDpiKit.create.mockResolvedValueOnce({ id: 'r1', confirmadoEn: new Date(ocurridoEn) });

      await service.confirmarVerificacionKitRetorno('asist1', ['ASISTENTE_TRANSVERSAL'], { kitId, items: [] });

      expect(prisma.recepcionDpiKit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ items: [] }),
      });
    });

    it('el ASISTENTE_TRANSVERSAL verifica el kit de cualquier operador y queda registrado a su nombre', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kit);
      prisma.recepcionDpiKit.findFirst.mockResolvedValueOnce(null);
      prisma.recepcionDpiKit.create.mockResolvedValueOnce({ id: 'r1', confirmadoEn: new Date(ocurridoEn) });

      const result = await service.confirmarVerificacionKitRetorno('asist1', ['ASISTENTE_TRANSVERSAL'], input);

      expect(prisma.asignacionSupervisor.findFirst).not.toHaveBeenCalled();
      expect(prisma.recepcionDpiKit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ kitId, supervisorId: 'asist1' }),
      });
      expect(result).toEqual(expect.objectContaining({ id: 'r1', kitId }));
    });

    it('un rol no transversal sin asignación sobre ese operador recibe 400 y no crea nada', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(kit);
      prisma.asignacionSupervisor.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.confirmarVerificacionKitRetorno('sup1', ['TECNICO_SUPERVISOR'], input),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.recepcionDpiKit.create).not.toHaveBeenCalled();
    });
  });

  describe('confirmarRecepcionKit', () => {
    const input = { kitId, fotoMilitarUrl: 'militares/foto.enc', latitud: 0.35, longitud: -78.11 };

    it('lanza NotFoundException si el kit no existe', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.confirmarRecepcionKit(operadorId, input as any)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lanza BadRequestException si el kit no le pertenece', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({ id: kitId, operadorId: 'otro' });
      await expect(service.confirmarRecepcionKit(operadorId, input as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza BadRequestException si la foto del militar no existe en storage', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({ id: kitId, operadorId });
      storage.exists.mockResolvedValueOnce(false);
      await expect(service.confirmarRecepcionKit(operadorId, input as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('es idempotente: devuelve la recepción existente sin insertar de nuevo', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({ id: kitId, operadorId });
      storage.exists.mockResolvedValueOnce(true);
      prisma.recepcionKit.findFirst.mockResolvedValueOnce({
        id: 'rk-existente',
        confirmadoEn: new Date('2026-06-23T09:00:00Z'),
      });

      const result = await service.confirmarRecepcionKit(operadorId, input as any);

      expect(result.id).toBe('rk-existente');
      expect(prisma.$queryRaw).not.toHaveBeenCalled(); // no inserta
    });

    function recepcionNueva() {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({ id: kitId, operadorId, eventoId, codigoUnico: 'K01' });
      storage.exists.mockResolvedValueOnce(true);
      prisma.recepcionKit.findFirst.mockResolvedValueOnce(null);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'rk1', confirmado_en: new Date(ocurridoEn) }]);
    }

    it('sin entrega al militar registrada, recibe igual pero genera la alerta (no bloquea)', async () => {
      recepcionNueva();
      prisma.entregaCustodioKit.findUnique.mockResolvedValueOnce(null);

      const result = await service.confirmarRecepcionKit(operadorId, input as any);

      expect(result.id).toBe('rk1');
      expect(prisma.kitElectoral.update).toHaveBeenCalledWith({ where: { id: kitId }, data: { estado: 'ENTREGADO' } });
      expect(alertas.generarEntregaMilitarNoRegistrada).toHaveBeenCalledWith({
        eventoId,
        operadorId,
        kitId,
        codigoKit: 'K01',
      });
    });

    it('si generar la alerta falla, la recepción ya guardada no se rompe', async () => {
      recepcionNueva();
      prisma.entregaCustodioKit.findUnique.mockResolvedValueOnce(null);
      alertas.generarEntregaMilitarNoRegistrada.mockRejectedValueOnce(new Error('BD caída'));

      await expect(service.confirmarRecepcionKit(operadorId, input as any)).resolves.toEqual(
        expect.objectContaining({ id: 'rk1' }),
      );
    });

    it('con la entrega al militar registrada, no genera alerta', async () => {
      recepcionNueva();
      prisma.entregaCustodioKit.findUnique.mockResolvedValueOnce({ id: 'e1' });

      await service.confirmarRecepcionKit(operadorId, input as any);

      expect(alertas.generarEntregaMilitarNoRegistrada).not.toHaveBeenCalled();
    });
  });

  describe('registrarLlegadaRecinto', () => {
    it('lanza ConflictException si ya registró la llegada', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst.mockResolvedValueOnce({ id: 'tk1' }); // llegada previa
      await expect(service.registrarLlegadaRecinto(operadorId, geo as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('lanza BadRequestException si no registró la salida del DPI antes', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null) // sin llegada previa
        .mockResolvedValueOnce(null); // sin salida_dpi
      await expect(service.registrarLlegadaRecinto(operadorId, geo as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza BadRequestException si faltan kits por confirmar', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null) // sin llegada previa
        .mockResolvedValueOnce({ id: 'salida' }); // salida_dpi ok
      prisma.kitElectoral.findMany.mockResolvedValueOnce([
        { id: 'k1', recintoId },
        { id: 'k2', recintoId },
      ]);
      prisma.recepcionKit.findMany.mockResolvedValueOnce([{ kitId: 'k1' }]); // falta k2
      await expect(service.registrarLlegadaRecinto(operadorId, geo as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza BadRequestException si está fuera del margen del recinto (geocerca)', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'salida' });
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ id: 'k1', recintoId }]);
      prisma.recepcionKit.findMany.mockResolvedValueOnce([{ kitId: 'k1' }]); // todo recibido
      prisma.$queryRaw.mockResolvedValueOnce([{ metros: 9999 }]); // lejos
      prisma.configAlerta.findUnique.mockResolvedValueOnce(null); // margen default 150

      await expect(service.registrarLlegadaRecinto(operadorId, geo as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(alertas.generarLlegadaFueraDeRango).not.toHaveBeenCalled();
    });

    it('registrada sin señal fuera del margen: la acepta, la marca offline y alerta al supervisor', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'salida' });
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ id: 'k1', recintoId }]);
      prisma.recepcionKit.findMany.mockResolvedValueOnce([{ kitId: 'k1' }]);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ metros: 900 }]) // fuera del margen
        .mockResolvedValueOnce([{ id: 'llegada-id' }]); // INSERT
      prisma.configAlerta.findUnique.mockResolvedValueOnce({ margenLlegadaMetros: 150 });
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Ana', apellidos: 'López' });
      prisma.recinto.findUnique.mockResolvedValueOnce({ nombre: 'Escuela Apuela' });

      const result = await service.registrarLlegadaRecinto(operadorId, {
        ...geo,
        precisionMetros: 10,
        desdeOffline: true,
      } as any);

      expect(result.id).toBe('llegada-id');
      expect(valoresInsert('eventos_tracking')).toContain(true); // desde_offline
      expect(alertas.generarLlegadaFueraDeRango).toHaveBeenCalledWith({
        eventoId,
        operadorId,
        destino: 'RECINTO',
        nombreDestino: 'Escuela Apuela',
        metros: 900,
        margen: 160,
        desfaseMinutos: expect.any(Number),
      });
      // La alerta se crea antes del INSERT: si falla, no queda una llegada sin aviso.
      const ordenAlerta = alertas.generarLlegadaFueraDeRango.mock.invocationCallOrder[0];
      const ordenInsert = prisma.$queryRaw.mock.invocationCallOrder[1];
      expect(ordenAlerta).toBeLessThan(ordenInsert);
      expect(notifications.encolarLlegadaRecinto).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['enviada al instante', 0],
      ['con la hora del celular en el futuro', -10 * 60_000],
    ])('marcada sin señal pero %s: se rechaza como con señal', async (_caso, haceMs) => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'salida' });
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ id: 'k1', recintoId }]);
      prisma.recepcionKit.findMany.mockResolvedValueOnce([{ kitId: 'k1' }]);
      prisma.$queryRaw.mockResolvedValueOnce([{ metros: 900 }]);
      prisma.configAlerta.findUnique.mockResolvedValueOnce({ margenLlegadaMetros: 150 });

      await expect(
        service.registrarLlegadaRecinto(operadorId, {
          ...geo,
          ocurridoEn: new Date(Date.now() - haceMs).toISOString(),
          desdeOffline: true,
        } as any),
      ).rejects.toThrow(BadRequestException);
      expect(alertas.generarLlegadaFueraDeRango).not.toHaveBeenCalled();
    });
  });

  describe('registrarSalidaRecinto', () => {
    const conActas = {
      ...geo,
      actaInstalacionUrl: 'actas/instalacion.bin',
      actaEscrutinioUrl: 'actas/escrutinio.bin',
    };

    it('lanza ConflictException si ya registró la salida del recinto', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst.mockResolvedValueOnce({ id: 'tk1' });
      await expect(service.registrarSalidaRecinto(operadorId, conActas as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('lanza BadRequestException si no registró la llegada al recinto antes', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null) // sin salida previa
        .mockResolvedValueOnce(null); // sin llegada al recinto
      await expect(service.registrarSalidaRecinto(operadorId, conActas as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza ZodError si faltan las actas obligatorias (instalación/escrutinio)', async () => {
      await expect(service.registrarSalidaRecinto(operadorId, geo as any)).rejects.toThrow();
      expect(prisma.eventoElectoral.findFirst).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si el acta de instalación no existe en storage', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null) // sin salida previa
        .mockResolvedValueOnce({ id: 'tk-llegada' }); // llegada al recinto ok
      storage.exists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

      await expect(service.registrarSalidaRecinto(operadorId, conActas as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('lanza BadRequestException si el acta de escrutinio no existe en storage', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'tk-llegada' });
      storage.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      await expect(service.registrarSalidaRecinto(operadorId, conActas as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('registra la salida del recinto con ambas actas verificadas', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'tk-llegada' });
      storage.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ recintoId });
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'salida-recinto-id' }]);
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Ana', apellidos: 'Perez' });
      prisma.recinto.findUnique.mockResolvedValueOnce({ nombre: 'CDA 1' });

      const result = await service.registrarSalidaRecinto(operadorId, conActas as any);

      expect(result.id).toBe('salida-recinto-id');
      expect(prisma.kitElectoral.updateMany).toHaveBeenCalledWith({
        where: { eventoId, operadorId, estado: 'EN_RECINTO' },
        data: { estado: 'EN_RETORNO' },
      });
      expect(notifications.encolarSalidaRecinto).toHaveBeenCalledTimes(1);
    });
  });

  describe('registrarLlegadaDpiManual (el operador olvidó marcarla)', () => {
    const adminId = '99999999-9999-9999-9999-999999999999';
    const motivo = 'Olvidó marcar la llegada; entregó el kit en bodega';

    beforeEach(() => prisma.usuario.findFirst.mockResolvedValue({ id: operadorId }));

    it('registra la llegada con la hora actual, quién y por qué, cierra los kits y avisa, sin borrar nada', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null) // sin llegada previa
        .mockResolvedValueOnce({ id: 'salida-recinto' });
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ recintoId });
      prisma.eventoTracking.create.mockResolvedValueOnce({ id: 'llegada-manual', ocurridoEn: new Date('2026-06-23T19:00:00Z') });
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Ana', apellidos: 'López' });
      prisma.recinto.findUnique.mockResolvedValueOnce({ nombre: 'CDA 1' });

      const r = await service.registrarLlegadaDpiManual(operadorId, motivo, adminId);

      expect(prisma.eventoTracking.create).toHaveBeenCalledWith({
        data: {
          eventoId,
          operadorId,
          tipo: 'LLEGADA_DPI',
          recintoId,
          ocurridoEn: expect.any(Date),
          registradoPorId: adminId,
          motivoManual: motivo,
        },
        select: { id: true, ocurridoEn: true },
      });
      expect(prisma.kitElectoral.updateMany).toHaveBeenCalledWith({
        where: { eventoId, operadorId, estado: 'EN_RETORNO' },
        data: { estado: 'RETORNADO' },
      });
      expect(notifications.encolarLlegadaDpi).toHaveBeenCalledTimes(1);
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(r).toEqual({ id: 'llegada-manual', ocurridoEn: '2026-06-23T19:00:00.000Z' });
    });

    it('si ya tiene la llegada registrada: 409', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst.mockResolvedValueOnce({ id: 'ya' });

      await expect(service.registrarLlegadaDpiManual(operadorId, motivo, adminId)).rejects.toThrow(
        'Este operador ya tiene registrada la llegada al DPEI',
      );
      expect(prisma.eventoTracking.create).not.toHaveBeenCalled();
    });

    it('sin salida del recinto: 400 (no está en retorno)', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

      await expect(service.registrarLlegadaDpiManual(operadorId, motivo, adminId)).rejects.toThrow(
        'El operador aún no registra la salida del recinto',
      );
      expect(prisma.eventoTracking.create).not.toHaveBeenCalled();
    });

    it('sin evento activo: 404', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(null);
      await expect(service.registrarLlegadaDpiManual(operadorId, motivo, adminId)).rejects.toThrow(NotFoundException);
    });

    it('si el usuario no es un Operador CDA: 404, sin registrar nada', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.usuario.findFirst.mockResolvedValueOnce(null);

      await expect(service.registrarLlegadaDpiManual(operadorId, motivo, adminId)).rejects.toThrow('Operador no encontrado');
      expect(prisma.usuario.findFirst).toHaveBeenCalledWith({
        where: { id: operadorId, roles: { some: { rol: { nombre: 'OPERADOR_CDA' } } } },
        select: { id: true },
      });
      expect(prisma.eventoTracking.create).not.toHaveBeenCalled();
    });

    it('si el operador la marcó en la app al mismo tiempo (índice único): 409, sin cerrar ni avisar dos veces', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'salida-recinto' });
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ recintoId });
      prisma.eventoTracking.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }));

      await expect(service.registrarLlegadaDpiManual(operadorId, motivo, adminId)).rejects.toThrow(ConflictException);
      expect(prisma.kitElectoral.updateMany).not.toHaveBeenCalled();
      expect(notifications.encolarLlegadaDpi).not.toHaveBeenCalled();
    });
  });

  describe('registrarLlegadaDpi', () => {
    it('si el administrador la registró al mismo tiempo (índice único): 409, sin cerrar ni avisar dos veces', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'salida-recinto' });
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ recintoId });
      prisma.$queryRaw
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(Object.assign(new Error('raw'), { code: 'P2010', meta: { code: '23505' } }));

      await expect(service.registrarLlegadaDpi(operadorId, geo as any)).rejects.toThrow('Ya registraste tu llegada al DPI');
      expect(prisma.kitElectoral.updateMany).not.toHaveBeenCalled();
      expect(notifications.encolarLlegadaDpi).not.toHaveBeenCalled();
    });

    it('lanza ConflictException si ya registró la llegada al DPI', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst.mockResolvedValueOnce({ id: 'tk1' });
      await expect(service.registrarLlegadaDpi(operadorId, geo as any)).rejects.toThrow(
        ConflictException,
      );
    });

    it('lanza BadRequestException si no registró la salida del recinto antes', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null) // sin llegada dpi previa
        .mockResolvedValueOnce(null); // sin salida del recinto
      await expect(service.registrarLlegadaDpi(operadorId, geo as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('registra la llegada, marca kits como RETORNADO y notifica (sin delegacionUbicacion cargada: no bloquea — regresión)', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null) // sin llegada dpi previa
        .mockResolvedValueOnce({ id: 'salida-recinto' }); // salida del recinto ok
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ recintoId });
      prisma.$queryRaw
        .mockResolvedValueOnce([]) // delegacion_ubicacion NULL -> query no devuelve filas
        .mockResolvedValueOnce([{ id: 'llegada-dpi-id' }]); // INSERT
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Ana', apellidos: 'López' });
      prisma.recinto.findUnique.mockResolvedValueOnce({ nombre: 'CDA 1' });

      const result = await service.registrarLlegadaDpi(operadorId, geo as any);

      expect(result.id).toBe('llegada-dpi-id');
      expect(prisma.configAlerta.findUnique).not.toHaveBeenCalled(); // metros null -> no consulta margen
      expect(prisma.kitElectoral.updateMany).toHaveBeenCalledWith({
        where: { eventoId, operadorId, estado: 'EN_RETORNO' },
        data: { estado: 'RETORNADO' },
      });
      expect(notifications.encolarLlegadaDpi).toHaveBeenCalledTimes(1);
    });

    it('lanza BadRequestException si está fuera del margen de la Delegación (geocerca)', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null) // sin llegada dpi previa
        .mockResolvedValueOnce({ id: 'salida-recinto' }); // salida del recinto ok
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ recintoId });
      prisma.$queryRaw.mockResolvedValueOnce([{ metros: 9999 }]); // lejos de la Delegación
      prisma.configAlerta.findUnique.mockResolvedValueOnce({ margenLlegadaDpiMetros: 150 });

      await expect(service.registrarLlegadaDpi(operadorId, geo as any)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.kitElectoral.updateMany).not.toHaveBeenCalled();
      expect(alertas.generarLlegadaFueraDeRango).not.toHaveBeenCalled();
    });

    it('registrada sin señal fuera del margen de la Delegación: la acepta y alerta', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'salida-recinto' });
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ recintoId });
      prisma.$queryRaw
        .mockResolvedValueOnce([{ metros: 9999 }])
        .mockResolvedValueOnce([{ id: 'llegada-dpi-id' }]);
      prisma.configAlerta.findUnique.mockResolvedValueOnce({ margenLlegadaDpiMetros: 150 });
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Ana', apellidos: 'López' });
      prisma.recinto.findUnique.mockResolvedValueOnce({ nombre: 'CDA 1' });

      const result = await service.registrarLlegadaDpi(operadorId, { ...geo, desdeOffline: true } as any);

      expect(result.id).toBe('llegada-dpi-id');
      expect(prisma.kitElectoral.updateMany).toHaveBeenCalled();
      expect(alertas.generarLlegadaFueraDeRango).toHaveBeenCalledWith({
        eventoId,
        operadorId,
        destino: 'DPI',
        nombreDestino: null,
        metros: 9999,
        margen: 150,
        desfaseMinutos: expect.any(Number),
      });
    });

    it('registra la llegada si está dentro del margen de la Delegación', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null) // sin llegada dpi previa
        .mockResolvedValueOnce({ id: 'salida-recinto' }); // salida del recinto ok
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ recintoId });
      prisma.$queryRaw
        .mockResolvedValueOnce([{ metros: 80 }]) // dentro del margen
        .mockResolvedValueOnce([{ id: 'llegada-dpi-id' }]); // INSERT
      prisma.configAlerta.findUnique.mockResolvedValueOnce({ margenLlegadaDpiMetros: 150 });
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Ana', apellidos: 'López' });
      prisma.recinto.findUnique.mockResolvedValueOnce({ nombre: 'CDA 1' });

      const result = await service.registrarLlegadaDpi(operadorId, geo as any);

      expect(result.id).toBe('llegada-dpi-id');
      expect(notifications.encolarLlegadaDpi).toHaveBeenCalledTimes(1);
    });
  });

  describe('ingestarPosiciones', () => {
    const input = {
      posiciones: [{ latitud: 0.35, longitud: -78.11, capturadoEn: ocurridoEn }],
    };

    it('lanza BadRequestException si aún no ha salido del DPI (EN_DPI)', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findMany.mockResolvedValueOnce([]);
      await expect(service.ingestarPosiciones(operadorId, input as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza BadRequestException si está parado en el recinto (EN_RECINTO)', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findMany.mockResolvedValueOnce([
        { tipo: 'SALIDA_DPI' },
        { tipo: 'LLEGADA_RECINTO' },
      ]);
      await expect(service.ingestarPosiciones(operadorId, input as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lanza BadRequestException si ya registró la llegada al DPI (rastreo terminó)', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findMany.mockResolvedValueOnce([
        { tipo: 'SALIDA_DPI' },
        { tipo: 'LLEGADA_RECINTO' },
        { tipo: 'SALIDA_RECINTO' },
        { tipo: 'LLEGADA_DPI' },
      ]);
      await expect(service.ingestarPosiciones(operadorId, input as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('acepta e inserta posiciones durante el tramo de ida (EN_TRANSITO)', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findMany.mockResolvedValueOnce([{ tipo: 'SALIDA_DPI' }]);
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await service.ingestarPosiciones(operadorId, input as any);

      expect(result.recibidas).toBe(1);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('acepta e inserta posiciones durante el tramo de retorno (EN_RETORNO)', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findMany.mockResolvedValueOnce([
        { tipo: 'SALIDA_DPI' },
        { tipo: 'LLEGADA_RECINTO' },
        { tipo: 'SALIDA_RECINTO' },
      ]);
      prisma.$executeRaw.mockResolvedValue(1);

      const result = await service.ingestarPosiciones(operadorId, input as any);

      expect(result.recibidas).toBe(1);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('operadoresEnRetorno', () => {
    const operadorIdA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const operadorIdB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const operadorIdC = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const ultimaPosicion = [{ lat: 0.35, lng: -78.11, capturado_en: new Date(ocurridoEn) }];

    it('sin evento activo devuelve lista vacía', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(null);
      const result = await service.operadoresEnRetorno(operadorId, ['ADMINISTRADOR']);
      expect(result).toEqual([]);
    });

    it('un admin ve operadores en ambos tramos con el estado correcto', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findMany.mockResolvedValueOnce([
        { operadorId: operadorIdA, tipo: 'SALIDA_DPI' },
        { operadorId: operadorIdB, tipo: 'SALIDA_DPI' },
        { operadorId: operadorIdB, tipo: 'LLEGADA_RECINTO' },
        { operadorId: operadorIdB, tipo: 'SALIDA_RECINTO' },
      ]);
      prisma.usuario.findMany.mockResolvedValueOnce([
        { id: operadorIdA, nombres: 'Ana', apellidos: 'Perez' },
        { id: operadorIdB, nombres: 'Beto', apellidos: 'Gomez' },
      ]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);
      prisma.$queryRaw
        .mockResolvedValueOnce(ultimaPosicion)
        .mockResolvedValueOnce(ultimaPosicion);

      const result = await service.operadoresEnRetorno(operadorId, ['ADMINISTRADOR']);

      expect(prisma.asignacionSupervisor.findMany).not.toHaveBeenCalled();
      expect(result).toEqual([
        expect.objectContaining({ operadorId: operadorIdA, estado: 'EN_TRANSITO' }),
        expect.objectContaining({ operadorId: operadorIdB, estado: 'EN_RETORNO' }),
      ]);
    });

    it('un LECTOR ve operadores en ambos tramos igual que un admin (sin filtrar por asignación)', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findMany.mockResolvedValueOnce([
        { operadorId: operadorIdA, tipo: 'SALIDA_DPI' },
        { operadorId: operadorIdB, tipo: 'SALIDA_DPI' },
        { operadorId: operadorIdB, tipo: 'LLEGADA_RECINTO' },
        { operadorId: operadorIdB, tipo: 'SALIDA_RECINTO' },
      ]);
      prisma.usuario.findMany.mockResolvedValueOnce([
        { id: operadorIdA, nombres: 'Ana', apellidos: 'Perez' },
        { id: operadorIdB, nombres: 'Beto', apellidos: 'Gomez' },
      ]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);
      prisma.$queryRaw
        .mockResolvedValueOnce(ultimaPosicion)
        .mockResolvedValueOnce(ultimaPosicion);

      const result = await service.operadoresEnRetorno(operadorId, ['LECTOR']);

      expect(prisma.asignacionSupervisor.findMany).not.toHaveBeenCalled();
      expect(result).toEqual([
        expect.objectContaining({ operadorId: operadorIdA, estado: 'EN_TRANSITO' }),
        expect.objectContaining({ operadorId: operadorIdB, estado: 'EN_RETORNO' }),
      ]);
    });

    it('un supervisor solo ve a sus operadores asignados', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findMany.mockResolvedValueOnce([
        { operadorId: operadorIdA, tipo: 'SALIDA_DPI' },
        { operadorId: operadorIdB, tipo: 'SALIDA_DPI' },
        { operadorId: operadorIdB, tipo: 'LLEGADA_RECINTO' },
        { operadorId: operadorIdB, tipo: 'SALIDA_RECINTO' },
      ]);
      prisma.asignacionSupervisor.findMany.mockResolvedValueOnce([{ operadorId: operadorIdB }]);
      prisma.usuario.findMany.mockResolvedValueOnce([
        { id: operadorIdB, nombres: 'Beto', apellidos: 'Gomez' },
      ]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);
      prisma.$queryRaw.mockResolvedValueOnce(ultimaPosicion);

      const result = await service.operadoresEnRetorno(operadorId, ['TECNICO_SUPERVISOR']);

      expect(result).toEqual([
        expect.objectContaining({ operadorId: operadorIdB, estado: 'EN_RETORNO' }),
      ]);
    });

    it('excluye operadores en EN_DPI o RETORNADO', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findMany.mockResolvedValueOnce([
        { operadorId: operadorIdC, tipo: 'SALIDA_DPI' },
        { operadorId: operadorIdC, tipo: 'LLEGADA_RECINTO' },
        { operadorId: operadorIdC, tipo: 'SALIDA_RECINTO' },
        { operadorId: operadorIdC, tipo: 'LLEGADA_DPI' },
      ]);

      const result = await service.operadoresEnRetorno(operadorId, ['ADMINISTRADOR']);

      expect(result).toEqual([]);
      expect(prisma.usuario.findMany).not.toHaveBeenCalled();
    });

    it('excluye operadores calificados que aún no tienen posición GPS', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findMany.mockResolvedValueOnce([
        { operadorId: operadorIdA, tipo: 'SALIDA_DPI' },
      ]);
      prisma.usuario.findMany.mockResolvedValueOnce([
        { id: operadorIdA, nombres: 'Ana', apellidos: 'Perez' },
      ]);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([]);
      prisma.$queryRaw.mockResolvedValueOnce([]);

      const result = await service.operadoresEnRetorno(operadorId, ['ADMINISTRADOR']);

      expect(result).toEqual([]);
    });
  });

  describe('estadoCdas', () => {
    it('un LECTOR ve todos los CDAs sin filtrar por asignación (igual que un admin)', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ recintoId, operadorId }]);
      prisma.recinto.findMany.mockResolvedValueOnce([
        {
          id: recintoId,
          codigoRecinto: 'C01',
          nombre: 'Recinto 1',
          cantonId: 1,
          canton: { nombre: 'IBARRA' },
        },
      ]);
      prisma.usuario.findMany.mockResolvedValueOnce([
        { id: operadorId, nombres: 'Ana', apellidos: 'Perez' },
      ]);
      prisma.eventoTracking.findMany
        .mockResolvedValueOnce([]) // trackingRows (estado)
        .mockResolvedValueOnce([
          { operadorId, actaInstalacionUrl: 'actas/inst.bin', actaEscrutinioUrl: null },
        ]); // salidasRecinto (flags de actas)
      prisma.recepcionKit.findMany.mockResolvedValueOnce([]);
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const result = await service.estadoCdas(operadorId, ['LECTOR']);

      expect(prisma.asignacionSupervisor.findMany).not.toHaveBeenCalled();
      expect(result).toEqual([
        expect.objectContaining({
          recintoId,
          operadorId,
          tieneActaInstalacion: true,
          tieneActaEscrutinio: false,
        }),
      ]);
    });

    it('la foto del militar solo cuenta si la recepción es de un kit del evento activo', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ id: kitId, recintoId, operadorId }]);
      prisma.recinto.findMany.mockResolvedValueOnce([
        { id: recintoId, codigoRecinto: 'C01', nombre: 'Recinto 1', cantonId: 1, canton: { nombre: 'IBARRA' } },
      ]);
      prisma.usuario.findMany.mockResolvedValueOnce([{ id: operadorId, nombres: 'Ana', apellidos: 'Perez' }]);
      prisma.eventoTracking.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
      prisma.recepcionKit.findMany.mockResolvedValueOnce([]);
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      await service.estadoCdas(operadorId, ['ADMINISTRADOR']);

      expect(prisma.recepcionKit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ kitId: { in: [kitId] }, fotoMilitarUrl: { not: null } }),
        }),
      );
    });

    function prepararUnCda(trackingRows: { operadorId: string; tipo: string; ocurridoEn: Date }[]) {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ id: kitId, recintoId, operadorId }]);
      prisma.recinto.findMany.mockResolvedValueOnce([
        { id: recintoId, codigoRecinto: 'C01', nombre: 'Recinto 1', cantonId: 1, canton: { nombre: 'IBARRA' } },
      ]);
      prisma.usuario.findMany.mockResolvedValueOnce([{ id: operadorId, nombres: 'Ana', apellidos: 'Perez' }]);
      prisma.eventoTracking.findMany.mockResolvedValueOnce(trackingRows).mockResolvedValueOnce([]);
      prisma.recepcionKit.findMany.mockResolvedValueOnce([]);
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    }

    it('sin prueba de conexión, pruebaConexionEn es null', async () => {
      prepararUnCda([{ operadorId, tipo: 'LLEGADA_RECINTO', ocurridoEn: new Date('2026-10-21T13:00:00.000Z') }]);

      const [cda] = await service.estadoCdas(operadorId, ['ADMINISTRADOR']);

      expect(cda.pruebaConexionEn).toBeNull();
    });

    it('si la prueba de conexión se registró más de una vez, devuelve la más reciente', async () => {
      // La más reciente llega primero: el resultado no debe depender del orden de las filas.
      prepararUnCda([
        { operadorId, tipo: 'PRUEBA_CONEXION', ocurridoEn: new Date('2026-10-21T13:40:00.000Z') },
        { operadorId, tipo: 'LLEGADA_RECINTO', ocurridoEn: new Date('2026-10-21T13:05:00.000Z') },
        { operadorId, tipo: 'PRUEBA_CONEXION', ocurridoEn: new Date('2026-10-21T13:10:00.000Z') },
      ]);

      const [cda] = await service.estadoCdas(operadorId, ['ADMINISTRADOR']);

      expect(cda.pruebaConexionEn).toBe('2026-10-21T13:40:00.000Z');
      expect(cda.estado).toBe('EN_RECINTO');
      expect(prisma.eventoTracking.findMany).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ select: { operadorId: true, tipo: true, ocurridoEn: true } }),
      );
    });
  });

  describe('recintosDificilAcceso', () => {
    it('un LECTOR ve todos los recintos de difícil acceso sin filtrar por asignación', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ recintoId, operadorId }]);
      prisma.recinto.findMany.mockResolvedValueOnce([
        { id: recintoId, codigoRecinto: 'C01', nombre: 'Recinto 1' },
      ]);
      prisma.usuario.findMany.mockResolvedValueOnce([
        { id: operadorId, nombres: 'Ana', apellidos: 'Perez' },
      ]);
      prisma.eventoTracking.findMany.mockResolvedValueOnce([]);

      const result = await service.recintosDificilAcceso(operadorId, ['LECTOR']);

      expect(prisma.asignacionSupervisor.findMany).not.toHaveBeenCalled();
      expect(result).toEqual([expect.objectContaining({ recintoId, operadorId })]);
    });
  });

  describe('obtenerFotoMilitar', () => {
    it('un LECTOR obtiene la foto sin verificar asignación de supervisor', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ operadorId });
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ id: kitId }]);
      prisma.recepcionKit.findFirst.mockResolvedValueOnce({ fotoMilitarUrl: 'militares/foto.bin' });
      storage.readDecrypted.mockResolvedValueOnce(Buffer.from([0xff, 0xd8, 0xff]));

      const result = await service.obtenerFotoMilitar(recintoId, operadorId, ['LECTOR']);

      expect(prisma.asignacionSupervisor.findFirst).not.toHaveBeenCalled();
      expect(result.contentType).toBe('image/jpeg');
    });

    it('solo busca la foto en recepciones de kits del evento activo (no de un evento cerrado)', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ operadorId });
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ id: kitId }]);
      prisma.recepcionKit.findFirst.mockResolvedValueOnce(null);

      await expect(service.obtenerFotoMilitar(recintoId, operadorId, ['ADMINISTRADOR'])).rejects.toThrow(
        'No hay foto del militar registrada para este CDA',
      );
      expect(prisma.kitElectoral.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { eventoId: evento.id, operadorId } }),
      );
      expect(prisma.recepcionKit.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ operadorId, kitId: { in: [kitId] } }),
        }),
      );
    });
  });

  describe('kitsVerificadosRetorno', () => {
    it('un LECTOR ve todos los kits verificados sin filtrar por asignación', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([
        { id: kitId, codigoUnico: 'K01', nombre: 'Kit 1', operadorId },
      ]);
      prisma.recepcionDpiKit.findMany.mockResolvedValueOnce([
        { kitId, confirmadoEn: new Date(ocurridoEn) },
      ]);
      prisma.usuario.findMany.mockResolvedValueOnce([
        { id: operadorId, nombres: 'Ana', apellidos: 'Perez' },
      ]);

      const result = await service.kitsVerificadosRetorno(operadorId, ['LECTOR']);

      expect(prisma.asignacionSupervisor.findMany).not.toHaveBeenCalled();
      expect(result.total).toBe(1);
      expect(result.items[0]).toEqual(expect.objectContaining({ kitId, operadorId }));
    });

    it('el ASISTENTE_TRANSVERSAL ve todos los kits verificados sin filtrar por asignación', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([
        { id: kitId, codigoUnico: 'K01', nombre: 'Kit 1', operadorId },
      ]);
      prisma.recepcionDpiKit.findMany.mockResolvedValueOnce([
        { kitId, confirmadoEn: new Date(ocurridoEn) },
      ]);
      prisma.usuario.findMany.mockResolvedValueOnce([
        { id: operadorId, nombres: 'Ana', apellidos: 'Perez' },
      ]);

      const result = await service.kitsVerificadosRetorno('asist1', ['ASISTENTE_TRANSVERSAL']);

      expect(prisma.asignacionSupervisor.findMany).not.toHaveBeenCalled();
      expect(result.total).toBe(1);
    });
  });

  describe('guardarFotoActa', () => {
    it('lanza BadRequestException si el archivo no es una imagen', async () => {
      const file = { mimetype: 'application/pdf', buffer: Buffer.from('x') } as Express.Multer.File;
      await expect(service.guardarFotoActa(file)).rejects.toThrow(BadRequestException);
      expect(storage.saveEncrypted).not.toHaveBeenCalled();
    });

    it('guarda la foto en la categoría "actas" y devuelve la url', async () => {
      const file = { mimetype: 'image/jpeg', buffer: Buffer.from('foto') } as Express.Multer.File;
      storage.saveEncrypted.mockResolvedValueOnce('actas/abc123.bin');

      const result = await service.guardarFotoActa(file);

      expect(storage.saveEncrypted).toHaveBeenCalledWith({
        categoria: 'actas',
        buffer: file.buffer,
      });
      expect(result).toEqual({ url: 'actas/abc123.bin' });
    });
  });

  describe('obtenerFotoActa', () => {
    it('lanza NotFoundException si el CDA no existe', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.obtenerFotoActa(recintoId, operadorId, ['ADMINISTRADOR'], 'instalacion'),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza NotFoundException si el operador aún no registró su salida del recinto', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ operadorId });
      prisma.eventoTracking.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.obtenerFotoActa(recintoId, operadorId, ['ADMINISTRADOR'], 'instalacion'),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza NotFoundException si no hay acta de ese tipo registrada', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ operadorId });
      prisma.eventoTracking.findFirst.mockResolvedValueOnce({
        actaInstalacionUrl: null,
        actaEscrutinioUrl: 'actas/escrutinio.bin',
      });

      await expect(
        service.obtenerFotoActa(recintoId, operadorId, ['ADMINISTRADOR'], 'instalacion'),
      ).rejects.toThrow(NotFoundException);
    });

    it('un LECTOR obtiene el acta de escrutinio sin verificar asignación de supervisor', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ operadorId });
      prisma.eventoTracking.findFirst.mockResolvedValueOnce({
        actaInstalacionUrl: 'actas/instalacion.bin',
        actaEscrutinioUrl: 'actas/escrutinio.bin',
      });
      storage.readDecrypted.mockResolvedValueOnce(Buffer.from([0xff, 0xd8, 0xff]));

      const result = await service.obtenerFotoActa(recintoId, operadorId, ['LECTOR'], 'escrutinio');

      expect(prisma.asignacionSupervisor.findFirst).not.toHaveBeenCalled();
      expect(storage.readDecrypted).toHaveBeenCalledWith('actas/escrutinio.bin');
      expect(result.contentType).toBe('image/jpeg');
    });
  });

  // La cola offline del móvil reenvía con desdeOffline: true; antes el schema lo
  // descartaba y los INSERT escribían false fijo, perdiendo el dato de auditoría.
  describe('desde_offline en acciones sincronizadas desde la cola del móvil', () => {
    const offline = { desdeOffline: true };

    function mockSalidaDpiOk() {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst.mockResolvedValueOnce(null);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ recintoId });
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'salida-dpi-id' }]);
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Ana', apellidos: 'López' });
      prisma.recinto.findUnique.mockResolvedValueOnce({ nombre: 'CDA 1' });
    }

    it('salida del DPI: guarda desde_offline=true si llega desde la cola', async () => {
      mockSalidaDpiOk();
      await service.registrarSalidaDpi(operadorId, { ...geo, ...offline } as any);
      expect(valoresInsert('eventos_tracking')).toContain(true);
    });

    it('salida del DPI: guarda desde_offline=false si no viene el campo (registro en línea)', async () => {
      mockSalidaDpiOk();
      await service.registrarSalidaDpi(operadorId, geo as any);
      const valores = valoresInsert('eventos_tracking');
      expect(valores).toContain(false);
      expect(valores).not.toContain(true);
    });

    it('recepción de kit: guarda desde_offline=true si llega desde la cola', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce({ id: kitId, operadorId, eventoId });
      storage.exists.mockResolvedValueOnce(true);
      prisma.recepcionKit.findFirst.mockResolvedValueOnce(null);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'rk-id', confirmado_en: new Date(ocurridoEn) }]);

      await service.confirmarRecepcionKit(operadorId, {
        kitId,
        fotoMilitarUrl: 'militares/foto.enc',
        latitud: 0.35,
        longitud: -78.11,
        ...offline,
      } as any);

      expect(valoresInsert('recepciones_kit')).toContain(true);
    });

    it('llegada al recinto: guarda desde_offline=true si llega desde la cola', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'salida' });
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ id: 'k1', recintoId }]);
      prisma.recepcionKit.findMany.mockResolvedValueOnce([{ kitId: 'k1' }]);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ metros: 10 }]) // dentro de la geocerca
        .mockResolvedValueOnce([{ id: 'llegada-recinto-id' }]); // INSERT
      prisma.configAlerta.findUnique.mockResolvedValueOnce(null);
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Ana', apellidos: 'López' });
      prisma.recinto.findUnique.mockResolvedValueOnce({ nombre: 'CDA 1' });

      await service.registrarLlegadaRecinto(operadorId, { ...geo, ...offline } as any);

      expect(valoresInsert('eventos_tracking')).toContain(true);
    });

    it('llegada a un NO-CDA: guarda desde_offline=true si llega desde la cola', async () => {
      const noCdaId = '55555555-5555-5555-5555-555555555555';
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ recintoId }]);
      prisma.recinto.findUnique.mockResolvedValueOnce({ id: noCdaId, cdaDestinoId: recintoId });
      prisma.eventoTracking.findFirst.mockResolvedValueOnce(null);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'no-cda-id' }]);

      await service.registrarLlegadaNoCda(operadorId, { recintoId: noCdaId, ...offline } as any);

      expect(valoresInsert('eventos_tracking')).toContain(true);
    });

    it('salida del recinto: guarda desde_offline=true si llega desde la cola', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'tk-llegada' });
      storage.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ recintoId });
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'salida-recinto-id' }]);
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Ana', apellidos: 'Perez' });
      prisma.recinto.findUnique.mockResolvedValueOnce({ nombre: 'CDA 1' });

      await service.registrarSalidaRecinto(operadorId, {
        ...geo,
        actaInstalacionUrl: 'actas/instalacion.bin',
        actaEscrutinioUrl: 'actas/escrutinio.bin',
        ...offline,
      } as any);

      expect(valoresInsert('eventos_tracking')).toContain(true);
    });

    it('llegada al DPI: guarda desde_offline=true si llega desde la cola', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.eventoTracking.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'salida-recinto' });
      prisma.kitElectoral.findFirst.mockResolvedValueOnce({ recintoId });
      prisma.$queryRaw
        .mockResolvedValueOnce([]) // sin coordenada de Delegación: no bloquea
        .mockResolvedValueOnce([{ id: 'llegada-dpi-id' }]); // INSERT
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Ana', apellidos: 'López' });
      prisma.recinto.findUnique.mockResolvedValueOnce({ nombre: 'CDA 1' });

      await service.registrarLlegadaDpi(operadorId, { ...geo, ...offline } as any);

      expect(valoresInsert('eventos_tracking')).toContain(true);
    });

    it('llegada manual del supervisor: guarda desde_offline=false aunque el body traiga desdeOffline', async () => {
      prisma.eventoElectoral.findFirst.mockResolvedValueOnce(evento);
      prisma.recinto.findUnique.mockResolvedValueOnce({
        id: recintoId,
        tipo: 'CDA',
        esDificilAcceso: true,
        nombre: 'CDA 1',
      });
      prisma.kitElectoral.findMany.mockResolvedValueOnce([{ operadorId }]);
      prisma.eventoTracking.findFirst.mockResolvedValueOnce(null);
      prisma.$queryRaw.mockResolvedValueOnce([{ id: 'llegada-manual-id' }]);
      prisma.usuario.findUnique.mockResolvedValueOnce({ nombres: 'Ana', apellidos: 'López' });

      await service.registrarLlegadaRecintoManual('supervisor-id', ['ADMINISTRADOR'], {
        recintoId,
        ...offline,
      } as any);

      const valores = valoresInsert('eventos_tracking');
      expect(valores).toContain(false);
      expect(valores).not.toContain(true);
    });
  });
});
