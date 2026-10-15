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
import { barra, formatearDuracion, formatearTarjeta, tecladoPeriodos } from './telegram-notifier';

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
  const telegram = {
    enviarTarjetaEstadisticas: jest.fn().mockResolvedValue(undefined),
    editarTarjetaEstadisticas: jest.fn().mockResolvedValue(undefined),
  };
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

  it('el botón manda la tarjeta de hoy con botones, comparada con ayer', async () => {
    await service.enviarEstadisticasTelegram(iso('2026-10-14T15:00:00Z'));

    expect(telegram.enviarTarjetaEstadisticas).toHaveBeenCalledTimes(1);
    const [tarjeta, conBotones] = telegram.enviarTarjetaEstadisticas.mock.calls[0];
    expect(conBotones).toBe(true);
    expect(tarjeta.titulo).toBe('Hoy');
    expect(tarjeta.actual.desde).toBe('2026-10-14T05:00:00.000Z');
    expect(tarjeta.anterior.desde).toBe('2026-10-13T05:00:00.000Z');
  });

  it.each([
    ['semana', 'Esta semana', '2026-10-12T05:00:00.000Z', '2026-10-05T05:00:00.000Z'],
    ['mes', 'Este mes', '2026-10-01T05:00:00.000Z', '2026-09-01T05:00:00.000Z'],
  ] as const)('el botón "%s" edita el mismo mensaje con ese período y el anterior', async (periodo, titulo, desde, desdeAnterior) => {
    await service.mostrarPeriodoTelegram(periodo, 77, iso('2026-10-14T15:00:00Z'));

    const [messageId, tarjeta] = telegram.editarTarjetaEstadisticas.mock.calls[0];
    expect(messageId).toBe(77);
    expect(tarjeta.titulo).toBe(titulo);
    expect(tarjeta.actual.desde).toBe(desde);
    expect(tarjeta.anterior.desde).toBe(desdeAnterior);
  });

  it('hoy en curso se compara con ayer hasta la misma hora, no con el día entero', async () => {
    prisma.enlaceCaida.findMany.mockImplementation(async () => [
      // Ayer: una caída a las 08:00 (antes de "esta hora") y otra a las 15:00 (después).
      { codigoRecinto: '1', nombreRecinto: 'A', canton: null, inicio: iso('2026-10-13T13:00:00Z'), fin: iso('2026-10-13T13:10:00Z') },
      { codigoRecinto: '2', nombreRecinto: 'B', canton: null, inicio: iso('2026-10-13T20:00:00Z'), fin: iso('2026-10-13T20:10:00Z') },
    ]);

    const t = await service.tarjeta('Hoy', 'dia', [2026, 9, 14], iso('2026-10-14T14:00:00Z'));

    expect(t.comparaHastaAhora).toBe(true);
    expect(t.anterior!.ranking.map((e) => e.codigoRecinto)).toEqual(['1']);
    prisma.enlaceCaida.findMany.mockResolvedValue([]);
  });

  it('un período ya cerrado (resumen de ayer) se compara entero', async () => {
    const t = await service.tarjeta('Ayer', 'dia', [2026, 9, 13], iso('2026-10-14T13:00:00Z'));

    expect(t.comparaHastaAhora).toBe(false);
    expect(t.anterior!.desde).toBe('2026-10-12T05:00:00.000Z');
  });

  it('enero se compara con diciembre del año anterior', async () => {
    const t = await service.tarjeta('Este mes', 'mes', [2027, 0, 10], iso('2027-01-10T15:00:00Z'));

    expect(t.anterior!.desde).toBe('2026-12-01T05:00:00.000Z');
    expect(t.anterior!.hasta).toBe('2027-01-01T05:00:00.000Z');
  });

  it('sin historial completo del período anterior no compara (evita "más caídas que ayer" falsos)', async () => {
    prisma.configEnlaces.findUnique.mockResolvedValue({ historialDesde: iso('2026-10-13T20:00:00Z') });

    const ayerParcial = await service.tarjeta('Hoy', 'dia', [2026, 9, 14], iso('2026-10-14T15:00:00Z'));
    const hoyParcial = await service.tarjeta('Hoy', 'dia', [2026, 9, 13], iso('2026-10-14T15:00:00Z'));

    expect(ayerParcial.anterior).toBeNull();
    expect(hoyParcial.anterior).toBeNull();
    prisma.configEnlaces.findUnique.mockResolvedValue({ historialDesde: iso('2026-01-01T00:00:00Z') });
  });

  it.each([
    ['un miércoles: solo ayer', '2026-10-14T13:00:00Z', ['Ayer']],
    ['un lunes: ayer y la semana pasada', '2026-10-19T13:00:00Z', ['Ayer', 'Semana pasada']],
    ['el día 1: ayer y el mes pasado', '2026-10-01T13:00:00Z', ['Ayer', 'Mes pasado']],
  ])('resumen programado %s, una tarjeta por período y sin botones', async (_caso, ahora, titulos) => {
    await service.enviarResumenProgramado(iso(ahora));

    const llamadas = telegram.enviarTarjetaEstadisticas.mock.calls;
    expect(llamadas.map(([t]) => t.titulo)).toEqual(titulos);
    expect(llamadas.every(([, conBotones]) => conBotones === false)).toBe(true);
  });

  it('el resumen de la semana pasada cubre de lunes a domingo anteriores', async () => {
    await service.enviarResumenProgramado(iso('2026-10-19T13:00:00Z'));

    const [semana] = telegram.enviarTarjetaEstadisticas.mock.calls[1];
    expect(semana.actual.desde).toBe('2026-10-12T05:00:00.000Z');
    expect(semana.actual.hasta).toBe('2026-10-19T05:00:00.000Z');
  });

  it('el resumen no se manda con ENLACES_CRON_ENABLED=false (API local)', async () => {
    process.env.ENLACES_CRON_ENABLED = 'false';

    await service.enviarResumenProgramado(iso('2026-10-14T13:00:00Z'));

    expect(telegram.enviarTarjetaEstadisticas).not.toHaveBeenCalled();
  });

  it('un error al armar el resumen no lanza ni manda un resumen a medias', async () => {
    prisma.enlaceCaida.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('base caída'));

    await expect(service.enviarResumenProgramado(iso('2026-10-19T13:00:00Z'))).resolves.toBeUndefined();
    expect(telegram.enviarTarjetaEstadisticas).not.toHaveBeenCalled();
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

  const tarjeta = (
    actual: EstadisticasEnlacesResponse,
    anterior: EstadisticasEnlacesResponse | null = null,
    titulo = 'Hoy',
    comparaHastaAhora = false,
  ) => formatearTarjeta({ titulo, actual, anterior, comparaHastaAhora });

  it('resume arriba lo que se entiende de un vistazo', () => {
    const texto = tarjeta(stats([item('1207', 'Escuela', 2, 75, true), item('28', 'UE Ibarra', 1, 10)]));

    expect(texto).toContain('<b>📊 Enlaces CDA · Hoy</b> (14/10)');
    expect(texto).toContain('✅ <b>54 de 56</b> recintos sin caídas (96 %)');
    expect(texto).toContain('🔴 2 recintos con caídas · 1 h 25 min sin enlace en total');
    expect(texto).toContain('🚨 1 sigue caído ahora');
  });

  it('lista los de más tiempo sin enlace con barra proporcional y escapa el HTML de la hoja', () => {
    const texto = tarjeta(stats([item('28', 'UE Ibarra', 3, 10), item('1207', 'Escuela <Guallupe> & Co', 1, 80, true)]));

    expect(texto).toContain('<b>Más tiempo sin enlace</b>');
    expect(texto).toContain('1. Escuela &lt;Guallupe&gt; &amp; Co <i>(1207 · Cot)</i>\n██████████ 1 h 20 min · 1 caída 🔴');
    expect(texto).toContain('2. UE Ibarra <i>(28 · Cot)</i>\n█░░░░░░░░░ 10 min · 3 caídas');
  });

  it('muestra solo 5 y cuenta el resto', () => {
    const muchos = Array.from({ length: 8 }, (_, i) => item(String(100 + i), 'Recinto', 1, 50 - i));
    const texto = tarjeta(stats(muchos));

    expect(texto).toContain('5. Recinto <i>(104 · Cot)</i>');
    expect(texto).not.toContain('6. Recinto');
    expect(texto).toContain('… y 3 recintos más con caídas');
  });

  it('sin caídas lo celebra y no muestra ranking', () => {
    const texto = tarjeta(stats([]));

    expect(texto).toContain('✅ <b>56 de 56</b> recintos sin caídas (100 %)');
    expect(texto).toContain('🎉 Ningún enlace se cayó en este período');
    expect(texto).not.toContain('Más tiempo sin enlace');
  });

  it.each([
    [[item('1', 'A', 3, 5)], [item('1', 'A', 1, 5)], '📈 2 caídas más que el día anterior'],
    [[item('1', 'A', 1, 5)], [item('1', 'A', 2, 5)], '📉 1 caída menos que el día anterior'],
    [[], [], '➖ Mismo número de caídas que el día anterior'],
  ])('compara con el período anterior', (actual, anterior, esperado) => {
    expect(tarjeta(stats(actual), stats(anterior))).toContain(esperado);
  });

  it('un período en curso se compara "a esta hora"', () => {
    expect(tarjeta(stats([item('1', 'A', 2, 5)]), stats([]), 'Hoy', true)).toContain('📈 2 caídas más que ayer a esta hora');
    expect(
      tarjeta(stats([], { periodo: 'mes' }), stats([item('1', 'A', 1, 5)], { periodo: 'mes' }), 'Este mes', true),
    ).toContain('📉 1 caída menos que el mes pasado a esta altura');
  });

  it('con 0 recintos no divide por cero', () => {
    expect(tarjeta(stats([], { totalRecintos: 0, sinCaidas: [] }))).toContain('<b>0 de 0</b> recintos sin caídas (100 %)');
  });

  it('una caída recién abierta (0 min) va sin barra llena', () => {
    expect(tarjeta(stats([item('1', 'A', 1, 0, true)]))).toContain('░░░░░░░░░░ 0 min · 1 caída 🔴');
  });

  it('sin período anterior no compara', () => {
    expect(tarjeta(stats([item('1', 'A', 3, 5)]))).not.toMatch(/que el día anterior/);
  });

  it('semana con rango de fechas, mes con su nombre, y aviso si el registro empezó a mitad', () => {
    const semana = tarjeta(
      stats([], { periodo: 'semana', hasta: '2026-10-19T05:00:00.000Z', datosParciales: true, historialDesde: '2026-10-14T15:00:00.000Z' }),
      null,
      'Esta semana',
    );
    const mes = tarjeta(stats([], { periodo: 'mes', desde: '2026-10-01T05:00:00.000Z', hasta: '2026-11-01T05:00:00.000Z' }), null, 'Este mes');
    const diciembre = tarjeta(stats([], { periodo: 'mes', desde: '2026-12-01T05:00:00.000Z', hasta: '2027-01-01T05:00:00.000Z' }), null, 'Mes pasado');
    expect(diciembre).toContain('(diciembre)');

    expect(semana).toContain('Esta semana</b> (14/10–18/10)');
    expect(semana).toContain('<i>ℹ️ El registro empezó el 14/10: este período aún no está completo.</i>');
    expect(mes).toContain('Este mes</b> (octubre)');
    expect(mes).not.toContain('El registro empezó');
  });

  it('una caída que venía del período anterior dice "venía caído" en vez de "0 caídas"', () => {
    expect(tarjeta(stats([item('28', 'UE Ibarra', 0, 300)]))).toContain('5 h · venía caído');
  });

  it('recorta nombres largos sin partir un emoji', () => {
    const texto = tarjeta(stats([item('1', 'A'.repeat(43) + '😀😀😀', 1, 5)]));

    expect(texto).toContain(`${'A'.repeat(43)}😀…`);
    expect(texto).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it.each([
    [0, 10, '░░░░░░░░░░'],
    [1, 1000, '█░░░░░░░░░'],
    [5, 10, '█████░░░░░'],
    [10, 10, '██████████'],
    [3, 0, '░░░░░░░░░░'],
  ])('barra(%i, %i) → %s', (valor, maximo, esperado) => {
    expect(barra(valor, maximo)).toBe(esperado);
  });

  it('los botones marcan el período que se está viendo', () => {
    expect(tecladoPeriodos('semana')).toEqual({
      inline_keyboard: [
        [
          { text: 'Hoy', callback_data: 'est:dia' },
          { text: '• Semana •', callback_data: 'est:semana' },
          { text: 'Mes', callback_data: 'est:mes' },
        ],
      ],
    });
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
