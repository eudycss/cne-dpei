import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { MochilasKitService } from './mochilas-kit.service';
import type { PrismaService } from '../db/prisma.service';

const EVENTO = '22222222-2222-2222-2222-222222222222';
const KIT = '33333333-3333-3333-3333-333333333333';

function csv(texto: string): Express.Multer.File {
  return { originalname: 'mochilas.csv', mimetype: 'text/csv', buffer: Buffer.from(texto, 'utf8') } as Express.Multer.File;
}

const kit = (codigoUnico: string, codigoRecinto: string | null) => ({
  codigoUnico,
  recinto: codigoRecinto ? { codigoRecinto, nombre: `Recinto ${codigoRecinto}` } : null,
});

describe('MochilasKitService', () => {
  const prisma = {
    kitElectoral: { findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    eventoElectoral: { findUnique: jest.fn(), findMany: jest.fn() },
    mochilaKit: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn((args: unknown) => ({ op: 'upsert', args })),
      deleteMany: jest.fn((args: unknown) => ({ op: 'deleteMany', args })),
    },
    parejaCda: { findMany: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.resolve(ops)),
  };
  let service: MochilasKitService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((ops: unknown[]) => Promise.resolve(ops));
    prisma.eventoElectoral.findUnique.mockResolvedValue({ id: EVENTO, nombre: '2 Prueba Técnica' });
    service = new MochilasKitService(prisma as unknown as PrismaService);
  });

  describe('asignar (desde la tabla de kits)', () => {
    beforeEach(() => {
      prisma.kitElectoral.findUnique.mockResolvedValue({ codigoUnico: 'P2ZCERV4' });
      prisma.mochilaKit.findUnique.mockResolvedValue(null);
    });

    it('pone el número al código del QR del kit, con quién lo cambió', async () => {
      const r = await service.asignar(KIT, { numero: 54 }, 'u-admin');
      expect(r).toEqual({ codigoUnico: 'P2ZCERV4', numeroMochila: 54, numeroAnterior: null, quitadoDe: null });
      expect(prisma.mochilaKit.upsert).toHaveBeenCalledWith({
        where: { codigoUnico: 'P2ZCERV4' },
        create: { codigoUnico: 'P2ZCERV4', numero: 54, actualizadoPorId: 'u-admin' },
        update: { numero: 54, actualizadoPorId: 'u-admin' },
      });
    });

    it('con null quita el número y devuelve el que tenía', async () => {
      prisma.mochilaKit.findUnique.mockResolvedValueOnce({ numero: 54 });
      const r = await service.asignar(KIT, { numero: null });
      expect(r).toEqual({ codigoUnico: 'P2ZCERV4', numeroMochila: null, numeroAnterior: 54, quitadoDe: null });
      expect(prisma.mochilaKit.deleteMany).toHaveBeenCalledWith({ where: { codigoUnico: 'P2ZCERV4' } });
    });

    it('si el número es de otro QR avisa con el QR y su recinto, sin guardar', async () => {
      prisma.mochilaKit.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ codigoUnico: 'OTRO2345' });
      prisma.kitElectoral.findFirst.mockResolvedValue({ recinto: { codigoRecinto: '1487', nombre: 'UE Atahualpa' } });
      const error = await service.asignar(KIT, { numero: 23 }, 'u-admin', true).catch((e) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual(
        expect.objectContaining({
          codigo: 'MOCHILA_EN_OTRO_QR',
          message: 'La mochila N.º 23 ya está ligada al QR OTRO2345 (recinto 1487 · UE Atahualpa).',
        }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('con reemplazar se lo quita al otro QR y se lo da a este, en una sola transacción', async () => {
      prisma.mochilaKit.findUnique.mockResolvedValueOnce({ numero: 5 }).mockResolvedValueOnce({ codigoUnico: 'OTRO2345' });
      const r = await service.asignar(KIT, { numero: 23, reemplazar: true }, 'u-admin', true);
      expect(r).toEqual({ codigoUnico: 'P2ZCERV4', numeroMochila: 23, numeroAnterior: 5, quitadoDe: 'OTRO2345' });
      const [ops] = prisma.$transaction.mock.calls[0];
      expect(ops).toEqual([
        { op: 'deleteMany', args: { where: { codigoUnico: 'OTRO2345' } } },
        expect.objectContaining({ op: 'upsert' }),
      ]);
    });

    it('sin decir quién puede reemplazar, no reemplaza (lo seguro por defecto)', async () => {
      prisma.mochilaKit.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ codigoUnico: 'OTRO2345' });
      prisma.kitElectoral.findFirst.mockResolvedValue(null);
      await expect(service.asignar(KIT, { numero: 23, reemplazar: true })).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('el supervisor (sin poder reemplazar) recibe el aviso aunque pida reemplazar, y no se guarda', async () => {
      prisma.mochilaKit.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ codigoUnico: 'OTRO2345' });
      prisma.kitElectoral.findFirst.mockResolvedValue(null);
      const error = await service.asignar(KIT, { numero: 23, reemplazar: true }, 'u-sup', false).catch((e) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual(
        expect.objectContaining({
          puedeReemplazar: false,
          message: 'La mochila N.º 23 ya está ligada al QR OTRO2345. Revise el número de la mochila; si está bien, avise al administrador.',
        }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('el mismo número que ya tiene no cuenta como de otro QR', async () => {
      prisma.mochilaKit.findUnique.mockResolvedValueOnce({ numero: 54 }).mockResolvedValueOnce({ codigoUnico: 'P2ZCERV4' });
      const r = await service.asignar(KIT, { numero: 54 });
      expect(r.quitadoDe).toBeNull();
    });

    it('si otro guardó el mismo número a la vez (índice único) lo dice', async () => {
      prisma.$transaction.mockRejectedValueOnce({ code: 'P2002' });
      await expect(service.asignar(KIT, { numero: 54 })).rejects.toThrow('Otra persona acaba de cambiar');
    });

    it('rechaza un kit que no existe y números fuera de 1 a 9999', async () => {
      prisma.kitElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.asignar(KIT, { numero: 54 })).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.asignar(KIT, { numero: 0 })).rejects.toThrow();
      await expect(service.asignar(KIT, { numero: 10000 })).rejects.toThrow();
    });
  });

  describe('porQr (escanear la mochila)', () => {
    const kitDe = (evento: string, estado: string) => ({
      id: `kit-${evento}`,
      codigoUnico: 'P2ZCERV4',
      nombre: 'Kit Recinto 1440',
      eventoId: `ev-${evento}`,
      recinto: { codigoRecinto: '1440', nombre: 'UE Atahualpa' },
      estadoEvento: estado,
    });
    const conEventos = (kits: ReturnType<typeof kitDe>[]) => {
      prisma.kitElectoral.findMany.mockResolvedValue(kits);
      prisma.eventoElectoral.findMany.mockResolvedValue(
        kits.map((k) => ({ id: k.eventoId, nombre: k.eventoId.slice(3), estado: k.estadoEvento })),
      );
    };

    it('lee el código en minúsculas o con espacios, prefiere el kit del evento activo y trae el número', async () => {
      conEventos([kitDe('Viejo', 'CERRADO'), kitDe('2 Prueba', 'ACTIVO')]);
      prisma.mochilaKit.findUnique.mockResolvedValue({ numero: 54 });
      const r = await service.porQr('  p2zcerv4 ');
      expect(prisma.kitElectoral.findMany.mock.calls[0][0].where).toEqual({ OR: [{ codigoUnico: 'P2ZCERV4' }, { qrPayload: 'P2ZCERV4' }] });
      expect(r).toEqual({
        kitId: 'kit-2 Prueba',
        codigoUnico: 'P2ZCERV4',
        numeroMochila: 54,
        nombreKit: 'Kit Recinto 1440',
        evento: '2 Prueba',
        recinto: { codigoRecinto: '1440', nombre: 'UE Atahualpa' },
      });
    });

    it('sin evento activo usa el kit más reciente; sin número da null', async () => {
      conEventos([kitDe('Reciente', 'CERRADO'), kitDe('Viejo', 'CERRADO')]);
      prisma.mochilaKit.findUnique.mockResolvedValue(null);
      expect(await service.porQr('P2ZCERV4')).toEqual(expect.objectContaining({ kitId: 'kit-Reciente', numeroMochila: null }));
    });

    it('un QR que no es de un kit: 400 si no parece un código, 404 si no existe', async () => {
      await expect(service.porQr('https://otra-cosa.com/x')).rejects.toBeInstanceOf(BadRequestException);
      prisma.kitElectoral.findMany.mockResolvedValue([]);
      await expect(service.porQr('ZZZZ9999')).rejects.toThrow('El QR ZZZZ9999 no es de ningún kit registrado');
    });
  });

  describe('cargar (Excel/CSV)', () => {
    beforeEach(() => {
      prisma.kitElectoral.findMany.mockResolvedValue([
        kit('AAAA2222', '1440'),
        kit('BBBB3333', '1487'),
        // Recinto con dos kits.
        kit('CCCC4444', '971'),
        kit('DDDD5555', '971'),
        kit('EEEE6666', '1290'),
      ]);
      // EEEE6666 ya tenía el 17; el 99 es de un QR de otro recinto.
      prisma.mochilaKit.findMany.mockResolvedValue([
        { codigoUnico: 'EEEE6666', numero: 17 },
        { codigoUnico: 'ZZZZ9999', numero: 99 },
      ]);
    });

    it('vista previa: nuevas, cambios, iguales y cada error con su motivo, sin guardar', async () => {
      const archivo = csv(
        [
          'Recinto,Código QR,N.º mochila',
          '1440,,54', // 2 NUEVA por recinto
          ',bbbb3333,23', // 3 NUEVA por QR (minúsculas)
          '971,,62', // 4 dos kits
          '971,DDDD5555,61', // 5 NUEVA con QR del recinto
          '1290,,18', // 6 CAMBIA (antes 17)
          '1500,,40', // 7 recinto sin kit
          ',XXXX0000,41', // 8 QR de otro evento
          '1440,BBBB3333,42', // 9 QR de otro recinto
          '1487,,abc', // 10 número inválido
          '1487,,', // 11 falta número
          ',,43', // 12 falta recinto/QR
          ',CCCC4444,54', // 13 número repetido en el archivo
          ',CCCC4444,99', // 14 número de otro QR
        ].join('\n'),
      );
      const r = await service.cargar(archivo, EVENTO, false);
      expect(r.aplicada).toBe(false);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(r.filas.map((f) => [f.fila, f.estado, f.codigoUnico, f.numero, f.mensaje])).toEqual([
        [2, 'NUEVA', 'AAAA2222', 54, null],
        [3, 'NUEVA', 'BBBB3333', 23, null],
        [4, 'ERROR', null, 62, 'El recinto 971 tiene 2 kits (CCCC4444, DDDD5555): escriba el Código QR'],
        [5, 'NUEVA', 'DDDD5555', 61, null],
        [6, 'CAMBIA', 'EEEE6666', 18, 'Antes era el N.º 17'],
        [7, 'ERROR', null, 40, 'El recinto 1500 no tiene kit en este evento'],
        [8, 'ERROR', 'XXXX0000', 41, 'El código QR XXXX0000 no es de un kit de este evento'],
        [9, 'ERROR', 'BBBB3333', 42, 'El QR BBBB3333 es del recinto 1487, no del 1440'],
        [10, 'ERROR', null, null, '"abc" no es un N.º de mochila (de 1 a 9999)'],
        [11, 'ERROR', null, null, 'Falta el N.º de mochila'],
        [12, 'ERROR', null, 43, 'Falta el Recinto o el Código QR'],
        [13, 'ERROR', 'CCCC4444', 54, 'El N.º 54 ya está en la fila 2 del archivo'],
        [14, 'ERROR', 'CCCC4444', 99, 'La mochila N.º 99 ya está ligada al QR ZZZZ9999: cámbiela primero en la tabla de kits'],
      ]);
      expect(r.filas[0].nombreRecinto).toBe('Recinto 1440');
      expect(r.guardadas).toBe(4);
      expect(r.errores).toBe(9);
    });

    it('el mismo número que ya tenía queda IGUAL y no se vuelve a guardar; el mismo kit dos veces es error', async () => {
      const r = await service.cargar(csv('Recinto,N.º mochila\n1290,17\n1290,20\n'), EVENTO, true);
      expect(r.filas.map((f) => [f.estado, f.mensaje])).toEqual([
        ['IGUAL', 'Ya tenía ese número'],
        ['ERROR', 'Este kit ya está en la fila 2 del archivo'],
      ]);
      expect(r).toEqual(expect.objectContaining({ aplicada: false, guardadas: 0 }));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('al aplicar guarda solo las filas válidas, en una transacción', async () => {
      const r = await service.cargar(csv('Recinto,N.º mochila\n1440,54\n1500,40\n1290,18\n'), EVENTO, true, 'u-admin');
      expect(r).toEqual(expect.objectContaining({ aplicada: true, guardadas: 2, errores: 1 }));
      const [ops] = prisma.$transaction.mock.calls[0];
      expect(ops).toEqual([
        {
          op: 'upsert',
          args: {
            where: { codigoUnico: 'AAAA2222' },
            create: { codigoUnico: 'AAAA2222', numero: 54, actualizadoPorId: 'u-admin' },
            update: { numero: 54, actualizadoPorId: 'u-admin' },
          },
        },
        expect.objectContaining({ args: expect.objectContaining({ where: { codigoUnico: 'EEEE6666' } }) }),
      ]);
    });

    it('acepta otros encabezados ("Codigo recinto", "Mochila") y números como "N.º 45" o "045"', async () => {
      const r = await service.cargar(csv('Codigo recinto,Mochila\n1440,N.º 45\n1487,045\n'), EVENTO, false);
      expect(r.filas.map((f) => f.numero)).toEqual([45, 45]);
      expect(r.filas[1]).toEqual(expect.objectContaining({ estado: 'ERROR', mensaje: 'El N.º 45 ya está en la fila 2 del archivo' }));
    });

    it('lee la propia plantilla Excel (las filas de ejemplo)', async () => {
      prisma.kitElectoral.findMany.mockResolvedValue([kit('AAAA2222', '1440'), kit('P2ZCERV4', '1487')]);
      prisma.mochilaKit.findMany.mockResolvedValue([]);
      const plantilla = await service.plantilla();
      const archivo = { originalname: 'plantilla.xlsx', mimetype: 'application/octet-stream', buffer: plantilla } as Express.Multer.File;
      const r = await service.cargar(archivo, EVENTO, false);
      expect(r.filas.map((f) => [f.codigoUnico, f.numero, f.estado])).toEqual([
        ['AAAA2222', 54, 'NUEVA'],
        ['P2ZCERV4', 23, 'NUEVA'],
      ]);
    });

    it('rechaza sin archivo, sin filas, con demasiadas filas o con un evento que no existe', async () => {
      await expect(service.cargar(undefined, EVENTO, false)).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.cargar(csv('Recinto,N.º mochila\n'), EVENTO, false)).rejects.toThrow('El archivo no tiene filas');
      const muchas = ['Recinto,N.º mochila', ...Array.from({ length: 2001 }, (_, i) => `1440,${i + 1}`)].join('\n');
      await expect(service.cargar(csv(muchas), EVENTO, false)).rejects.toThrow('el máximo es 2000');
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.cargar(csv('Recinto,N.º mochila\n1440,1\n'), EVENTO, false)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('un archivo que no es .xlsx/.csv o que está dañado es un 400 claro', async () => {
      const xls = { originalname: 'viejo.xls', mimetype: 'application/vnd.ms-excel', buffer: Buffer.from('x') } as Express.Multer.File;
      await expect(service.cargar(xls, EVENTO, false)).rejects.toThrow('Use la plantilla en Excel (.xlsx) o un archivo .csv');
      const danado = { originalname: 'm.xlsx', mimetype: 'application/octet-stream', buffer: Buffer.from('no es un zip') } as Express.Multer.File;
      await expect(service.cargar(danado, EVENTO, false)).rejects.toThrow('No se pudo leer el archivo');
    });

    it('el recinto escrito con o sin ceros a la izquierda es el mismo', async () => {
      prisma.kitElectoral.findMany.mockResolvedValue([kit('AAAA2222', '0971'), kit('BBBB3333', '1440')]);
      const r = await service.cargar(csv('Recinto,N.º mochila\n971,62\n01440,54\n'), EVENTO, false);
      expect(r.filas.map((f) => [f.codigoUnico, f.estado])).toEqual([
        ['AAAA2222', 'NUEVA'],
        ['BBBB3333', 'NUEVA'],
      ]);
    });

    it('si otro cambió mochilas a la vez (índice único) pide revisar de nuevo', async () => {
      prisma.$transaction.mockRejectedValueOnce({ code: 'P2002' });
      await expect(service.cargar(csv('Recinto,N.º mochila\n1440,54\n'), EVENTO, true)).rejects.toThrow('Vuelva a revisar el archivo');
    });
  });

  describe('reporte', () => {
    it('una fila por kit con mochila, QR, recinto y pareja; los que no tienen número primero', async () => {
      prisma.kitElectoral.findMany.mockResolvedValue([
        {
          id: 'k1',
          codigoUnico: 'AAAA2222',
          estado: 'ASIGNADO',
          recinto: { codigoRecinto: '1440', nombre: 'UE Atahualpa', canton: { nombre: 'IBARRA' } },
          operador: { nombres: 'Ana', apellidos: 'Pérez' },
        },
        { id: 'k2', codigoUnico: 'BBBB3333', estado: 'EN_BODEGA', recinto: null, operador: null },
        {
          id: 'k3',
          codigoUnico: 'CCCC4444',
          estado: 'ASIGNADO',
          recinto: { codigoRecinto: '971', nombre: 'UE Chaltura', canton: { nombre: 'ANTONIO ANTE' } },
          operador: null,
        },
      ]);
      prisma.mochilaKit.findMany.mockResolvedValue([
        { codigoUnico: 'AAAA2222', numero: 54 },
        { codigoUnico: 'CCCC4444', numero: 6 },
      ]);
      prisma.parejaCda.findMany.mockResolvedValue([
        { kitId: 'k3', operador: { apellidosNombres: 'MEDIAVILLA MONICA' }, asistente: { apellidosNombres: 'ORDONEZ GUADALUPE' } },
        // Una pareja más vieja del mismo kit: no se usa.
        { kitId: 'k3', operador: { apellidosNombres: 'VIEJA' }, asistente: null },
      ]);

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await service.reporte(EVENTO)) as any);
      const filas = wb.getWorksheet('Mochilas')!.getSheetValues().slice(2).map((r) => (r as unknown[]).slice(1));
      expect(filas).toEqual([
        ['SIN NÚMERO', 'BBBB3333', '', 'Sin recinto', '', '', '', 'EN_BODEGA'],
        [6, 'CCCC4444', '971', 'UE Chaltura', 'ANTONIO ANTE', 'MEDIAVILLA MONICA', 'ORDONEZ GUADALUPE', 'ASIGNADO'],
        [54, 'AAAA2222', '1440', 'UE Atahualpa', 'IBARRA', 'Pérez Ana', '', 'ASIGNADO'],
      ]);
      const resumen = wb.getWorksheet('Resumen')!.getSheetValues().slice(1).map((r) => (r as unknown[]).slice(1));
      expect(resumen).toEqual([
        ['Evento', '2 Prueba Técnica'],
        ['Kits', 3],
        ['Con N.º de mochila', 2],
        ['Sin N.º de mochila', 1],
      ]);
    });

    it('un evento que no existe da 404', async () => {
      prisma.eventoElectoral.findUnique.mockResolvedValueOnce(null);
      await expect(service.reporte(EVENTO)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
