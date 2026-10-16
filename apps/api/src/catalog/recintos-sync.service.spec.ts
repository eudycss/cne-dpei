import { BadRequestException } from '@nestjs/common';
import { RecintosSyncService } from './recintos-sync.service';
import type { RecintoSheet, RecintosSheetClient } from './recintos-sheet.client';
import type { PrismaService } from '../db/prisma.service';

const CANTONES = [
  { id: 1, codigo: '30', nombre: 'IBARRA' },
  { id: 3, codigo: '40', nombre: 'COTACACHI' },
];

function sheet(o: Partial<RecintoSheet> & Pick<RecintoSheet, 'codigoRecinto' | 'tipo'>): RecintoSheet {
  return {
    nombre: `Recinto ${o.codigoRecinto}`,
    direccion: 'Calle 1',
    cantonCodigo: '30',
    parroquia: 'SAN FRANCISCO',
    zona: null,
    cdaDestinoCodigo: null,
    latitud: 0.35,
    longitud: -78.12,
    tieneInternet: true,
    coberturaMovil: true,
    numeroElectores: 100,
    juntasFemeninas: 1,
    juntasMasculinas: 1,
    esDificilAcceso: false,
    ...o,
  };
}

/** El mismo recinto como está en la base (sin cambios respecto de `sheet`). */
function bd(s: RecintoSheet, o: Record<string, unknown> = {}) {
  return {
    id: `id-${s.codigoRecinto}`,
    codigoRecinto: s.codigoRecinto,
    nombre: s.nombre,
    direccion: s.direccion,
    cantonId: CANTONES.find((c) => c.codigo === s.cantonCodigo)!.id,
    parroquia: s.parroquia,
    zona: s.zona,
    tipo: s.tipo,
    cdaDestinoCodigo: s.cdaDestinoCodigo,
    lat: s.latitud,
    lng: s.longitud,
    tieneInternet: s.tieneInternet,
    coberturaMovil: s.coberturaMovil,
    numeroElectores: s.numeroElectores,
    juntasFemeninas: s.juntasFemeninas,
    juntasMasculinas: s.juntasMasculinas,
    esDificilAcceso: s.esDificilAcceso,
    activo: true,
    ...o,
  };
}

describe('RecintosSyncService', () => {
  let filasSheet: RecintoSheet[];
  let filasBd: ReturnType<typeof bd>[];
  let evento: { id: string; fechaJornada: Date } | null;
  let kits: { recintoId: string }[];

  const tx = {
    recinto: { findMany: jest.fn(), updateMany: jest.fn() },
    eventoElectoral: { findFirst: jest.fn(async () => evento) },
    kitElectoral: { findFirst: jest.fn(async () => null) },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  };
  const prisma = {
    canton: { findMany: jest.fn(async () => CANTONES) },
    $queryRaw: jest.fn(async () => filasBd),
    eventoElectoral: { findFirst: jest.fn(async () => evento) },
    kitElectoral: { findMany: jest.fn(async () => kits) },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
  };
  const cliente = { leer: jest.fn(async () => filasSheet) };
  const service = new RecintosSyncService(
    prisma as unknown as PrismaService,
    cliente as unknown as RecintosSheetClient,
  );

  const cda28 = sheet({ codigoRecinto: '28', tipo: 'CDA' });
  const noCda182 = sheet({ codigoRecinto: '182', tipo: 'NO_CDA', cdaDestinoCodigo: '28' });

  beforeEach(() => {
    jest.clearAllMocks();
    filasSheet = [cda28, noCda182];
    filasBd = [bd(cda28), bd(noCda182)];
    evento = null;
    kits = [];
    tx.recinto.findMany.mockResolvedValue(filasBd.map((r) => ({ id: r.id, codigoRecinto: r.codigoRecinto })));
  });

  describe('preview', () => {
    it('sin diferencias no propone cambios', async () => {
      const p = await service.preview();

      expect(p).toEqual({
        leidos: { cda: 1, noCda: 1 },
        sinCambios: 2,
        cambios: [],
        errores: [],
        congelado: false,
        ocultamientoMasivo: false,
      });
    });

    it('lista campo por campo lo que cambia y no escribe nada', async () => {
      filasSheet = [
        { ...cda28, nombre: 'Nuevo nombre', latitud: 0.36, tieneInternet: false },
        noCda182,
      ];

      const p = await service.preview();

      expect(p.cambios).toEqual([
        {
          codigoRecinto: '28',
          nombre: 'Nuevo nombre',
          accion: 'ACTUALIZAR',
          cambios: [
            { campo: 'Nombre', antes: 'Recinto 28', despues: 'Nuevo nombre' },
            { campo: 'Coordenadas', antes: '0.350000, -78.120000', despues: '0.360000, -78.120000' },
            { campo: 'Internet', antes: 'Sí', despues: 'No' },
          ],
          nota: undefined,
        },
      ]);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('ignora diferencias de coordenadas menores al redondeo del Sheet', async () => {
      filasSheet = [{ ...cda28, latitud: 0.3500004 }, noCda182];

      expect((await service.preview()).cambios).toEqual([]);
    });

    it('propone crear los recintos nuevos', async () => {
      filasSheet = [...filasSheet, sheet({ codigoRecinto: '9000', tipo: 'NO_CDA', cdaDestinoCodigo: '28' })];

      const p = await service.preview();

      expect(p.cambios).toEqual([expect.objectContaining({ codigoRecinto: '9000', accion: 'CREAR' })]);
    });

    it('un destino que no es código de recinto (CPE-DELEGACION…) queda sin CDA', async () => {
      filasSheet = [cda28, { ...noCda182, cdaDestinoCodigo: 'CPE-DELEGACION ELECTORAL DE IMBABURA' }];

      const [cambio] = (await service.preview()).cambios;

      expect(cambio.cambios).toEqual([{ campo: 'CDA destino', antes: '28', despues: 'Delegación (sin CDA)' }]);
    });

    it('oculta lo que salió del Sheet y reactiva lo que volvió', async () => {
      const viejo = sheet({ codigoRecinto: '500', tipo: 'NO_CDA', cdaDestinoCodigo: '28' });
      const volvio = sheet({ codigoRecinto: '501', tipo: 'NO_CDA', cdaDestinoCodigo: '28' });
      filasSheet = [cda28, noCda182, volvio];
      filasBd = [...filasBd, bd(viejo), bd(volvio, { activo: false })];

      const p = await service.preview();

      expect(p.cambios.map((c) => [c.codigoRecinto, c.accion])).toEqual([
        ['501', 'REACTIVAR'],
        ['500', 'OCULTAR'],
      ]);
    });

    it('si un CDA salió de la hoja de CDAs, sus NO CDA pasan al CDA que lo reemplazó en la misma parroquia', async () => {
      const cdaViejo = sheet({ codigoRecinto: '1207', tipo: 'CDA', parroquia: 'CAROLINA /GUALLUPI' });
      const cdaNuevo = sheet({ codigoRecinto: '8587', tipo: 'CDA', parroquia: 'CAROLINA / GUALLUPI' });
      const noCda937 = sheet({ codigoRecinto: '937', tipo: 'NO_CDA', cdaDestinoCodigo: '1207' });
      filasSheet = [cda28, noCda182, cdaNuevo, noCda937];
      filasBd = [...filasBd, bd(cdaViejo), bd(noCda937)];

      const p = await service.preview();

      const c937 = p.cambios.find((c) => c.codigoRecinto === '937');
      expect(c937?.cambios).toEqual([{ campo: 'CDA destino', antes: '1207', despues: '8587' }]);
      expect(c937?.nota).toMatch(/1207 ya no está .* se asigna 8587/);
      expect(p.cambios.map((c) => [c.codigoRecinto, c.accion])).toEqual(
        expect.arrayContaining([
          ['8587', 'CREAR'],
          ['1207', 'OCULTAR'],
        ]),
      );
    });

    it('sin un reemplazo único no adivina: marca error y no toca el NO CDA', async () => {
      const cdaViejo = sheet({ codigoRecinto: '1207', tipo: 'CDA', parroquia: 'CAROLINA' });
      const noCda937 = sheet({ codigoRecinto: '937', tipo: 'NO_CDA', cdaDestinoCodigo: '1207' });
      filasSheet = [
        cda28,
        noCda182,
        sheet({ codigoRecinto: '8587', tipo: 'CDA', parroquia: 'CAROLINA' }),
        sheet({ codigoRecinto: '8588', tipo: 'CDA', parroquia: 'CAROLINA' }),
        { ...noCda937, nombre: 'Otro nombre' },
      ];
      filasBd = [...filasBd, bd(cdaViejo), bd(noCda937)];

      const p = await service.preview();

      expect(p.errores).toEqual([
        expect.objectContaining({ codigoRecinto: '937', error: expect.stringMatching(/1207/) }),
        // Como 937 sigue apuntándole, 1207 tampoco se oculta.
        expect.objectContaining({ codigoRecinto: '1207', error: expect.stringMatching(/Dejaría sin CDA/) }),
      ]);
      expect(p.cambios.find((c) => c.codigoRecinto === '937')).toBeUndefined();
    });

    it('no oculta ni pasa a NO CDA un recinto con kits en el evento activo', async () => {
      const conKit = sheet({ codigoRecinto: '1207', tipo: 'CDA' });
      filasSheet = [{ ...cda28, tipo: 'NO_CDA', cdaDestinoCodigo: null }];
      filasBd = [bd(cda28), bd(conKit)];
      evento = { id: 'ev', fechaJornada: new Date('2099-11-29') };
      kits = [{ recintoId: 'id-1207' }, { recintoId: 'id-28' }];

      const p = await service.preview();

      expect(p.errores.map((e) => e.codigoRecinto).sort()).toEqual(['1207', '28']);
      expect(p.errores.every((e) => /kit\(s\) en el evento activo/.test(e.error))).toBe(true);
      expect(p.cambios).toEqual([]);
    });

    it('marca error con coordenadas fuera de Imbabura o un cantón desconocido', async () => {
      filasSheet = [
        { ...cda28, latitud: -2.19 },
        { ...noCda182, cantonCodigo: '99' },
      ];

      const p = await service.preview();

      expect(p.errores.map((e) => [e.codigoRecinto, e.error])).toEqual([
        ['28', expect.stringMatching(/Coordenadas/)],
        ['182', expect.stringMatching(/Cantón 99/)],
      ]);
    });

    it('un NO CDA cuyo CDA destino tiene errores tampoco se cambia', async () => {
      filasSheet = [{ ...cda28, latitud: null }, { ...noCda182, nombre: 'Cambiado' }];

      const p = await service.preview();

      expect(p.errores.map((e) => e.codigoRecinto)).toEqual(['28', '182']);
      expect(p.errores[1].error).toMatch(/CDA destino 28 tiene errores/);
    });

    it('avisa que la jornada está congelada', async () => {
      evento = { id: 'ev', fechaJornada: new Date('2000-01-01') };

      expect((await service.preview()).congelado).toBe(true);
    });

    it('un Sheet vacío se rechaza en vez de ocultar todos los recintos', async () => {
      filasSheet = [];

      await expect(service.preview()).rejects.toThrow(/no trae ningún recinto/);
    });

    it('marca como ocultamiento masivo si saldría más del 20 % de los recintos', async () => {
      const extras = Array.from({ length: 8 }, (_, i) =>
        bd(sheet({ codigoRecinto: String(600 + i), tipo: 'NO_CDA', cdaDestinoCodigo: '28' })),
      );
      filasBd = [...filasBd, ...extras];

      const p = await service.preview();

      expect(p.cambios.filter((c) => c.accion === 'OCULTAR')).toHaveLength(8);
      expect(p.ocultamientoMasivo).toBe(true);
    });

    it.each([
      ['nombre vacío', { nombre: '  ' }, /Nombre vacío/],
      ['parroquia larga', { parroquia: 'P'.repeat(121) }, /Parroquia de más de 120/],
      ['electores fuera de rango', { numeroElectores: 3_000_000_000 }, /Electores fuera de rango/],
    ])('una fila con %s se reporta como error y no tumba el lote', async (_caso, cambio, mensaje) => {
      filasSheet = [cda28, { ...noCda182, ...cambio }];

      const p = await service.preview();

      expect(p.errores).toEqual([expect.objectContaining({ codigoRecinto: '182', error: expect.stringMatching(mensaje) })]);
    });

    it('no oculta un CDA si un NO CDA activo que no se actualiza sigue apuntándole', async () => {
      const cdaViejo = sheet({ codigoRecinto: '1207', tipo: 'CDA', parroquia: 'OTRA' });
      const noCda937 = sheet({ codigoRecinto: '937', tipo: 'NO_CDA', cdaDestinoCodigo: '1207' });
      // 937 tiene un cantón inválido en el Sheet: queda como está, apuntando a 1207.
      filasSheet = [cda28, noCda182, { ...noCda937, cdaDestinoCodigo: '28', cantonCodigo: '99' }];
      filasBd = [...filasBd, bd(cdaViejo), bd(noCda937)];

      const p = await service.preview();

      expect(p.errores.find((e) => e.codigoRecinto === '1207')?.error).toMatch(/Dejaría sin CDA a 1 NO CDA .*937/);
      expect(p.cambios.find((c) => c.codigoRecinto === '1207')).toBeUndefined();
    });
  });

  describe('aplicar', () => {
    it('crea primero los CDA y enlaza el NO CDA nuevo con el id del CDA recién creado', async () => {
      const cdaNuevo = sheet({ codigoRecinto: '8587', tipo: 'CDA' });
      const noCdaNuevo = sheet({ codigoRecinto: '9000', tipo: 'NO_CDA', cdaDestinoCodigo: '8587' });
      filasSheet = [noCdaNuevo, cda28, noCda182, cdaNuevo];

      const r = await service.aplicar();

      expect(r).toEqual({ aplicados: 2, creados: 2, actualizados: 0, ocultados: 0, errores: [] });
      const inserts = tx.$executeRaw.mock.calls.map((c) => c.slice(1) as unknown[]);
      expect(inserts[0]).toContain('8587');
      expect(inserts[1]).toContain('9000');
      const idCda = inserts[0][0];
      expect(inserts[1]).toContain(idCda);
    });

    it('oculta en lote los recintos que salieron del Sheet', async () => {
      filasBd = [...filasBd, bd(sheet({ codigoRecinto: '500', tipo: 'NO_CDA', cdaDestinoCodigo: '28' }))];

      await service.aplicar();

      expect(tx.recinto.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['id-500'] } }, data: { activo: false } });
    });

    it('aplica lo válido y devuelve los errores de lo que omitió', async () => {
      filasSheet = [cda28, { ...noCda182, cantonCodigo: '99' }, sheet({ codigoRecinto: '9000', tipo: 'NO_CDA' })];

      const r = await service.aplicar();

      expect(r.aplicados).toBe(1);
      expect(r.errores.map((e) => e.codigoRecinto)).toEqual(['182']);
    });

    it('con la jornada iniciada no escribe nada', async () => {
      evento = { id: 'ev', fechaJornada: new Date('2000-01-01') };

      await expect(service.aplicar()).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('con un ocultamiento masivo no escribe nada', async () => {
      filasBd = [
        ...filasBd,
        ...Array.from({ length: 8 }, (_, i) =>
          bd(sheet({ codigoRecinto: String(600 + i), tipo: 'NO_CDA', cdaDestinoCodigo: '28' })),
        ),
      ];

      await expect(service.aplicar()).rejects.toThrow(/Se ocultarían 8 recintos/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('toma un lock y, si mientras tanto se asignó un kit a un recinto que se oculta, aborta', async () => {
      filasBd = [...filasBd, bd(sheet({ codigoRecinto: '500', tipo: 'NO_CDA', cdaDestinoCodigo: '28' }))];
      evento = { id: 'ev', fechaJornada: new Date('2099-11-29') };
      tx.kitElectoral.findFirst.mockResolvedValueOnce({ recinto: { codigoRecinto: '500' } } as never);

      await expect(service.aplicar()).rejects.toThrow(/Se asignó un kit al recinto 500/);
      expect(tx.$queryRaw).toHaveBeenCalled();
      expect(tx.kitElectoral.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { recintoId: { in: ['id-500'] }, eventoId: 'ev' } }),
      );
      expect(tx.recinto.updateMany).not.toHaveBeenCalled();
    });
  });
});
