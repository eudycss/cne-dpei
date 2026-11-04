import * as ExcelJS from 'exceljs';

import { type ParejaBase, type PersonaBase, type RecintoBase, armarHistorial, reporteHistorial } from './historial-parejas-cda';
import { HistorialParejasCdaService } from './historial-parejas-cda.service';
import { parsearFechas } from './historial-parejas-cda.controller';
import { generarReporte } from './reporte-cda';

const persona = (nombre: string, grupo = 'OPERADOR', extra: Partial<PersonaBase> = {}): PersonaBase => ({
  id: nombre,
  apellidosNombres: nombre,
  cedula: '1000000001',
  grupo,
  dispositivo: 'ANDROID',
  activo: true,
  ...extra,
});
const recinto = (codigo: string, canton = 'IBARRA'): RecintoBase => ({
  id: `r-${codigo}`,
  codigoRecinto: codigo,
  nombre: `Recinto ${codigo}`,
  canton: { nombre: canton },
});
const deVisita = (p: PersonaBase, usuarioId: string | null = null) => ({ ...p, usuarioId });

const ANA = persona('ANA', 'OPERADOR');
const BETO = persona('BETO', 'ASISTENTE', { dispositivo: 'IPHONE' });
const CARLA = persona('CARLA', 'OPERADOR', { dispositivo: null });
const DIEGO = persona('DIEGO', 'ASISTENTE');
const R1 = recinto('1133');
const R2 = recinto('971', 'COTACACHI');
const R3 = recinto('1198');

const PAREJAS: ParejaBase[] = [
  {
    fecha: '2026-11-01',
    recinto: R1,
    operador: deVisita(ANA, 'u-ana'),
    asistente: deVisita(BETO, 'u-beto'),
    kit: { codigoUnico: 'KIT-B', operadorId: 'u-ana' },
  },
  { fecha: '2026-10-28', recinto: R1, operador: deVisita(ANA, 'u-ana'), asistente: null, kit: { codigoUnico: 'KIT-A', operadorId: 'otro' } },
  { fecha: '2026-10-28', recinto: R2, operador: deVisita(CARLA), asistente: deVisita(BETO, 'u-beto'), kit: null },
];

describe('historial de parejas CDA', () => {
  const h = armarHistorial(['2026-10-28', '2026-11-01'], [ANA, BETO, CARLA, DIEGO], [R1, R2, R3], PAREJAS);
  const p = (id: string) => h.personas.find((x) => x.id === id)!;
  const r = (codigo: string) => h.recintos.find((x) => x.codigo === codigo)!;

  it('"fue" = estuvo en una pareja en alguna fecha elegida (sin repetir fechas ni recintos)', () => {
    expect(p('ANA')).toMatchObject({ fechas: ['2026-10-28', '2026-11-01'], recintos: ['1133 · Recinto 1133'] });
    expect(p('BETO').fechas).toEqual(['2026-10-28', '2026-11-01']);
    expect(p('BETO').recintos).toEqual(['971 · Recinto 971', '1133 · Recinto 1133']);
    expect(p('DIEGO')).toMatchObject({ fechas: [], recintos: [] });
    expect(p('CARLA').dispositivo).toBeNull();
  });

  it('cada recinto con sus visitas en orden de fecha; el no visitado queda sin visitas', () => {
    expect(r('1133').visitas.map((v) => v.fecha)).toEqual(['2026-10-28', '2026-11-01']);
    expect(r('1198').visitas).toEqual([]);
    expect(r('971')).toMatchObject({ canton: 'COTACACHI', visitas: [{ operador: 'CARLA', asistente: 'BETO', kitCodigo: null }] });
  });

  it('"lleva el kit" solo si la cuenta que lo tiene es de la pareja', () => {
    expect(r('1133').visitas.map((v) => [v.kitCodigo, v.llevaKit])).toEqual([
      ['KIT-A', null],
      ['KIT-B', 'ANA'],
    ]);
  });

  it('ordena recintos por código numérico y personas por nombre', () => {
    expect(h.recintos.map((x) => x.codigo)).toEqual(['971', '1133', '1198']);
    expect(h.personas.map((x) => x.id)).toEqual(['ANA', 'BETO', 'CARLA', 'DIEGO']);
  });

  it('quien hoy está oculto pero fue aparece igual (marcado como no activo)', () => {
    const oculto = persona('ZOE', 'ASISTENTE', { activo: false });
    const h2 = armarHistorial(
      ['2026-10-28'],
      [ANA],
      [R1],
      [{ fecha: '2026-10-28', recinto: R2, operador: deVisita(ANA), asistente: deVisita(oculto), kit: null }],
    );
    expect(h2.personas.find((x) => x.id === 'ZOE')).toMatchObject({ activo: false, fechas: ['2026-10-28'] });
    expect(h2.recintos.map((x) => x.codigo)).toEqual(['971', '1133']);
  });

  describe('reporte', () => {
    const rep = reporteHistorial(h);
    const tabla = (hoja: string) => rep.tablas.find((t) => t.hoja === hoja)!;

    it('tres hojas: personal, recintos y kits; resalta a quien no fue y al recinto no visitado', () => {
      expect(rep.tablas.map((t) => t.hoja)).toEqual(['Personal', 'Recintos', 'Kits']);
      expect(rep.detalle).toContain('28/10/2026, 01/11/2026');
      const personal = tabla('Personal');
      expect(personal.filas.map((f) => [f[1], f[5]])).toEqual([
        ['ANA', 'Sí'],
        ['BETO', 'Sí'],
        ['CARLA', 'Sí'],
        ['DIEGO', 'No'],
      ]);
      expect(personal.resaltadas).toEqual([3]);
      expect(personal.filas[2][4]).toBe('Sin registrar');
      expect(personal.anexo!.filas).toEqual(
        expect.arrayContaining([
          ['No fueron', 1],
          ['Asistentes CDA que no fueron', 1],
          ['Operadores CDA que no fueron', 0],
        ]),
      );
      expect(tabla('Recintos').resaltadas).toEqual([2]);
    });

    it('kits: una fila por visita, ordenadas por fecha, con "Sin kit" resaltado', () => {
      const kits = tabla('Kits');
      expect(kits.filas.map((f) => [f[1], f[2], f[4], f[7]])).toEqual([
        ['28/10/2026', '971', 'Sin kit', '—'],
        ['28/10/2026', '1133', 'KIT-A', '—'],
        ['01/11/2026', '1133', 'KIT-B', 'ANA'],
      ]);
      expect(kits.resaltadas).toEqual([0]);
    });

    it('sin parejas, la hoja de kits lo dice', () => {
      const vacio = reporteHistorial(armarHistorial(['2026-12-01'], [ANA], [R1], []));
      expect(vacio.tablas[2].filas).toEqual([['', '', '', 'No hay parejas en las fechas elegidas', '', '', '', '']]);
    });

    it('genera el Excel con las tres hojas', async () => {
      const a = await generarReporte(rep, 'xlsx');
      expect(a.nombre).toBe('historial_parejas_cda_2026-10-28_2026-11-01.xlsx');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(a.contenido as never);
      expect(wb.worksheets.map((w) => w.name)).toEqual(['Personal', 'Recintos', 'Kits']);
    });

    it('el PDF sale aunque las fechas estén a más de 31 días', async () => {
      const lejos = reporteHistorial(armarHistorial(['2026-10-28', '2026-12-20'], [ANA], [R1], []));
      const a = await generarReporte(lejos, 'pdf');
      expect(a.contenido.subarray(0, 4).toString()).toBe('%PDF');
    });

    it('genera el PDF', async () => {
      const a = await generarReporte(rep, 'pdf');
      expect(a.contenido.subarray(0, 4).toString()).toBe('%PDF');
    });
  });
});

describe('?fechas= del historial', () => {
  it('acepta una o varias y las ordena sin repetir', () => {
    expect(parsearFechas(['2026-11-01', '2026-10-28', '2026-10-28'])).toEqual(['2026-10-28', '2026-11-01']);
  });

  it.each([undefined, '', 'ayer', ['2026-13-01']])('rechaza %p con 400', (v) => {
    expect(() => parsearFechas(v)).toThrow(/fecha/i);
  });
});

describe('HistorialParejasCdaService', () => {
  it('lee los activos de hoy y solo las parejas de las fechas elegidas', async () => {
    const prisma = {
      operadorCda: { findMany: jest.fn().mockResolvedValue([DIEGO]) },
      recinto: { findMany: jest.fn().mockResolvedValue([R3]) },
      parejaCda: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ fecha: new Date('2026-10-28T00:00:00Z'), recinto: R1, operador: deVisita(ANA), asistente: null, kit: null }]),
      },
    };
    const h = await new HistorialParejasCdaService(prisma as never).historial(['2026-10-28']);

    expect(prisma.operadorCda.findMany.mock.calls[0][0].where).toEqual({ grupo: { in: ['OPERADOR', 'ASISTENTE'] }, activo: true });
    expect(prisma.recinto.findMany.mock.calls[0][0].where).toEqual({ tipo: 'CDA', activo: true });
    expect(prisma.parejaCda.findMany.mock.calls[0][0].where).toEqual({ fecha: { in: [new Date('2026-10-28T00:00:00Z')] }, recintoId: { not: null } });
    // Ningún select trae teléfonos.
    expect(JSON.stringify(prisma.parejaCda.findMany.mock.calls[0][0].select)).not.toContain('telefono');
    expect(h.personas.map((x) => [x.id, x.fechas])).toEqual([
      ['ANA', ['2026-10-28']],
      ['DIEGO', []],
    ]);
    expect(h.recintos.map((x) => x.codigo)).toEqual(['1133', '1198']);
  });
});
