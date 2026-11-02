import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ReporteFlujoItem } from '@cne/shared-types';

import { InformeOperadorService, MAX_INFORMES_POR_PDF } from './informe-operador.service';
import * as pdfComun from '../common/pdf';
import { generarInformesOperadorPdf, generarReporteGeneralPdf } from './informe-operador.pdf';

const OPERADOR = '11111111-1111-1111-1111-111111111111';
const OTRO = '22222222-2222-2222-2222-222222222222';
const RESPONSABLE = '99999999-9999-9999-9999-999999999999';
// Una imagen JPEG real (como las fotos comprimidas de la app) para dibujar como foto del reporte.
const FOTO = readFileSync(join(__dirname, '..', 'assets', 'logo-elecciones-2027.jpg'));

/** Cantidad de imágenes incrustadas en el PDF (logo + fotos). */
const imagenes = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Subtype \/Image/g) ?? []).length;

function fila(over: Partial<ReporteFlujoItem> = {}): ReporteFlujoItem {
  return {
    cdaId: 'cda-1',
    cdaCodigo: '1961',
    cdaNombre: 'UE García Moreno',
    cantonId: 1,
    cantonNombre: 'Ibarra',
    operadorId: OPERADOR,
    operadorNombre: 'Willy Paspuel',
    operadorCedula: '1002003001',
    kitsCodigos: ['8LWKE5P4'],
    salidaDpiEn: '2026-10-01T14:09:00.000Z',
    llegadaRecintoEn: '2026-10-01T16:55:00.000Z',
    pruebaConexionEn: '2026-10-01T17:00:00.000Z',
    tieneFotoPruebaConexion: false,
    salidaRecintoEn: '2026-10-01T16:58:00.000Z',
    llegadaDpiEn: null,
    llegadaDpiManual: false,
    ...over,
  };
}

describe('InformeOperadorService', () => {
  const prisma = {
    usuario: { findMany: jest.fn(), findFirst: jest.fn() },
    eventoElectoral: { findFirst: jest.fn() },
    eventoTracking: { findMany: jest.fn() },
  };
  const storage = { readDecrypted: jest.fn() };
  const tracking = { reporteFlujoCdas: jest.fn() };
  const service = new InformeOperadorService(prisma as never, storage as never, tracking as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.usuario.findFirst.mockResolvedValue({ nombres: 'Edison', apellidos: 'Mafla', cedula: '1000000001' });
    prisma.eventoElectoral.findFirst.mockResolvedValue({ id: 'ev-1' });
    prisma.eventoTracking.findMany.mockResolvedValue([
      { operadorId: OPERADOR, actaInstalacionUrl: 'actas/i.bin', actaEscrutinioUrl: 'actas/e.bin' },
    ]);
    storage.readDecrypted.mockResolvedValue(FOTO);
  });

  it('responsables: solo usuarios activos con rol de administrador o técnico supervisor', async () => {
    prisma.usuario.findMany.mockResolvedValueOnce([
      { id: RESPONSABLE, nombres: 'Edison', apellidos: 'Mafla', cedula: '1000000001' },
    ]);

    await expect(service.responsables()).resolves.toEqual([
      { id: RESPONSABLE, nombre: 'Edison Mafla', cedula: '1000000001' },
    ]);
    expect(prisma.usuario.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          activo: true,
          roles: { some: { rol: { nombre: { in: ['ADMINISTRADOR', 'TECNICO_SUPERVISOR'] } } } },
        },
      }),
    );
  });

  it('pdfOperador con la jornada (día de elecciones): incluye las 2 fotos de los reportes', async () => {
    tracking.reporteFlujoCdas.mockResolvedValueOnce([fila(), fila({ operadorId: OTRO, cdaId: 'cda-2' })]);

    const pdf = await service.pdfOperador(OPERADOR, RESPONSABLE, true);

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(storage.readDecrypted).toHaveBeenCalledWith('actas/i.bin');
    expect(storage.readDecrypted).toHaveBeenCalledWith('actas/e.bin');
    expect(imagenes(pdf)).toBe(3); // logo + 2 fotos
  });

  it('pdfOperador sin la jornada (prueba técnica): ni busca ni descifra las fotos', async () => {
    tracking.reporteFlujoCdas.mockResolvedValueOnce([fila()]);

    const pdf = await service.pdfOperador(OPERADOR, RESPONSABLE, false);

    expect(prisma.eventoTracking.findMany).not.toHaveBeenCalled();
    expect(storage.readDecrypted).not.toHaveBeenCalled();
    expect(imagenes(pdf)).toBe(1); // solo el logo
  });

  it('pdfOperador: rechaza un responsable que no puede firmar', async () => {
    prisma.usuario.findFirst.mockResolvedValueOnce(null);
    await expect(service.pdfOperador(OPERADOR, RESPONSABLE, true)).rejects.toThrow(BadRequestException);
    expect(tracking.reporteFlujoCdas).not.toHaveBeenCalled();
  });

  it('pdfOperador: 404 si el operador no tiene CDA en el evento activo', async () => {
    tracking.reporteFlujoCdas.mockResolvedValueOnce([fila({ operadorId: OTRO })]);
    await expect(service.pdfOperador(OPERADOR, RESPONSABLE, true)).rejects.toThrow(NotFoundException);
  });

  it('pdfOperador: si una foto no se puede leer, el informe sale igual', async () => {
    tracking.reporteFlujoCdas.mockResolvedValueOnce([fila()]);
    storage.readDecrypted.mockRejectedValueOnce(new Error('no existe'));

    const pdf = await service.pdfOperador(OPERADOR, RESPONSABLE, true);

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('pdfVarios: filtra por cantón y no lee fotos de los demás', async () => {
    tracking.reporteFlujoCdas.mockResolvedValueOnce([
      fila(),
      fila({ operadorId: OTRO, cantonId: 2, cantonNombre: 'Otavalo' }),
    ]);

    await service.pdfVarios({ cantonId: 1 }, RESPONSABLE, true);

    expect(prisma.eventoTracking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ operadorId: { in: [OPERADOR] } }) }),
    );
  });

  it('pdfVarios: solo los operadores elegidos', async () => {
    tracking.reporteFlujoCdas.mockResolvedValueOnce([
      fila(),
      fila({ operadorId: OTRO }),
      fila({ operadorId: '33333333-3333-3333-3333-333333333333' }),
    ]);

    await service.pdfVarios({ operadorIds: [OTRO] }, RESPONSABLE, true);

    expect(prisma.eventoTracking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ operadorId: { in: [OTRO] } }) }),
    );
  });

  it('pdfVarios: pide elegir cantón u operadores si pasa del máximo por archivo', async () => {
    tracking.reporteFlujoCdas.mockResolvedValueOnce(
      Array.from({ length: MAX_INFORMES_POR_PDF + 1 }, (_, i) => fila({ operadorId: `op-${i}` })),
    );
    await expect(service.pdfVarios({}, RESPONSABLE, true)).rejects.toThrow(BadRequestException);
    expect(storage.readDecrypted).not.toHaveBeenCalled();
  });

  it('pdfGeneral: una tabla de todos (sin tope) sin leer ninguna foto', async () => {
    tracking.reporteFlujoCdas.mockResolvedValueOnce(
      Array.from({ length: MAX_INFORMES_POR_PDF + 5 }, (_, i) => fila({ operadorId: `op-${i}` })),
    );

    const pdf = await service.pdfGeneral(undefined, RESPONSABLE, true);

    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(storage.readDecrypted).not.toHaveBeenCalled();
    expect(imagenes(pdf)).toBe(1); // solo el logo
  });

  it('pdfGeneral: rechaza un responsable que no puede firmar', async () => {
    prisma.usuario.findFirst.mockResolvedValueOnce(null);
    await expect(service.pdfGeneral(undefined, RESPONSABLE, false)).rejects.toThrow(BadRequestException);
  });
});

describe('generarInformesOperadorPdf', () => {
  const base = {
    operador: { nombre: 'Willy Paspuel', cedula: '1002003001' },
    cda: '1961 — UE García Moreno',
    canton: 'Ibarra',
    kits: ['8LWKE5P4'],
    salidaDpi: new Date('2026-10-01T14:09:00.000Z'),
    llegadaRecinto: null,
    pruebaConexion: null,
    salidaRecinto: null,
    llegadaDpi: null,
  };
  const responsable = { nombre: 'Edison Mafla', cedula: '1000000001' };
  const sinFotos = { ...base, actaInstalacion: async () => null, actaEscrutinio: async () => null };

  it('no falla con fotos ilegibles ni sin fotos', async () => {
    const pdf = await generarInformesOperadorPdf(
      [{ ...base, actaInstalacion: async () => Buffer.from('no es imagen'), actaEscrutinio: async () => null }],
      responsable,
      true,
    );
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('sin la jornada el registro sale vertical (un hito por fila); con la jornada, horizontal', async () => {
    const espia = jest.spyOn(pdfComun, 'tabla');
    try {
      await generarInformesOperadorPdf([sinFotos], responsable, false);
      expect(espia).toHaveBeenLastCalledWith(
        expect.anything(),
        ['Hito', 'Fecha y hora'],
        [0.5, 0.5],
        [
          ['Salida DPI', '01/10/2026, 09:09'],
          ['Llegada al recinto', 'Pendiente'],
          ['Salida del recinto', 'Pendiente'],
          ['Llegada al DPI', 'Pendiente'],
        ],
      );

      await generarInformesOperadorPdf([sinFotos], responsable, true);
      expect(espia).toHaveBeenLastCalledWith(
        expect.anything(),
        ['Salida DPI', 'Llegada al recinto', 'Prueba de conexión', 'Salida del recinto', 'Llegada al DPI'],
        expect.any(Array),
        [['01/10/2026, 09:09', 'Pendiente', 'Pendiente', 'Pendiente', 'Pendiente']],
      );
    } finally {
      espia.mockRestore();
    }
  });

  it('la llegada al DPI registrada por el administrador queda señalada en el informe', async () => {
    const espia = jest.spyOn(pdfComun, 'tabla');
    try {
      await generarInformesOperadorPdf(
        [{ ...sinFotos, llegadaDpi: new Date('2026-10-01T23:30:00.000Z'), llegadaDpiManual: true }],
        responsable,
        false,
      );
      const filas = espia.mock.calls.at(-1)![3] as string[][];
      expect(filas.at(-1)).toEqual(['Llegada al DPI', '01/10/2026, 18:30 (registrada por el administrador)']);
    } finally {
      espia.mockRestore();
    }
  });

  it('sin la jornada no pide las fotos', async () => {
    const actaInstalacion = jest.fn(async () => null);
    const actaEscrutinio = jest.fn(async () => null);

    await generarInformesOperadorPdf([{ ...base, actaInstalacion, actaEscrutinio }], responsable, false);

    expect(actaInstalacion).not.toHaveBeenCalled();
    expect(actaEscrutinio).not.toHaveBeenCalled();
  });

  it('incrusta el logo una sola vez aunque haya varios operadores', async () => {
    const pdf = await generarInformesOperadorPdf([sinFotos, sinFotos, sinFotos], responsable, true);
    expect(imagenes(pdf)).toBe(1);
  });

  it('genera un PDF válido aunque no haya operadores', async () => {
    const pdf = await generarInformesOperadorPdf([], responsable, true);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('generarReporteGeneralPdf', () => {
  const responsable = { nombre: 'Edison Mafla', cedula: '1000000001' };
  const jornada = {
    operador: { nombre: 'Willy Paspuel', cedula: '1002003001' },
    cda: '1961 — UE García Moreno',
    canton: 'Ibarra',
    kits: ['8LWKE5P4'],
    salidaDpi: new Date('2026-10-01T14:09:00.000Z'),
    llegadaRecinto: null,
    pruebaConexion: null,
    salidaRecinto: null,
    llegadaDpi: null,
  };

  it('pasa de página en horizontal con muchos operadores', async () => {
    const pdf = await generarReporteGeneralPdf(Array.from({ length: 60 }, () => jornada), responsable, false);
    const texto = pdf.toString('latin1');

    expect((texto.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
    // Todas las páginas en A4 horizontal (841.89 x 595.28).
    expect(texto).not.toMatch(/\/MediaBox \[0 0 595\.28 841\.89\]/);
  });

  it('genera un PDF válido aunque no haya operadores', async () => {
    const pdf = await generarReporteGeneralPdf([], responsable, true);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
