import { BadRequestException, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ABIERTA_EN_OTRO_EQUIPO, hashTokenSimulador, SimuladorPublicoService } from './simulador-publico.service';
import type { PrismaService } from '../db/prisma.service';

const AHORA = new Date('2026-11-10T14:00:00Z');
const minutos = (m: number) => new Date(AHORA.getTime() + m * 60_000);
const PRACTICA_ID = '11111111-1111-4111-8111-111111111111';
const CEDULA = '1710034065';

const PERSONA = {
  id: 'op-1',
  grupo: 'DIGITADOR',
  activo: true,
  apellidosNombres: 'CADENA HERRERA JHOSTYN GERARDO',
  cargoCda: { nombre: 'Digitadores' },
};

const practica = (o: Record<string, unknown> = {}) => ({
  id: PRACTICA_ID,
  nombre: 'Práctica 1',
  filasPorActa: 3,
  votoMin: 0,
  votoMax: 350,
  metaActas: 200,
  plazoMinutos: 60,
  inicio: minutos(-60),
  fin: minutos(60),
  pctDigitosDistintos: 0,
  intentosMax: 2,
  activa: true,
  cargos: [{ cargo: 'DIGITADOR' }],
  personas: [] as { operadorId: string; incluida: boolean }[],
  ...o,
});

const intento = (o: Record<string, unknown> = {}) => ({
  id: 'int-1',
  practicaId: PRACTICA_ID,
  operadorId: PERSONA.id,
  numero: 1,
  cargo: 'Digitadores',
  tokenHash: 'h',
  iniciadoEn: AHORA,
  venceEn: minutos(60),
  terminadoEn: null as Date | null,
  ultimaActividadEn: minutos(-10),
  actasCompletadas: 0,
  actasPerfectas: 0,
  filasFallidas: 0,
  filasDigitadas: 0,
  filasCorrectas: 0,
  practica: practica(),
  operador: { apellidosNombres: PERSONA.apellidosNombres },
  ...o,
});

const acta = (o: Record<string, unknown> = {}) => ({
  id: '22222222-2222-4222-8222-222222222222',
  intentoId: 'int-1',
  numero: 1,
  valores: [62, 0, 50],
  digitos: [62, 0, 50],
  primerGuardado: [] as number[],
  borrador: [] as number[],
  filasFallidas: null as number | null,
  guardados: 0,
  entregadaEn: AHORA,
  completadaEn: null as Date | null,
  ...o,
});

const errorPrisma = (code: string) => new Prisma.PrismaClientKnownRequestError(code, { code, clientVersion: 'x' });
const TOKEN = 'a'.repeat(43);

describe('SimuladorPublicoService', () => {
  const prisma = {
    operadorCda: { findUnique: jest.fn() },
    practicaDigitacion: { findUnique: jest.fn(), findMany: jest.fn() },
    intentoDigitacion: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn(), create: jest.fn(), count: jest.fn() },
    actaDigitacion: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };
  let service: SimuladorPublicoService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: (tx: typeof prisma) => unknown) => fn(prisma));
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.operadorCda.findUnique.mockResolvedValue(PERSONA);
    service = new SimuladorPublicoService(prisma as unknown as PrismaService);
    service.ahora = () => AHORA;
  });

  describe('ingresar', () => {
    it('misma respuesta si la cédula no existe o la persona está inactiva', async () => {
      prisma.operadorCda.findUnique.mockResolvedValueOnce(null);
      await expect(service.ingresar(CEDULA)).rejects.toThrow('No hay prácticas disponibles para esta cédula');
      prisma.operadorCda.findUnique.mockResolvedValueOnce({ ...PERSONA, activo: false });
      await expect(service.ingresar(CEDULA)).rejects.toThrow('No hay prácticas disponibles para esta cédula');
      expect(prisma.practicaDigitacion.findMany).not.toHaveBeenCalled();
    });

    it('nombre enmascarado y solo las prácticas que le aplican y están abiertas', async () => {
      prisma.practicaDigitacion.findMany.mockResolvedValue([
        { ...practica(), intentos: [{ terminadoEn: minutos(-30), venceEn: minutos(-30) }] },
        { ...practica({ id: 'quitado', personas: [{ operadorId: 'op-1', incluida: false }] }), intentos: [] },
        { ...practica({ id: 'cerrada', fin: minutos(-1) }), intentos: [] },
        { ...practica({ id: 'retomable', fin: minutos(-1) }), intentos: [{ terminadoEn: null, venceEn: minutos(10) }] },
      ]);
      const r = await service.ingresar(CEDULA);
      expect(r.nombre).toBe('C. H. J. G.');
      expect(r.cargo).toBe('Digitadores');
      expect(r.practicas.map((p) => [p.id, p.intentosUsados, p.enCurso])).toEqual([
        [PRACTICA_ID, 1, false],
        ['retomable', 1, true],
      ]);
    });

    it('más de 10 ingresos por minuto con la misma cédula: 429', async () => {
      prisma.practicaDigitacion.findMany.mockResolvedValue([{ ...practica(), intentos: [] }]);
      for (let i = 0; i < 10; i++) await service.ingresar(CEDULA);
      await expect(service.ingresar(CEDULA)).rejects.toMatchObject({ status: 429 });
    });

    it('sin prácticas: 404 con el mismo mensaje', async () => {
      prisma.practicaDigitacion.findMany.mockResolvedValue([]);
      await expect(service.ingresar(CEDULA)).rejects.toThrow(NotFoundException);
    });
  });

  describe('iniciar', () => {
    beforeEach(() => {
      prisma.practicaDigitacion.findUnique.mockResolvedValue(practica());
      prisma.intentoDigitacion.findFirst.mockResolvedValue(null);
      prisma.intentoDigitacion.count.mockResolvedValue(0);
      prisma.intentoDigitacion.create.mockImplementation(({ data }) => Promise.resolve({ ...intento(), ...data }));
    });

    it('crea el intento 1 con el plazo desde ahora y guarda solo el hash del token', async () => {
      const r = await service.iniciar(CEDULA, PRACTICA_ID);
      const data = prisma.intentoDigitacion.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ numero: 1, cargo: 'Digitadores', iniciadoEn: AHORA, venceEn: minutos(60), operadorId: 'op-1' });
      expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(data.tokenHash).toBe(hashTokenSimulador(r.token));
      expect(r.estado).toMatchObject({ terminado: false, numeroIntento: 1, nombre: 'C. H. J. G.' });
      expect(r).toMatchObject({ operadorId: 'op-1', retomado: false });
      expect(data.ultimaActividadEn).toEqual(AHORA);
    });

    it('retoma el intento en curso con un token nuevo (no gasta otro intento)', async () => {
      prisma.intentoDigitacion.findFirst.mockResolvedValue(intento());
      prisma.intentoDigitacion.update.mockImplementation(({ data }) => Promise.resolve({ ...intento(), ...data }));
      const r = await service.iniciar(CEDULA, PRACTICA_ID);
      expect(prisma.intentoDigitacion.create).not.toHaveBeenCalled();
      expect(prisma.intentoDigitacion.update).toHaveBeenCalledWith({
        where: { id: 'int-1' },
        data: { tokenHash: hashTokenSimulador(r.token), ultimaActividadEn: AHORA },
      });
      expect(r.retomado).toBe(true);
    });

    it('no se retoma mientras la sesión se esté usando en otro equipo (menos de 2 min)', async () => {
      prisma.intentoDigitacion.findFirst.mockResolvedValue(intento({ ultimaActividadEn: minutos(-1) }));
      await expect(service.iniciar(CEDULA, PRACTICA_ID)).rejects.toThrow(ABIERTA_EN_OTRO_EQUIPO);
      expect(prisma.intentoDigitacion.update).not.toHaveBeenCalled();
    });

    it('más de 5 inicios por minuto con la misma cédula: 429 (aunque cambie de IP)', async () => {
      for (let i = 0; i < 5; i++) await service.iniciar(CEDULA, PRACTICA_ID);
      await expect(service.iniciar(CEDULA, PRACTICA_ID)).rejects.toMatchObject({ status: 429 });
      await expect(service.iniciar('1713175071', PRACTICA_ID)).resolves.toBeDefined();
    });

    it('intentos agotados: 409', async () => {
      prisma.intentoDigitacion.count.mockResolvedValue(2);
      await expect(service.iniciar(CEDULA, PRACTICA_ID)).rejects.toThrow('Ya usó sus 2 intento(s)');
    });

    it.each([
      ['antes de la ventana', { inicio: minutos(5) }],
      ['después de la ventana', { fin: minutos(-5) }],
    ])('%s: 409', async (_c, o) => {
      prisma.practicaDigitacion.findUnique.mockResolvedValue(practica(o));
      await expect(service.iniciar(CEDULA, PRACTICA_ID)).rejects.toThrow(ConflictException);
    });

    it.each([
      ['no existe', null],
      ['desactivada', practica({ activa: false })],
      ['no le aplica', practica({ cargos: [{ cargo: 'OPERADOR' }] })],
    ])('práctica %s: 404', async (_c, p) => {
      prisma.practicaDigitacion.findUnique.mockResolvedValue(p);
      await expect(service.iniciar(CEDULA, PRACTICA_ID)).rejects.toThrow(NotFoundException);
    });

    it('dos clics a la vez: el segundo recibe 409, no 500', async () => {
      prisma.intentoDigitacion.create.mockRejectedValue(errorPrisma('P2002'));
      await expect(service.iniciar(CEDULA, PRACTICA_ID)).rejects.toThrow(ConflictException);
    });

    it('antes de contar intentos cierra los vencidos', async () => {
      await service.iniciar(CEDULA, PRACTICA_ID);
      expect(prisma.$executeRaw).toHaveBeenCalled();
    });
  });

  describe('token', () => {
    it('token desconocido: 401', async () => {
      prisma.intentoDigitacion.findUnique.mockResolvedValue(null);
      await expect(service.estado(TOKEN)).rejects.toThrow(UnauthorizedException);
    });

    it('busca por el hash, nunca por el token, y marca la sesión como en uso', async () => {
      prisma.intentoDigitacion.findUnique.mockResolvedValue(intento());
      await service.estado(TOKEN);
      expect(prisma.intentoDigitacion.findUnique.mock.calls[0][0].where).toEqual({ tokenHash: hashTokenSimulador(TOKEN) });
      expect(prisma.intentoDigitacion.updateMany).toHaveBeenCalledWith({ where: { id: 'int-1' }, data: { ultimaActividadEn: AHORA } });
    });

    it('si el plazo pasó, el estado sale terminado y queda cerrado a la hora de vencimiento', async () => {
      prisma.intentoDigitacion.findUnique.mockResolvedValue(intento({ venceEn: minutos(-1), filasDigitadas: 16, filasCorrectas: 15 }));
      // Acta a medias: su borrador suma 2 registros (1 correcto).
      prisma.actaDigitacion.findFirst.mockResolvedValue({ valores: [62, 0, 50], borrador: [62, 9, -1] });
      const e = await service.estado(TOKEN);
      expect(e).toMatchObject({ terminado: true, motivo: 'TIEMPO', filasDigitadas: 18, filasCorrectas: 16 });
      expect(prisma.actaDigitacion.findFirst.mock.calls[0][0].where).toEqual({ intentoId: 'int-1', guardados: 0, completadaEn: null });
      expect(prisma.intentoDigitacion.updateMany).toHaveBeenCalledWith({ where: { id: 'int-1', terminadoEn: null }, data: { terminadoEn: minutos(-1) } });
    });
  });

  describe('nuevaActa', () => {
    beforeEach(() => prisma.intentoDigitacion.findUnique.mockResolvedValue(intento()));

    it('devuelve la pendiente: no se puede saltar un acta', async () => {
      prisma.actaDigitacion.findFirst.mockResolvedValueOnce(acta({ digitos: [62, 0, 51] }));
      const r = await service.nuevaActa(TOKEN);
      expect(r.acta).toEqual({
        id: acta().id,
        numero: 1,
        filas: [
          { letras: 'Sesenta y dos', digitos: '062' },
          { letras: 'Cero', digitos: '000' },
          { letras: 'Cincuenta', digitos: '051' },
        ],
      });
      expect(prisma.actaDigitacion.create).not.toHaveBeenCalled();
    });

    it('sin pendiente, genera la siguiente con el número que sigue', async () => {
      prisma.actaDigitacion.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ numero: 7 });
      prisma.actaDigitacion.create.mockImplementation(({ data }) => Promise.resolve({ id: 'nueva', ...data }));
      service.azar = (min) => min;
      const r = await service.nuevaActa(TOKEN);
      expect(prisma.actaDigitacion.create.mock.calls[0][0].data).toMatchObject({ numero: 8, valores: [0, 0, 0], digitos: [0, 0, 0], intentoId: 'int-1' });
      expect(r.acta?.filas).toHaveLength(3);
    });

    it('intento terminado: sin acta', async () => {
      prisma.intentoDigitacion.findUnique.mockResolvedValue(intento({ actasCompletadas: 200 }));
      const r = await service.nuevaActa(TOKEN);
      expect(r).toMatchObject({ acta: null, estado: { terminado: true, motivo: 'META' } });
    });

    it('otra pestaña la creó a la vez: devuelve esa', async () => {
      prisma.actaDigitacion.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ numero: 1 })
        .mockResolvedValueOnce(acta({ numero: 2 }));
      prisma.actaDigitacion.create.mockRejectedValue(errorPrisma('P2002'));
      const r = await service.nuevaActa(TOKEN);
      expect(r.acta?.numero).toBe(2);
    });
  });

  describe('guardar', () => {
    const ACTA_ID = acta().id;
    beforeEach(() => {
      prisma.intentoDigitacion.findUnique.mockResolvedValue(intento());
      prisma.actaDigitacion.findFirst.mockResolvedValue(acta());
      prisma.actaDigitacion.updateMany.mockResolvedValue({ count: 1 });
      prisma.intentoDigitacion.update.mockImplementation(() => Promise.resolve(intento({ actasCompletadas: 1, actasPerfectas: 1 })));
    });

    it('todo bien al primer guardado: acta cerrada y perfecta', async () => {
      const r = await service.guardar(TOKEN, ACTA_ID, [62, 0, 50]);
      expect(r).toMatchObject({ guardada: true, filasIncorrectas: [], aviso: null });
      expect(prisma.actaDigitacion.updateMany.mock.calls[0][0]).toEqual({
        where: { id: ACTA_ID, guardados: 0, completadaEn: null },
        data: { guardados: { increment: 1 }, primerGuardado: [62, 0, 50], filasFallidas: 0, completadaEn: AHORA },
      });
      expect(prisma.intentoDigitacion.update.mock.calls[0][0].data).toEqual({
        ultimaActividadEn: AHORA,
        filasFallidas: { increment: 0 },
        filasDigitadas: { increment: 3 },
        filasCorrectas: { increment: 3 },
        actasCompletadas: { increment: 1 },
        actasPerfectas: { increment: 1 },
      });
    });

    it('con errores: dice qué filas corregir y guarda el primer intento (vacías como -1)', async () => {
      prisma.intentoDigitacion.update.mockResolvedValue(intento({ filasFallidas: 2 }));
      const r = await service.guardar(TOKEN, ACTA_ID, [62, null, 51]);
      expect(r).toMatchObject({ guardada: false, filasIncorrectas: [1, 2] });
      expect(prisma.actaDigitacion.updateMany.mock.calls[0][0].data).toEqual({
        guardados: { increment: 1 },
        primerGuardado: [62, -1, 51],
        filasFallidas: 2,
      });
      // Registros: 2 digitadas (la vacía no cuenta), 1 correcta.
      expect(prisma.intentoDigitacion.update.mock.calls[0][0].data).toEqual({
        ultimaActividadEn: AHORA,
        filasFallidas: { increment: 2 },
        filasDigitadas: { increment: 2 },
        filasCorrectas: { increment: 1 },
      });
    });

    it('al corregir se cierra, pero ya no cuenta como perfecta ni suma fallos otra vez', async () => {
      prisma.actaDigitacion.findFirst.mockResolvedValue(acta({ guardados: 1, filasFallidas: 2, primerGuardado: [62, -1, 51] }));
      await service.guardar(TOKEN, ACTA_ID, [62, 0, 50]);
      expect(prisma.actaDigitacion.updateMany.mock.calls[0][0].data).toEqual({ guardados: { increment: 1 }, completadaEn: AHORA });
      expect(prisma.intentoDigitacion.update.mock.calls[0][0].data).toEqual({ ultimaActividadEn: AHORA, actasCompletadas: { increment: 1 } });
    });

    it('el acta que cumple la meta cierra el intento (con el conteo real, no el leído antes)', async () => {
      prisma.intentoDigitacion.update.mockResolvedValue(intento({ actasCompletadas: 200 }));
      prisma.actaDigitacion.findMany.mockResolvedValue([]);
      const r = await service.guardar(TOKEN, ACTA_ID, [62, 0, 50]);
      expect(prisma.intentoDigitacion.updateMany).toHaveBeenCalledWith({ where: { id: 'int-1', terminadoEn: null }, data: { terminadoEn: AHORA } });
      expect(r.estado).toMatchObject({ terminado: true, motivo: 'META' });
    });

    it('sin llegar a la meta no cierra', async () => {
      await service.guardar(TOKEN, ACTA_ID, [62, 0, 50]);
      expect(prisma.intentoDigitacion.updateMany).not.toHaveBeenCalled();
    });

    it('cada 20 actas avisa cuántas de las últimas 20 salieron perfectas', async () => {
      prisma.intentoDigitacion.update.mockResolvedValue(intento({ actasCompletadas: 20 }));
      prisma.actaDigitacion.findMany.mockResolvedValue([
        ...Array.from({ length: 18 }, () => ({ filasFallidas: 0 })),
        { filasFallidas: 1 },
        { filasFallidas: 3 },
      ]);
      const r = await service.guardar(TOKEN, ACTA_ID, [62, 0, 50]);
      expect(r.aviso).toEqual({ perfectas: 18, de: 20 });
      expect(prisma.actaDigitacion.findMany.mock.calls[0][0]).toMatchObject({ take: 20, orderBy: { numero: 'desc' } });
    });

    it('otra pestaña guardó en medio: 409 y no se cuenta en el intento', async () => {
      prisma.actaDigitacion.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.guardar(TOKEN, ACTA_ID, [62, 0, 50])).rejects.toThrow(ConflictException);
      expect(prisma.intentoDigitacion.update).not.toHaveBeenCalled();
    });

    it('acta ya cerrada: 409', async () => {
      prisma.actaDigitacion.findFirst.mockResolvedValue(acta({ completadaEn: AHORA }));
      await expect(service.guardar(TOKEN, ACTA_ID, [62, 0, 50])).rejects.toThrow(ConflictException);
    });

    it('acta de otro intento: 404 (se busca dentro del intento del token)', async () => {
      prisma.actaDigitacion.findFirst.mockResolvedValue(null);
      await expect(service.guardar(TOKEN, ACTA_ID, [62, 0, 50])).rejects.toThrow(NotFoundException);
      expect(prisma.actaDigitacion.findFirst.mock.calls[0][0].where).toEqual({ id: ACTA_ID, intentoId: 'int-1' });
    });

    it('cantidad de filas distinta: 400', async () => {
      await expect(service.guardar(TOKEN, ACTA_ID, [62, 0])).rejects.toThrow(BadRequestException);
    });

    it('tiempo vencido: 409 y no califica', async () => {
      prisma.intentoDigitacion.findUnique.mockResolvedValue(intento({ venceEn: minutos(-1) }));
      await expect(service.guardar(TOKEN, ACTA_ID, [62, 0, 50])).rejects.toThrow('La práctica ya terminó');
      expect(prisma.actaDigitacion.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('borrador', () => {
    const ACTA_ID = acta().id;
    beforeEach(() => {
      prisma.intentoDigitacion.findUnique.mockResolvedValue(intento());
      prisma.actaDigitacion.findFirst.mockResolvedValue({ valores: [62, 0, 50] });
      prisma.actaDigitacion.updateMany.mockResolvedValue({ count: 1 });
    });

    it('guarda lo escrito (vacías como -1) solo si el acta no se guardó aún', async () => {
      await expect(service.borrador(TOKEN, ACTA_ID, [62, null, 5])).resolves.toEqual({ guardado: true });
      expect(prisma.actaDigitacion.updateMany).toHaveBeenCalledWith({
        where: { id: ACTA_ID, guardados: 0, completadaEn: null },
        data: { borrador: [62, -1, 5], borradorEn: AHORA },
      });
    });

    it('un acta ya guardada no cambia (cuenta su primer guardado)', async () => {
      prisma.actaDigitacion.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.borrador(TOKEN, ACTA_ID, [62, 0, 50])).resolves.toEqual({ guardado: false });
    });

    it('se acepta hasta 30 s después del fin del tiempo, no más', async () => {
      prisma.intentoDigitacion.findUnique.mockResolvedValue(intento({ venceEn: new Date(AHORA.getTime() - 20_000) }));
      await expect(service.borrador(TOKEN, ACTA_ID, [62, 0, 50])).resolves.toEqual({ guardado: true });
      prisma.intentoDigitacion.findUnique.mockResolvedValue(intento({ venceEn: new Date(AHORA.getTime() - 31_000) }));
      prisma.actaDigitacion.updateMany.mockClear();
      await expect(service.borrador(TOKEN, ACTA_ID, [62, 0, 50])).resolves.toEqual({ guardado: false });
      expect(prisma.actaDigitacion.updateMany).not.toHaveBeenCalled();
    });

    it('terminada por meta: no se acepta', async () => {
      prisma.intentoDigitacion.findUnique.mockResolvedValue(intento({ actasCompletadas: 200 }));
      await expect(service.borrador(TOKEN, ACTA_ID, [62, 0, 50])).resolves.toEqual({ guardado: false });
    });

    it('acta de otro intento: 404; filas distintas: 400', async () => {
      prisma.actaDigitacion.findFirst.mockResolvedValueOnce(null);
      await expect(service.borrador(TOKEN, ACTA_ID, [1, 2, 3])).rejects.toThrow(NotFoundException);
      await expect(service.borrador(TOKEN, ACTA_ID, [1])).rejects.toThrow(BadRequestException);
    });
  });
});
