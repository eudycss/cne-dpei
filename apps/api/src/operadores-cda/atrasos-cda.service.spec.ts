import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as ExcelJS from 'exceljs';

import { AtrasosCdaService } from './atrasos-cda.service';
import { PrismaService } from '../db/prisma.service';
import { FILA_ENCABEZADOS_EXCEL } from './reporte-cda';

// 22-oct-2026 08:05 en Ecuador: hoy aún está dentro de la gracia.
const AHORA = new Date('2026-10-22T13:05:00Z');
const ec = (dia: string, hhmm: string) => new Date(`${dia}T${hhmm}:00-05:00`);
const fecha = (dia: string) => new Date(`${dia}T00:00:00Z`);

const operador = (id: string, apellidosNombres: string, fechaInicio: string | null = '2026-10-01') => ({
  id,
  apellidosNombres,
  cedula: `17${id.padStart(8, '0')}`,
  fechaInicio: fechaInicio ? fecha(fechaInicio) : null,
  activo: true,
});

describe('AtrasosCdaService', () => {
  let service: AtrasosCdaService;

  const prisma = {
    configAsistenciaCda: { findUnique: jest.fn(), upsert: jest.fn() },
    operadorCda: { findMany: jest.fn() },
    asistenciaCda: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: AHORA, doNotFake: ['nextTick', 'setImmediate'] });
    prisma.configAsistenciaCda.findUnique.mockResolvedValue(null);
    const moduleRef = await Test.createTestingModule({
      providers: [AtrasosCdaService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(AtrasosCdaService);
  });

  afterEach(() => jest.useRealTimers());

  describe('config', () => {
    it('sin fila guardada: 08:00 con 10 min de gracia', async () => {
      expect(await service.getConfig()).toEqual({ horaEntrada: '08:00', minutosGracia: 10 });
    });

    it('guarda en el singleton id 1', async () => {
      prisma.configAsistenciaCda.upsert.mockResolvedValueOnce({ id: 1, horaEntrada: '07:30', minutosGracia: 5 });
      expect(await service.guardarConfig({ horaEntrada: '07:30', minutosGracia: 5 })).toEqual({
        horaEntrada: '07:30',
        minutosGracia: 5,
      });
      expect(prisma.configAsistenciaCda.upsert).toHaveBeenCalledWith({
        where: { id: 1 },
        create: { id: 1, horaEntrada: '07:30', minutosGracia: 5 },
        update: { horaEntrada: '07:30', minutosGracia: 5 },
      });
    });
  });

  describe('reporte', () => {
    beforeEach(() => {
      prisma.operadorCda.findMany.mockResolvedValue([
        operador('1', 'ANDRADE ANA'),
        operador('2', 'BENÍTEZ BRUNO'),
        operador('3', 'CHÁVEZ CARLA', '2026-10-21'),
      ]);
      prisma.asistenciaCda.findMany.mockResolvedValue([
        { operadorId: '1', fecha: fecha('2026-10-20'), entradaEn: ec('2026-10-20', '08:10') },
        { operadorId: '1', fecha: fecha('2026-10-21'), entradaEn: ec('2026-10-21', '08:11') },
        { operadorId: '2', fecha: fecha('2026-10-20'), entradaEn: ec('2026-10-20', '09:00') },
        // Fila creada sin entrada (p. ej. se quitó la marca): cuenta como falta.
        { operadorId: '2', fecha: fecha('2026-10-21'), entradaEn: null },
        { operadorId: '3', fecha: fecha('2026-10-21'), entradaEn: ec('2026-10-21', '07:55') },
      ]);
    });

    it('clasifica cada día, respeta la fecha de inicio y deja hoy como pendiente', async () => {
      const r = await service.reporte('2026-10-20', '2026-10-22');

      expect(r.config).toEqual({ horaEntrada: '08:00', minutosGracia: 10 });
      const estados = r.filas.map((f) => `${f.fecha} ${f.apellidosNombres} ${f.estado} ${f.minutosAtraso}`);
      expect(estados).toEqual([
        '2026-10-20 ANDRADE ANA PUNTUAL 0',
        '2026-10-20 BENÍTEZ BRUNO ATRASO 60',
        '2026-10-21 ANDRADE ANA ATRASO 11',
        '2026-10-21 BENÍTEZ BRUNO FALTA 0',
        '2026-10-21 CHÁVEZ CARLA PUNTUAL 0',
        '2026-10-22 ANDRADE ANA PENDIENTE 0',
        '2026-10-22 BENÍTEZ BRUNO PENDIENTE 0',
        '2026-10-22 CHÁVEZ CARLA PENDIENTE 0',
      ]);
      expect(r.filas[2].entrada).toBe('08:11');
      expect(r.resumen.map(({ apellidosNombres, puntuales, atrasos, faltas, minutosAtraso }) => [
        apellidosNombres, puntuales, atrasos, faltas, minutosAtraso,
      ])).toEqual([
        ['ANDRADE ANA', 1, 1, 0, 11],
        ['BENÍTEZ BRUNO', 0, 1, 1, 60],
        ['CHÁVEZ CARLA', 1, 0, 0, 0],
      ]);
      expect(r.totales).toEqual({ puntuales: 2, atrasos: 2, faltas: 1, pendientes: 3, minutosAtraso: 71 });
      expect(prisma.asistenciaCda.findMany.mock.calls[0][0].where).toEqual({
        fecha: { gte: fecha('2026-10-20'), lte: fecha('2026-10-22') },
      });
    });

    it('usa la hora y la gracia configuradas', async () => {
      prisma.configAsistenciaCda.findUnique.mockResolvedValueOnce({ id: 1, horaEntrada: '08:30', minutosGracia: 0 });
      const r = await service.reporte('2026-10-20', '2026-10-20');
      expect(r.filas.map((f) => f.estado)).toEqual(['PUNTUAL', 'ATRASO']);
      expect(r.filas[1].minutosAtraso).toBe(30);
    });

    it('rechaza rangos inválidos, invertidos, muy largos o futuros', async () => {
      await expect(service.reporte(undefined, '2026-10-22')).rejects.toThrow(BadRequestException);
      await expect(service.reporte('2026-10-22', '2026-10-01')).rejects.toThrow('posterior');
      await expect(service.reporte('2026-01-01', '2026-10-22')).rejects.toThrow('demasiado largo');
      await expect(service.reporte('2026-10-22', '2026-10-23')).rejects.toThrow('futura');
    });
  });

  describe('exportar', () => {
    const DATOS = FILA_ENCABEZADOS_EXCEL + 1;
    const leer = async (contenido: Buffer) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(contenido as never);
      return wb;
    };

    beforeEach(() => {
      prisma.operadorCda.findMany.mockResolvedValue([operador('1', 'ANDRADE ANA')]);
      prisma.asistenciaCda.findMany.mockResolvedValue([
        { operadorId: '1', fecha: fecha('2026-10-21'), entradaEn: ec('2026-10-21', '08:25') },
      ]);
    });

    it('general: el Excel trae logo, la regla, el resumen y el detalle', async () => {
      const archivo = await service.exportar('2026-10-20', '2026-10-21', 'GENERAL', 'xlsx');

      expect(archivo.nombre).toBe('atrasos_operadores_cda_2026-10-20_2026-10-21.xlsx');
      const wb = await leer(archivo.contenido);
      expect(wb.worksheets.map((w) => w.name)).toEqual(['Resumen', 'Detalle']);
      expect(wb.model.media).toHaveLength(1);

      const resumen = wb.getWorksheet('Resumen')!;
      expect(resumen.getImages()).toHaveLength(1);
      expect(String(resumen.getCell('A7').value)).toContain('Hora de entrada 08:00 · gracia 10 min · del 20/10/2026 al 21/10/2026');
      expect(resumen.getRow(DATOS).values).toEqual([undefined, 'ANDRADE ANA', '1700000001', 0, 1, 1, 25]);

      const detalle = wb.getWorksheet('Detalle')!;
      expect(detalle.getRow(DATOS).values).toEqual([undefined, '2026-10-20', 'ANDRADE ANA', '1700000001', '08:00', '', '', 'Falta']);
      expect(detalle.getRow(DATOS + 1).values).toEqual([
        undefined, '2026-10-21', 'ANDRADE ANA', '1700000001', '08:00', '08:25', 25, 'Atraso',
      ]);
    });

    it('por día: el resumen y luego una hoja por día con su conteo', async () => {
      const archivo = await service.exportar('2026-10-20', '2026-10-22', 'POR_DIA', 'xlsx');

      expect(archivo.nombre).toBe('atrasos_operadores_cda_2026-10-20_2026-10-22_por_dia.xlsx');
      const wb = await leer(archivo.contenido);
      expect(wb.worksheets.map((w) => w.name)).toEqual(['Resumen', '2026-10-20', '2026-10-21', '2026-10-22']);
      const dia21 = wb.getWorksheet('2026-10-21')!;
      expect(dia21.getCell('A6').value).toBe('miércoles, 21 de octubre de 2026 · 0 puntuales · 1 atraso · 0 faltas');
      expect(dia21.getRow(DATOS).values).toEqual([undefined, 'ANDRADE ANA', '1700000001', '08:00', '08:25', 25, 'Atraso']);
      // Hoy (22) dentro de la gracia: aparece el pendiente.
      expect(wb.getWorksheet('2026-10-22')!.getCell('A6').value).toContain('1 pendiente');
    });

    it('PDF: general y por día', async () => {
      for (const modo of ['GENERAL', 'POR_DIA']) {
        const archivo = await service.exportar('2026-10-20', '2026-10-21', modo, 'pdf');
        expect(archivo.tipo).toBe('application/pdf');
        expect(archivo.contenido.subarray(0, 5).toString()).toBe('%PDF-');
      }
    });

    it('rechaza un modo desconocido', async () => {
      await expect(service.exportar('2026-10-20', '2026-10-21', 'MENSUAL', 'xlsx')).rejects.toThrow(BadRequestException);
    });
  });
});
