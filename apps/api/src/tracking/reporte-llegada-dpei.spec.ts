import * as ExcelJS from 'exceljs';

import type { Jornada, UnidadJornada } from '../enlaces/jornada/jornada';
import { generarReporte } from '../operadores-cda/reporte-cda';
import { duracionTexto, horaConDia, registroLlegadaTexto as registroTexto } from '@cne/shared-validation';
import { archivoLlegadaDpei, llegadasPorCda, reporteLlegadaDpei, resumenLlegadas } from './reporte-llegada-dpei';
import { ReporteLlegadaDpeiService } from './reporte-llegada-dpei.service';

const T = (iso: string) => new Date(iso);
const reg = (iso: string, extra: object = {}) => ({ en: T(iso), sinSenal: false, ...extra });

function unidad(operadorId: string, codigo: string, o: Partial<UnidadJornada> = {}): UnidadJornada {
  return {
    operadorId,
    codigoRecinto: codigo,
    nombreRecinto: `Recinto ${codigo}`,
    tecnico: { numero: 1, nombre: 'Isidro' },
    canton: { codigo: 30, nombre: 'IBARRA' },
    personas: [
      { nombre: `Op ${operadorId}`, telefono: null, rol: 'Op.' },
      { nombre: `Asis ${operadorId}`, telefono: null, rol: 'Asis.' },
    ],
    registros: {},
    kitRecibido: null,
    kitEscaneado: null,
    actas: null,
    tiempoViajeMin: null,
    ultimoGps: null,
    kits: [`K-${operadorId}`],
    ...o,
  };
}

const jornada = (unidades: UnidadJornada[]): Jornada => ({
  eventoId: 'ev',
  evento: 'Elecciones 2027',
  unidades,
  noCdas: [],
  sinKit: [],
  sinDistributivo: false,
});

// Noche del 29-nov (hora de Ecuador = UTC-5): 21:00 = 02:00Z del 30.
const SALE_2100 = '2026-11-30T02:00:00Z';
const SALE_2030 = '2026-11-30T01:30:00Z';
const LLEGA_2200 = '2026-11-30T03:00:00Z';
const LLEGA_0210 = '2026-11-30T07:10:00Z';

describe('llegadasPorCda', () => {
  it('un CDA con dos parejas: primera salida y llegada de la última; falta mientras una no llegue', () => {
    const a = unidad('a', 'C1', { registros: { SALIDA_RECINTO: reg(SALE_2100), LLEGADA_DPI: reg(LLEGA_2200) } });
    const b = unidad('b', 'C1', { registros: { SALIDA_RECINTO: reg(SALE_2030) } });
    const [fila] = llegadasPorCda(jornada([a, b]));
    expect(fila).toMatchObject({
      codigoRecinto: 'C1',
      operadores: ['Op a', 'Op b'],
      kits: ['K-a', 'K-b'],
      parejas: 2,
      parejasLlegadas: 1,
      salidaRecintoEn: T(SALE_2030).toISOString(),
      llegadaDpiEn: null,
      duracionMin: null,
    });

    const bLlego = unidad('b', 'C1', { registros: { SALIDA_RECINTO: reg(SALE_2030), LLEGADA_DPI: reg(LLEGA_0210) } });
    const [completo] = llegadasPorCda(jornada([a, bLlego]));
    expect(completo.llegadaDpiEn).toBe(T(LLEGA_0210).toISOString());
    // De las 20:30 a las 02:10 del día siguiente.
    expect(completo.duracionMin).toBe(340);
  });

  it('la recepción del kit en la DPEI vale como llegada (igual que el bot) y se marca "por kit"', () => {
    const u = unidad('a', 'C1', { registros: { SALIDA_RECINTO: reg(SALE_2100) }, kitRecibido: T(LLEGA_2200) });
    const [fila] = llegadasPorCda(jornada([u]));
    expect(fila).toMatchObject({ llegadaDpiEn: T(LLEGA_2200).toISOString(), porKit: true, manual: false, duracionMin: 60 });
    expect(registroTexto(fila)).toBe('Por kit');
  });

  it('una llegada registrada por el administrador se marca "manual"', () => {
    const u = unidad('a', 'C1', { registros: { SALIDA_RECINTO: reg(SALE_2100), LLEGADA_DPI: reg(LLEGA_2200, { manual: true }) } });
    const [fila] = llegadasPorCda(jornada([u]));
    expect(fila).toMatchObject({ manual: true, porKit: false });
    expect(registroTexto(fila)).toBe('Manual (administrador)');
  });

  it('primero los que faltan (por hora de salida, sin salida al final) y luego los que llegaron por hora de llegada', () => {
    const filas = llegadasPorCda(
      jornada([
        unidad('1', 'C1', { registros: { SALIDA_RECINTO: reg(SALE_2100), LLEGADA_DPI: reg(LLEGA_0210) } }),
        unidad('2', 'C2', { registros: {} }),
        unidad('3', 'C3', { registros: { SALIDA_RECINTO: reg(SALE_2100) } }),
        unidad('4', 'C4', { registros: { SALIDA_RECINTO: reg(SALE_2030), LLEGADA_DPI: reg(LLEGA_2200) } }),
        unidad('5', 'C5', { registros: { SALIDA_RECINTO: reg(SALE_2030) } }),
      ]),
    );
    expect(filas.map((f) => f.codigoRecinto)).toEqual(['C5', 'C3', 'C2', 'C4', 'C1']);
  });
});

describe('resumenLlegadas', () => {
  it('cuenta llegados y faltantes, primera y última llegada y duración promedio', () => {
    const cdas = llegadasPorCda(
      jornada([
        unidad('1', 'C1', { registros: { SALIDA_RECINTO: reg(SALE_2100), LLEGADA_DPI: reg(LLEGA_2200) } }),
        unidad('2', 'C2', { registros: { SALIDA_RECINTO: reg(SALE_2100), LLEGADA_DPI: reg(LLEGA_0210) } }),
        unidad('3', 'C3', { registros: {} }),
      ]),
    );
    expect(resumenLlegadas(cdas)).toEqual({
      total: 3,
      llegaron: 2,
      faltan: 1,
      primeraLlegadaEn: T(LLEGA_2200).toISOString(),
      ultimaLlegadaEn: T(LLEGA_0210).toISOString(),
      duracionPromedioMin: Math.round((60 + 310) / 2),
    });
  });

  it('sin llegadas: nulos', () => {
    expect(resumenLlegadas([])).toEqual({
      total: 0,
      llegaron: 0,
      faltan: 0,
      primeraLlegadaEn: null,
      ultimaLlegadaEn: null,
      duracionPromedioMin: null,
    });
  });
});

describe('formato', () => {
  it('hora con el día en hora de Ecuador (la noche cruza la medianoche)', () => {
    expect(horaConDia(LLEGA_0210)).toBe('30/11 02:10');
    expect(horaConDia(SALE_2100)).toBe('29/11 21:00');
    expect(horaConDia(null)).toBe('—');
  });

  it('duración en horas y minutos', () => {
    expect(duracionTexto(95)).toBe('1 h 35 min');
    expect(duracionTexto(40)).toBe('40 min');
    expect(duracionTexto(null)).toBe('—');
  });
});

describe('archivoLlegadaDpei', () => {
  const r = reporteLlegadaDpei(
    jornada([
      unidad('1', 'C1', { registros: { SALIDA_RECINTO: reg(SALE_2100), LLEGADA_DPI: reg(LLEGA_2200) } }),
      unidad('2', 'C2', { registros: { SALIDA_RECINTO: reg(SALE_2030) } }),
    ]),
    '2026-11-29',
  );

  it('una fila por CDA, los que faltan resaltados y el resumen como anexo', () => {
    const a = archivoLlegadaDpei(r);
    const [t] = a.tablas;
    expect(a.detalle).toContain('Jornada del 29/11/2026 · Llegaron 1 de 2 CDA · Faltan 1');
    expect(t.filas[0]).toEqual([1, 'IBARRA', 'C2', 'Recinto C2', 'Op 2', 'K-2', '0 de 1', '29/11 20:30', 'Falta', '—', '—']);
    expect(t.filas[1]).toEqual([2, 'IBARRA', 'C1', 'Recinto C1', 'Op 1', 'K-1', '1 de 1', '29/11 21:00', '29/11 22:00', '1 h 0 min', 'App']);
    expect(t.resaltadas).toEqual([0]);
    expect(t.anexo?.filas).toContainEqual(['Faltan', 1]);
  });

  it('genera el Excel con el nombre del día', async () => {
    const archivo = await generarReporte(archivoLlegadaDpei(r), 'xlsx');
    expect(archivo.nombre).toBe('llegada_dpei_cdas_2026-11-29.xlsx');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(archivo.contenido as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Llegada a la DPEI']);
  });

  it('genera el PDF', async () => {
    const archivo = await generarReporte(archivoLlegadaDpei(r), 'pdf');
    expect(archivo.tipo).toBe('application/pdf');
    expect(archivo.contenido.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('ReporteLlegadaDpeiService', () => {
  const cargarDia = jest.fn();
  const service = new ReporteLlegadaDpeiService({ cargarDia } as never);
  beforeEach(() => cargarDia.mockReset());

  it('sin fecha usa el día de jornada actual (a las 02:00 sigue siendo la noche anterior)', async () => {
    cargarDia.mockResolvedValue(jornada([]));
    const ahora = T(LLEGA_0210).getTime();
    const r = await service.reporte(undefined, ahora);
    expect(cargarDia).toHaveBeenCalledWith('2026-11-29', ahora);
    expect(r?.fecha).toBe('2026-11-29');
  });

  it('con fecha pide esa jornada', async () => {
    cargarDia.mockResolvedValue(jornada([]));
    await service.reporte('2026-11-15');
    expect(cargarDia).toHaveBeenCalledWith('2026-11-15', expect.any(Number));
  });

  it('una jornada que todavía no empieza: 400 sin consultar', async () => {
    await expect(service.reporte('2026-11-30', T(LLEGA_0210).getTime())).rejects.toThrow('La jornada elegida todavía no empieza');
    expect(cargarDia).not.toHaveBeenCalled();
  });

  it('sin evento activo: null en pantalla y 404 al descargar', async () => {
    cargarDia.mockResolvedValue(null);
    await expect(service.reporte()).resolves.toBeNull();
    await expect(service.exportar(undefined, 'xlsx')).rejects.toThrow('No hay un evento activo');
  });
});
