import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import PizZip from 'pizzip';
import type { GenerarActasCdaRequest } from '@cne/shared-types';

import { ActasCdaService } from './actas-cda.service';
import { PrismaService } from '../db/prisma.service';

const OP = '11111111-2222-4333-8444-555555555555';
const OP2 = '22222222-2222-4333-8444-555555555555';
const USR = '99999999-2222-4333-8444-555555555555';
const ENTREGA = '88888888-2222-4333-8444-555555555555';

const operador = (over: Record<string, unknown> = {}) => ({
  id: OP,
  numero: 1,
  apellidosNombres: 'PÉREZ LÓPEZ ANA MARÍA',
  cedula: '1710034065',
  telefono: '0987923273',
  cargo: 'OPERADOR CDA',
  unidad: null,
  fechaInicio: null,
  fotoKey: null,
  activo: true,
  creadoEn: new Date('2026-10-20T10:00:00Z'),
  ...over,
});

const acta = (over: Record<string, unknown> = {}) => ({
  id: 'acta-1',
  operadorId: OP,
  entregaPorId: ENTREGA,
  entregaNombre: 'William Paspuel',
  entregaCedula: '1001001005',
  entregaCargo: 'Analista Provincial',
  lugar: 'Ibarra',
  fecha: new Date('2026-10-22T00:00:00Z'),
  estadoPeto: 'BUENO',
  estadoCredencial: 'NUEVO',
  estadoCordon: 'BUENO',
  estado: 'GENERADA',
  firmadaEn: null,
  creadoPorId: USR,
  creadoEn: new Date('2026-10-22T15:00:00Z'),
  actualizadoEn: new Date('2026-10-22T15:00:00Z'),
  ...over,
});

const PEDIDO: GenerarActasCdaRequest = {
  operadorIds: [OP, OP2],
  entregaNombre: 'William Paspuel',
  entregaCedula: '1001001005',
  entregaCargo: 'Analista Provincial',
  fecha: '2026-10-22',
  lugar: 'Ibarra',
  estadoPeto: 'BUENO',
  estadoCredencial: 'NUEVO',
  estadoCordon: 'BUENO',
};

describe('ActasCdaService', () => {
  let service: ActasCdaService;

  const prisma = {
    operadorCda: { findMany: jest.fn() },
    usuario: { findMany: jest.fn(), findFirst: jest.fn() },
    actaEntregaCda: {
      create: jest.fn(),
      updateMany: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(prisma));
    const moduleRef = await Test.createTestingModule({
      providers: [ActasCdaService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ActasCdaService);
  });

  it('lista: cada operador activo con su acta vigente o null', async () => {
    prisma.operadorCda.findMany.mockResolvedValue([
      { ...operador(), actas: [acta()] },
      { ...operador({ id: OP2 }), actas: [] },
    ]);
    const r = await service.lista();
    expect(r[0].acta).toMatchObject({ estado: 'GENERADA', fecha: '2026-10-22', entregaUsuarioId: ENTREGA });
    expect(r[1].acta).toBeNull();
    expect(prisma.operadorCda.findMany.mock.calls[0][0].where).toEqual({ activo: true });
  });

  it('personasEntrega: administradores como analistas, los demás como transversales', async () => {
    prisma.usuario.findMany.mockResolvedValue([
      { id: 'a', nombres: 'Edison ', apellidos: 'Mafla', cedula: '1', roles: [{ rol: { nombre: 'ADMINISTRADOR' } }] },
      { id: 'b', nombres: 'Jairo', apellidos: 'Leal', cedula: '2', roles: [{ rol: { nombre: 'ASISTENTE_TRANSVERSAL' } }] },
    ]);
    const r = await service.personasEntrega();
    expect(r[0]).toEqual({
      usuarioId: 'a',
      nombre: 'Edison Mafla',
      cedula: '1',
      cargoSugerido: 'Analista Provincial de Seguridad Informática y Proyectos Tecnológicos Electorales 1',
    });
    expect(r[1].cargoSugerido).toBe('Asistente Electoral Transversal');
  });

  describe('generar', () => {
    it('crea las nuevas, corrige las generadas y no toca las firmadas', async () => {
      const OP3 = '33333333-2222-4333-8444-555555555555';
      prisma.operadorCda.findMany.mockResolvedValue([
        { id: OP, actas: [] },
        { id: OP2, actas: [{ id: 'g', estado: 'GENERADA' }] },
        { id: OP3, actas: [{ id: 'f', estado: 'FIRMADA' }] },
      ]);
      prisma.actaEntregaCda.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

      const r = await service.generar({ ...PEDIDO, operadorIds: [OP, OP2, OP3, OP3, 'x'] }, USR);

      expect(r).toEqual({ generadas: 1, actualizadas: 1, omitidasFirmadas: 1, ignorados: 1 });
      expect(prisma.actaEntregaCda.create.mock.calls[0][0].data).toMatchObject({
        operadorId: OP,
        creadoPorId: USR,
        entregaPorId: null,
        fecha: new Date('2026-10-22T00:00:00Z'),
      });
      // La corrección va condicionada a que siga GENERADA.
      expect(prisma.actaEntregaCda.updateMany.mock.calls[0][0].where).toEqual({ id: 'g', estado: 'GENERADA' });
    });

    it('con un usuario elegido, la cédula tiene que ser la suya', async () => {
      prisma.usuario.findFirst.mockResolvedValue({ cedula: '1710034065' });
      await expect(service.generar({ ...PEDIDO, entregaUsuarioId: ENTREGA }, USR)).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.actaEntregaCda.create).not.toHaveBeenCalled();
    });

    it('rechaza un usuario inactivo o sin rol para entregar', async () => {
      prisma.usuario.findFirst.mockResolvedValue(null);
      await expect(service.generar({ ...PEDIDO, entregaUsuarioId: ENTREGA }, USR)).rejects.toThrow(
        'Quien entrega no es un usuario activo habilitado',
      );
    });
  });

  describe('firmar y reabrir', () => {
    it('firma la vigente si está generada', async () => {
      prisma.actaEntregaCda.findFirst.mockResolvedValue({ id: 'acta-1' });
      prisma.actaEntregaCda.updateMany.mockResolvedValue({ count: 1 });
      prisma.actaEntregaCda.findUniqueOrThrow.mockResolvedValue(
        acta({ estado: 'FIRMADA', firmadaEn: new Date('2026-10-22T20:00:00Z') }),
      );
      const r = await service.firmar(OP);
      expect(r.estado).toBe('FIRMADA');
      const llamada = prisma.actaEntregaCda.updateMany.mock.calls[0][0];
      expect(llamada.where).toEqual({ id: 'acta-1', estado: 'GENERADA' });
      expect(llamada.data.firmadaEn).toBeInstanceOf(Date);
    });

    it('no firma dos veces', async () => {
      prisma.actaEntregaCda.findFirst.mockResolvedValue({ id: 'acta-1' });
      prisma.actaEntregaCda.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.firmar(OP)).rejects.toThrow(ConflictException);
    });

    it('reabrir vuelve a GENERADA y borra la fecha de firma', async () => {
      prisma.actaEntregaCda.findFirst.mockResolvedValue({ id: 'acta-1' });
      prisma.actaEntregaCda.updateMany.mockResolvedValue({ count: 1 });
      prisma.actaEntregaCda.findUniqueOrThrow.mockResolvedValue(acta());
      await service.reabrir(OP);
      expect(prisma.actaEntregaCda.updateMany.mock.calls[0][0]).toEqual({
        where: { id: 'acta-1', estado: 'FIRMADA' },
        data: { estado: 'GENERADA', firmadaEn: null },
      });
    });

    it('sin acta: 404', async () => {
      prisma.actaEntregaCda.findFirst.mockResolvedValue(null);
      await expect(service.firmar(OP)).rejects.toThrow(NotFoundException);
    });
  });

  describe('descargas', () => {
    it('Word y PDF del acta vigente, con nombre de archivo sin la cédula completa', async () => {
      prisma.operadorCda.findMany.mockResolvedValue([{ ...operador(), actas: [acta()] }]);
      const w = await service.word(OP);
      expect(w.nombre).toBe('acta-perez-lopez-ana-maria-4065.docx');
      expect(w.contenido.subarray(0, 2).toString()).toBe('PK');
      const p = await service.pdf(OP);
      expect(p.nombre).toBe('acta-perez-lopez-ana-maria-4065.pdf');
      expect(p.contenido.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('sin acta generada: 404', async () => {
      prisma.operadorCda.findMany.mockResolvedValue([{ ...operador(), actas: [] }]);
      await expect(service.word(OP)).rejects.toThrow(NotFoundException);
    });

    it('ZIP: Word y PDF de cada operador con acta; los que no tienen, se omiten', async () => {
      prisma.operadorCda.findMany.mockResolvedValue([
        { ...operador(), actas: [acta()] },
        { ...operador({ id: OP2, apellidosNombres: 'RUIZ MERA LUIS', cedula: '1001001005' }), actas: [] },
      ]);
      const z = await service.zip([OP, OP2, OP]);
      expect(z.operadorIds).toEqual([OP]);
      expect(Object.keys(new PizZip(z.contenido).files).filter((n) => !n.endsWith('/')).sort()).toEqual([
        'pdf/acta-perez-lopez-ana-maria-4065.pdf',
        'word/acta-perez-lopez-ana-maria-4065.docx',
      ]);
      expect(prisma.operadorCda.findMany.mock.calls[0][0].where.id.in).toEqual([OP, OP2]);
    });

    it('ZIP con homónimos (mismo nombre y mismos 4 dígitos): no se pisan', async () => {
      prisma.operadorCda.findMany.mockResolvedValue([
        { ...operador(), actas: [acta()] },
        { ...operador({ id: OP2, cedula: '0105034065' }), actas: [acta({ id: 'acta-2', operadorId: OP2 })] },
      ]);
      const z = await service.zip([OP, OP2]);
      const nombres = Object.keys(new PizZip(z.contenido).files).filter((n) => n.startsWith('pdf/') && n.endsWith('.pdf'));
      expect(nombres.sort()).toEqual([
        'pdf/acta-perez-lopez-ana-maria-4065-2.pdf',
        'pdf/acta-perez-lopez-ana-maria-4065.pdf',
      ]);
    });

    it('solo un ZIP a la vez: el segundo pedido simultáneo recibe 429 y el primero termina bien', async () => {
      let soltar: (v: unknown) => void = () => undefined;
      prisma.operadorCda.findMany.mockReturnValueOnce(new Promise((r) => (soltar = r)));
      const primero = service.zip([OP]);
      await expect(service.zip([OP])).rejects.toMatchObject({ status: 429 });
      soltar([{ ...operador(), actas: [acta()] }]);
      await expect(primero).resolves.toMatchObject({ operadorIds: [OP] });
      // Liberado: el siguiente ya puede.
      prisma.operadorCda.findMany.mockResolvedValue([{ ...operador(), actas: [acta()] }]);
      await expect(service.zip([OP])).resolves.toBeDefined();
    });

    it('ZIP sin ninguna acta: 404 (y no deja el candado puesto)', async () => {
      prisma.operadorCda.findMany.mockResolvedValueOnce([]);
      await expect(service.zip([OP])).rejects.toThrow(NotFoundException);
      prisma.operadorCda.findMany.mockResolvedValueOnce([{ ...operador(), actas: [acta()] }]);
      await expect(service.zip([OP])).resolves.toBeDefined();
    });

    it('ZIP sin ninguna acta: 404', async () => {
      prisma.operadorCda.findMany.mockResolvedValue([]);
      await expect(service.zip([OP])).rejects.toThrow(NotFoundException);
    });
  });
});
