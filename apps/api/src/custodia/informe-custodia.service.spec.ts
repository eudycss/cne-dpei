import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../common/roles.decorator';
import { CustodiaController, filtrosInforme } from './custodia.controller';
import { InformeCustodiaService, MAX_ACTAS_POR_PDF } from './informe-custodia.service';
import { generarActasPdf } from './acta-custodia.pdf';

const eventoId = '22222222-2222-2222-2222-222222222222';
const kitId = '33333333-3333-3333-3333-333333333333';
const recintoId = '44444444-4444-4444-4444-444444444444';

const operador = { id: 'op1', nombres: 'Ana', apellidos: 'Pérez', cedula: '1002003004' };
const asistente = { id: 'as1', nombres: 'Jairo', apellidos: 'Leal', cedula: '1003004005' };
const militar = { id: 'mi1', nombres: 'Juan', apellidos: 'Paz', cedula: '1004005006' };
const militarNuevo = { id: 'mi2', nombres: 'Pedro', apellidos: 'Mora', cedula: '1005006007' };

function kitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: kitId,
    codigoUnico: 'ABCD2345',
    recintoId,
    recinto: { codigoRecinto: '28', nombre: 'Escuela Central', cantonId: 30, canton: { nombre: 'IBARRA' } },
    operador,
    itemsContenido: [
      { itemId: 'i1', serie: '5CD445577S', estado: 'BUENO', item: { etiqueta: 'Computador' } },
      { itemId: 'i2', serie: null, estado: 'BUENO', item: { etiqueta: 'Cargador' } },
    ],
    entregaCustodio: {
      entregadoPorId: asistente.id,
      entregadoEn: new Date('2026-11-16T11:00:00Z'),
      militarDeOtroRecinto: false,
      militar: militarNuevo,
    },
    ...overrides,
  };
}

describe('InformeCustodiaService', () => {
  let prisma: any;
  let storage: { readDecrypted: jest.Mock };
  let service: InformeCustodiaService;

  beforeEach(() => {
    prisma = {
      eventoElectoral: { findFirst: jest.fn().mockResolvedValue({ id: eventoId, nombre: 'Elecciones 2027' }) },
      kitElectoral: { findMany: jest.fn().mockResolvedValue([kitRow()]), findFirst: jest.fn() },
      recepcionKit: {
        findMany: jest.fn().mockResolvedValue([
          { kitId, operadorId: operador.id, confirmadoEn: new Date('2026-11-16T13:00:00Z'), fotoMilitarUrl: 'militares/f.bin' },
        ]),
      },
      recepcionDpiKit: {
        findMany: jest.fn().mockResolvedValue([
          {
            kitId,
            supervisorId: asistente.id,
            confirmadoEn: new Date('2026-11-16T23:00:00Z'),
            observaciones: 'Cargador dañado',
            items: [
              { texto: 'Computador', marcado: true, itemId: 'i1', serie: '5CD445577S', estado: 'BUENO' },
              { texto: 'Cargador', marcado: true, itemId: 'i2', serie: null, estado: 'MALO' },
            ],
          },
        ]),
      },
      correccionCustodiaKit: {
        findMany: jest.fn().mockResolvedValue([
          {
            kitId,
            campo: 'MILITAR',
            valorAnterior: militar.id,
            valorNuevo: militarNuevo.id,
            motivo: 'Reemplazo de último minuto',
            corregidoEn: new Date('2026-11-16T11:30:00Z'),
          },
        ]),
      },
      usuario: { findMany: jest.fn().mockResolvedValue([operador, asistente]) },
      militar: { findMany: jest.fn().mockResolvedValue([militar, militarNuevo]) },
    };
    storage = { readDecrypted: jest.fn().mockResolvedValue(Buffer.from('no-es-imagen')) };
    service = new InformeCustodiaService(prisma, storage as any);
  });

  it('arma una fila por kit con las tres etapas, quién las hizo y el número de correcciones', async () => {
    const [fila] = await service.informe({});

    expect(fila).toEqual({
      kitId,
      codigoUnico: 'ABCD2345',
      recintoId,
      recintoCodigo: '28',
      recintoNombre: 'Escuela Central',
      cantonId: 30,
      cantonNombre: 'IBARRA',
      operadorNombre: 'Pérez Ana',
      operadorCedula: '1002003004',
      entrega: {
        militarNombre: 'Mora Pedro',
        militarCedula: '1005006007',
        entregadoEn: '2026-11-16T11:00:00.000Z',
        entregadoPorNombre: 'Leal Jairo',
        militarDeOtroRecinto: false,
      },
      recepcion: { confirmadoEn: '2026-11-16T13:00:00.000Z', tieneFoto: true },
      devolucion: {
        confirmadoEn: '2026-11-16T23:00:00.000Z',
        verificadoPorNombre: 'Leal Jairo',
        completo: true,
        observaciones: 'Cargador dañado',
      },
      correcciones: 1,
    });
  });

  it('kits sin entrega, recepción ni devolución quedan con esas etapas en null', async () => {
    prisma.kitElectoral.findMany.mockResolvedValueOnce([kitRow({ entregaCustodio: null })]);
    prisma.recepcionKit.findMany.mockResolvedValueOnce([]);
    prisma.recepcionDpiKit.findMany.mockResolvedValueOnce([]);
    prisma.correccionCustodiaKit.findMany.mockResolvedValueOnce([]);

    const [fila] = await service.informe({});
    expect(fila).toEqual(expect.objectContaining({ entrega: null, recepcion: null, devolucion: null, correcciones: 0 }));
  });

  it('filtra por cantón y recinto, solo kits reales del evento activo', async () => {
    await service.informe({ cantonId: 30, recintoId });
    expect(prisma.kitElectoral.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventoId, esPrueba: false, id: undefined, recintoId, recinto: { cantonId: 30 } },
      }),
    );
  });

  it('sin evento activo responde 404', async () => {
    prisma.eventoElectoral.findFirst.mockResolvedValueOnce(null);
    await expect(service.informe({})).rejects.toThrow(NotFoundException);
  });

  it('genera el acta de un kit del evento activo como PDF, aunque la foto no se pueda leer', async () => {
    prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: kitId });
    storage.readDecrypted.mockRejectedValueOnce(new Error('sin acceso'));

    const pdf = await service.actaKit(kitId);

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(prisma.kitElectoral.findFirst).toHaveBeenCalledWith({
      where: { id: kitId, eventoId },
      select: { id: true },
    });
  });

  it('una devolución sin checklist no cuenta como contenido completo', async () => {
    prisma.recepcionDpiKit.findMany.mockResolvedValueOnce([
      { kitId, supervisorId: asistente.id, confirmadoEn: new Date(), observaciones: null, items: [] },
    ]);
    const [fila] = await service.informe({});
    expect(fila.devolucion?.completo).toBe(false);
  });

  it('si el usuario de un paso ya no existe, el acta igual sale (no niega el paso)', async () => {
    prisma.kitElectoral.findFirst.mockResolvedValueOnce({ id: kitId });
    prisma.usuario.findMany.mockResolvedValueOnce([]); // ni operador ni asistente
    const pdf = await service.actaKit(kitId);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('las actas masivas piden filtrar si pasan el tope (no se cortan en silencio)', async () => {
    prisma.kitElectoral.findMany.mockResolvedValueOnce(
      Array.from({ length: MAX_ACTAS_POR_PDF + 1 }, (_, i) => kitRow({ id: `k${i}` })),
    );
    await expect(service.actas({})).rejects.toThrow(BadRequestException);
    expect(storage.readDecrypted).not.toHaveBeenCalled();
  });

  it('las fotos se leen una por acta mientras se genera el PDF', async () => {
    prisma.kitElectoral.findMany.mockResolvedValueOnce([kitRow(), kitRow({ id: 'k2' })]);
    prisma.recepcionKit.findMany.mockResolvedValueOnce([
      { kitId, operadorId: operador.id, confirmadoEn: new Date(), fotoMilitarUrl: 'militares/a.bin' },
      { kitId: 'k2', operadorId: operador.id, confirmadoEn: new Date(), fotoMilitarUrl: 'militares/b.bin' },
    ]);
    await service.actas({});
    expect(storage.readDecrypted.mock.calls).toEqual([['militares/a.bin'], ['militares/b.bin']]);
  });

  it('un kit de otro evento no tiene acta (404)', async () => {
    prisma.kitElectoral.findFirst.mockResolvedValueOnce(null);
    await expect(service.actaKit(kitId)).rejects.toThrow(NotFoundException);
  });
});

describe('generarActasPdf', () => {
  it('una página por kit, y una página de aviso si no hay kits', async () => {
    const base = {
      eventoNombre: 'Elecciones 2027',
      codigoUnico: 'K1',
      recinto: '28 — Escuela',
      canton: 'IBARRA',
      articulos: [{ articulo: 'Computador', serie: null, estadoSalida: 'BUENO', estadoRetorno: null }],
      entrega: null,
      recepcion: null,
      devolucion: null,
      correcciones: [],
      operador: null,
      militar: null,
      asistente: null,
    };
    const paginas = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

    expect(paginas(await generarActasPdf([base, { ...base, codigoUnico: 'K2' }]))).toBe(2);
    expect(paginas(await generarActasPdf([]))).toBe(1);
  });

  it('un acta con mucho contenido pasa a otra página en vez de encimar tablas y firmas', async () => {
    const largo = {
      eventoNombre: 'Elecciones 2027',
      codigoUnico: 'K1',
      recinto: '28 — Escuela',
      canton: 'IBARRA',
      articulos: Array.from({ length: 30 }, (_, i) => ({
        articulo: `Artículo ${i}`,
        serie: `SERIE-${i}`,
        estadoSalida: 'BUENO',
        estadoRetorno: 'REGULAR',
      })),
      entrega: null,
      recepcion: { fecha: new Date(), operador: { nombre: 'Ana', cedula: '1' }, foto: async () => Buffer.from('foto-corrupta') },
      devolucion: { fecha: new Date(), asistente: { nombre: 'Jairo', cedula: '2' }, observaciones: 'x '.repeat(600) },
      correcciones: [],
      operador: null,
      militar: null,
      asistente: null,
    };
    const pdf = await generarActasPdf([largo]);
    // Una foto corrupta no rompe el acta, y el contenido largo usa 2+ páginas.
    expect((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('CustodiaController — informe', () => {
  it('el informe y las actas también los puede leer el LECTOR', () => {
    const reflector = new Reflector();
    for (const m of ['informe', 'actas', 'actaKit'] as const) {
      expect(reflector.get(ROLES_KEY, CustodiaController.prototype[m])).toEqual([
        'ASISTENTE_TRANSVERSAL',
        'ADMINISTRADOR',
        'LECTOR',
      ]);
    }
  });

  it('filtrosInforme ignora valores inválidos en vez de romper la consulta', () => {
    expect(filtrosInforme('30', recintoId)).toEqual({ cantonId: 30, recintoId });
    expect(filtrosInforme('abc', 'no-uuid')).toEqual({ cantonId: undefined, recintoId: undefined });
    expect(filtrosInforme(['1'], undefined)).toEqual({ cantonId: undefined, recintoId: undefined });
  });
});
