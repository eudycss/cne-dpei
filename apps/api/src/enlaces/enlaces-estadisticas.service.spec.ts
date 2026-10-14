import { BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { EstadisticasEnlacesResponse } from '@cne/shared-types';
import { ROLES_KEY } from '../common/roles.decorator';
import { EnlacesController } from './enlaces.controller';
import {
  calcularEstadisticas,
  EnlacesEstadisticasService,
  filtroEstadisticas,
  parsearFecha,
  rangoPeriodo,
} from './enlaces-estadisticas.service';
import { formatearDuracion, formatearEstadisticas } from './telegram-notifier';

const iso = (s: string) => new Date(s);
// Medianoche de Ecuador = 05:00 UTC.
const DIA_14 = { desde: iso('2026-10-14T05:00:00Z'), hasta: iso('2026-10-15T05:00:00Z') };

describe('rangoPeriodo (hora de Ecuador)', () => {
  it('día: de medianoche a medianoche de Ecuador', () => {
    expect(rangoPeriodo('dia', [2026, 9, 14])).toEqual(DIA_14);
  });

  it('semana: de lunes a lunes, aunque la fecha sea domingo', () => {
    // 18-oct-2026 es domingo → semana del lunes 12 al lunes 19.
    expect(rangoPeriodo('semana', [2026, 9, 18])).toEqual({
      desde: iso('2026-10-12T05:00:00Z'),
      hasta: iso('2026-10-19T05:00:00Z'),
    });
  });

  it('mes: del día 1 al día 1 del mes siguiente (también en diciembre)', () => {
    expect(rangoPeriodo('mes', [2026, 11, 20])).toEqual({
      desde: iso('2026-12-01T05:00:00Z'),
      hasta: iso('2027-01-01T05:00:00Z'),
    });
  });
});

describe('filtroEstadisticas', () => {
  it('por defecto es el día de hoy en Ecuador (a las 23:00 del 14 en Ecuador ya es 15 en UTC)', () => {
    expect(filtroEstadisticas(undefined, undefined, iso('2026-10-15T04:00:00Z'))).toEqual({
      periodo: 'dia',
      dia: [2026, 9, 14],
    });
  });

  it('acepta periodo y fecha válidos', () => {
    expect(filtroEstadisticas('mes', '2026-09-30')).toEqual({ periodo: 'mes', dia: [2026, 8, 30] });
  });

  it.each([
    ['anio', undefined],
    [['dia'], undefined],
    ['dia', '2026-02-30'],
    ['dia', '14/10/2026'],
    ['dia', ['2026-10-14']],
  ])('rechaza periodo=%p fecha=%p con 400', (periodo, fecha) => {
    expect(() => filtroEstadisticas(periodo, fecha)).toThrow(BadRequestException);
  });

  it('parsearFecha descarta fechas que no existen', () => {
    expect(parsearFecha('2026-02-29')).toBeNull();
    expect(parsearFecha('2028-02-29')).toEqual([2028, 1, 29]);
  });
});

describe('calcularEstadisticas', () => {
  const recintos = [
    { codigoRecinto: '28', nombreRecinto: 'UE Ibarra', canton: 'Ibarra' },
    { codigoRecinto: '1207', nombreRecinto: 'Escuela Guallupe', canton: 'Cotacachi' },
    { codigoRecinto: '96', nombreRecinto: 'UE Sánchez y Cifuentes', canton: 'Ibarra' },
  ];
  const caida = (codigo: string, inicio: string, fin: string | null) => ({
    codigoRecinto: codigo,
    nombreRecinto: recintos.find((r) => r.codigoRecinto === codigo)?.nombreRecinto ?? 'Otro',
    canton: 'Ibarra',
    inicio: iso(inicio),
    fin: fin ? iso(fin) : null,
  });
  const historialAntiguo = iso('2026-01-01T00:00:00Z');
  const finDelDia = iso('2026-10-15T05:00:00Z');

  it('cuenta caídas y minutos, ordena de más a menos caídas y lista los que no se cayeron', () => {
    const r = calcularEstadisticas(
      [
        caida('1207', '2026-10-14T13:00:00Z', '2026-10-14T13:30:00Z'),
        caida('1207', '2026-10-14T15:00:00Z', '2026-10-14T15:10:00Z'),
        caida('28', '2026-10-14T10:00:00Z', '2026-10-14T12:00:00Z'),
      ],
      recintos,
      DIA_14,
      historialAntiguo,
      finDelDia,
    );

    expect(r.ranking.map((e) => [e.codigoRecinto, e.caidas, e.minutosCaido])).toEqual([
      ['1207', 2, 40],
      ['28', 1, 120],
    ]);
    // 40 min de 1440 → 97,2 %.
    expect(r.ranking[0].disponibilidad).toBe(97.2);
    expect(r.sinCaidas.map((s) => s.codigoRecinto)).toEqual(['96']);
    expect(r.totalRecintos).toBe(3);
    expect(r.datosParciales).toBe(false);
  });

  it('una caída que viene de antes suma minutos pero no cuenta como caída del período', () => {
    const r = calcularEstadisticas(
      [caida('28', '2026-10-13T20:00:00Z', '2026-10-14T06:00:00Z')],
      recintos,
      DIA_14,
      historialAntiguo,
      finDelDia,
    );

    expect(r.ranking[0]).toEqual(expect.objectContaining({ codigoRecinto: '28', caidas: 0, minutosCaido: 60 }));
  });

  it('una caída abierta cuenta hasta ahora y queda marcada como "sigue caído"', () => {
    const ahora = iso('2026-10-14T17:00:00Z');
    const r = calcularEstadisticas(
      [caida('96', '2026-10-14T16:00:00Z', null)],
      recintos,
      DIA_14,
      historialAntiguo,
      ahora,
    );

    expect(r.ranking[0]).toEqual(
      expect.objectContaining({ codigoRecinto: '96', caidas: 1, minutosCaido: 60, sigueCaido: true }),
    );
    // Observado: 05:00→17:00 = 12 h; 1 h caído → 91,7 %.
    expect(r.ranking[0].disponibilidad).toBe(91.7);
  });

  it('si el historial empezó después del inicio del período, avisa datos parciales', () => {
    const r = calcularEstadisticas([], recintos, DIA_14, iso('2026-10-14T15:00:00Z'), finDelDia);

    expect(r.datosParciales).toBe(true);
    expect(r.sinCaidas).toHaveLength(3);
    expect(r.ranking).toEqual([]);
  });

  it('bordes exactos: una caída que termina justo al empezar o empieza justo al terminar no cuenta', () => {
    const r = calcularEstadisticas(
      [
        caida('28', '2026-10-14T03:00:00Z', '2026-10-14T05:00:00Z'),
        caida('96', '2026-10-15T05:00:00Z', '2026-10-15T06:00:00Z'),
      ],
      recintos,
      DIA_14,
      historialAntiguo,
      iso('2026-10-16T00:00:00Z'),
    );

    expect(r.ranking).toEqual([]);
    expect(r.sinCaidas).toHaveLength(3);
  });

  it('una caída que cruza el final del período solo suma lo que cae dentro', () => {
    const r = calcularEstadisticas(
      [caida('28', '2026-10-15T04:30:00Z', '2026-10-15T06:00:00Z')],
      recintos,
      DIA_14,
      historialAntiguo,
      iso('2026-10-16T00:00:00Z'),
    );

    expect(r.ranking[0]).toEqual(expect.objectContaining({ caidas: 1, minutosCaido: 30, sigueCaido: false }));
  });

  it('un período que todavía no empieza no tiene tiempo observado', () => {
    const r = calcularEstadisticas([], recintos, DIA_14, historialAntiguo, iso('2026-10-13T00:00:00Z'));

    expect(r.ranking).toEqual([]);
    expect(r.sinCaidas).toHaveLength(3);
  });

  it('un recinto que ya salió de la hoja igual aparece en el ranking con su nombre guardado', () => {
    const r = calcularEstadisticas(
      [caida('999', '2026-10-14T13:00:00Z', '2026-10-14T13:05:00Z')],
      recintos,
      DIA_14,
      historialAntiguo,
      finDelDia,
    );

    expect(r.ranking[0]).toEqual(expect.objectContaining({ codigoRecinto: '999', nombreRecinto: 'Otro' }));
    expect(r.sinCaidas).toHaveLength(3);
  });
});

describe('EnlacesEstadisticasService', () => {
  const prisma = {
    enlaceCaida: { findMany: jest.fn().mockResolvedValue([]) },
    enlaceRecinto: { findMany: jest.fn().mockResolvedValue([]) },
    configEnlaces: { findUnique: jest.fn().mockResolvedValue({ historialDesde: iso('2026-01-01T00:00:00Z') }) },
  };
  const telegram = { enviarEstadisticas: jest.fn().mockResolvedValue(undefined) };
  const service = new EnlacesEstadisticasService(prisma as never, telegram as never);

  beforeEach(() => jest.clearAllMocks());
  afterEach(() => delete process.env.ENLACES_CRON_ENABLED);

  it('busca solo las caídas que se solapan con el período', async () => {
    const r = await service.estadisticas('dia', [2026, 9, 14], finDelDiaServicio());

    expect(prisma.enlaceCaida.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { inicio: { lt: DIA_14.hasta }, OR: [{ fin: null }, { fin: { gt: DIA_14.desde } }] },
      }),
    );
    expect(r).toEqual(expect.objectContaining({ periodo: 'dia', desde: DIA_14.desde.toISOString() }));
  });

  it('el botón manda hoy, esta semana y este mes', async () => {
    await service.enviarEstadisticasTelegram(iso('2026-10-14T15:00:00Z'));

    const [, secciones] = telegram.enviarEstadisticas.mock.calls[0];
    expect(secciones.map((s: { titulo: string; stats: EstadisticasEnlacesResponse }) => [s.titulo, s.stats.periodo])).toEqual([
      ['Hoy', 'dia'],
      ['Esta semana', 'semana'],
      ['Este mes', 'mes'],
    ]);
  });

  it.each([
    ['un miércoles: solo ayer', '2026-10-14T13:00:00Z', ['Ayer']],
    ['un lunes: ayer y la semana pasada', '2026-10-19T13:00:00Z', ['Ayer', 'Semana pasada']],
    ['el día 1: ayer y el mes pasado', '2026-10-01T13:00:00Z', ['Ayer', 'Mes pasado']],
  ])('resumen programado %s', async (_caso, ahora, titulos) => {
    await service.enviarResumenProgramado(iso(ahora));

    const [, secciones] = telegram.enviarEstadisticas.mock.calls[0];
    expect(secciones.map((s: { titulo: string }) => s.titulo)).toEqual(titulos);
  });

  it('el resumen de la semana pasada cubre de lunes a domingo anteriores', async () => {
    await service.enviarResumenProgramado(iso('2026-10-19T13:00:00Z'));

    const [, secciones] = telegram.enviarEstadisticas.mock.calls[0];
    expect(secciones[1].stats.desde).toBe('2026-10-12T05:00:00.000Z');
    expect(secciones[1].stats.hasta).toBe('2026-10-19T05:00:00.000Z');
  });

  it('el resumen no se manda con ENLACES_CRON_ENABLED=false (API local)', async () => {
    process.env.ENLACES_CRON_ENABLED = 'false';

    await service.enviarResumenProgramado(iso('2026-10-14T13:00:00Z'));

    expect(telegram.enviarEstadisticas).not.toHaveBeenCalled();
  });

  it('un error al armar el resumen no lanza', async () => {
    prisma.enlaceCaida.findMany.mockRejectedValueOnce(new Error('base caída'));

    await expect(service.enviarResumenProgramado(iso('2026-10-14T13:00:00Z'))).resolves.toBeUndefined();
    expect(telegram.enviarEstadisticas).not.toHaveBeenCalled();
  });

  function finDelDiaServicio() {
    return iso('2026-10-15T05:00:00Z');
  }
});

describe('formato para Telegram', () => {
  it.each([
    [0, '0 min'],
    [45, '45 min'],
    [60, '1 h'],
    [75, '1 h 15 min'],
    [1440, '1 d'],
    [3000, '2 d 2 h'],
  ])('formatearDuracion(%i) → %s', (min, texto) => {
    expect(formatearDuracion(min)).toBe(texto);
  });

  const stats = (ranking: EstadisticasEnlacesResponse['ranking'], over: Partial<EstadisticasEnlacesResponse> = {}) =>
    ({
      periodo: 'dia',
      desde: '2026-10-14T05:00:00.000Z',
      hasta: '2026-10-15T05:00:00.000Z',
      historialDesde: '2026-01-01T00:00:00.000Z',
      datosParciales: false,
      totalRecintos: 56,
      ranking,
      sinCaidas: Array.from({ length: 56 - ranking.length }, (_, i) => ({
        codigoRecinto: String(i),
        nombreRecinto: 'x',
        canton: '',
      })),
      ...over,
    }) as EstadisticasEnlacesResponse;
  const item = (codigo: string, nombre: string, caidas: number, minutos: number, sigueCaido = false) => ({
    codigoRecinto: codigo,
    nombreRecinto: nombre,
    canton: 'Cotacachi',
    caidas,
    minutosCaido: minutos,
    disponibilidad: 99,
    sigueCaido,
  });

  it('arma el período con totales, el top numerado y escapa el HTML de la hoja', () => {
    const texto = formatearEstadisticas('📊 Estadísticas', [
      { titulo: 'Hoy', stats: stats([item('1207', 'Escuela <Guallupe> & Co', 2, 75, true), item('28', 'UE Ibarra', 1, 10)]) },
    ]);

    expect(texto).toContain('<b>Hoy</b> (14/10): 3 caídas · 54 de 56 sin caídas');
    expect(texto).toContain('1. 1207 (Cot) — Escuela &lt;Guallupe&gt; &amp; Co · 2 caídas · 1 h 15 min 🔴');
    expect(texto).toContain('2. 28 (Cot) — UE Ibarra · 1 caída · 10 min');
  });

  it('avisa datos parciales y corta el top en 10', () => {
    const muchos = Array.from({ length: 12 }, (_, i) => item(String(100 + i), 'Recinto', 1, 5));
    const texto = formatearEstadisticas('x', [
      { titulo: 'Esta semana', stats: stats(muchos, { periodo: 'semana', hasta: '2026-10-19T05:00:00.000Z', datosParciales: true, historialDesde: '2026-10-14T15:00:00.000Z' }) },
    ]);

    expect(texto).toContain('(14/10–18/10)');
    expect(texto).toContain('<i>Datos desde 14/10</i>');
    expect(texto).toContain('10. 109');
    expect(texto).not.toContain('11. 110');
    expect(texto).toContain('… y 2 más');
  });

  it('una caída que venía del período anterior dice "venía caído" en vez de "0 caídas"', () => {
    const texto = formatearEstadisticas('x', [{ titulo: 'Hoy', stats: stats([item('28', 'UE Ibarra', 0, 300)]) }]);

    expect(texto).toContain('1. 28 (Cot) — UE Ibarra · venía caído · 5 h');
  });

  it('recorta nombres largos sin partir un emoji', () => {
    const nombre = 'A'.repeat(43) + '😀😀😀';
    const texto = formatearEstadisticas('x', [{ titulo: 'Hoy', stats: stats([item('1', nombre, 1, 5)]) }]);

    expect(texto).toContain(`${'A'.repeat(43)}😀…`);
    expect(texto).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it('si no cabe en un mensaje de Telegram, achica el top', () => {
    const largo = 'N'.repeat(45);
    const muchos = Array.from({ length: 40 }, (_, i) => item(String(1000 + i), largo, 1, 5));
    const secciones = ['Hoy', 'Esta semana', 'Este mes'].map((titulo) => ({ titulo, stats: stats(muchos) }));

    const texto = formatearEstadisticas('x', secciones);

    expect(texto.length).toBeLessThanOrEqual(4000);
    expect(texto).toContain('… y');
  });
});

describe('EnlacesController — estadísticas', () => {
  it('GET /enlaces/estadisticas es para administrador y técnico supervisor, como GET /enlaces', () => {
    expect(new Reflector().get(ROLES_KEY, EnlacesController.prototype.estadisticasPeriodo)).toEqual([
      'ADMINISTRADOR',
      'TECNICO_SUPERVISOR',
    ]);
  });
});
