import type { Jornada, UnidadJornada } from './jornada';
import { avisosJornada, mensajesDeAvisos, SIN_GPS_MIN, VENTANA_LLEGADA_DPEI_MIN, type AlertaParaAviso } from './avisos-jornada';

// 15:00 UTC = 10:00 en Ecuador.
const AHORA = new Date('2026-11-29T15:00:00Z');
const min = (n: number) => new Date(AHORA.getTime() + n * 60_000);
const r = (en: Date, sinSenal = false) => ({ en, sinSenal });

function unidad(extra: Partial<UnidadJornada> = {}): UnidadJornada {
  return {
    operadorId: 'op-1',
    codigoRecinto: '971',
    nombreRecinto: 'UE <Chaltura>',
    tecnico: { numero: 1, nombre: 'Jairo' },
    canton: { codigo: 30, nombre: 'IBARRA' },
    personas: [{ nombre: 'ANA', telefono: '0991234567', rol: 'Op.' }],
    registros: {},
    kitRecibido: null,
    kitEscaneado: null,
    actas: null,
    tiempoViajeMin: 60,
    // GPS reciente: no hay aviso de "sin GPS" salvo que el test lo pida.
    ultimoGps: min(-1),
    ...extra,
  };
}
const jornada = (unidades: UnidadJornada[]): Jornada => ({ eventoId: 'ev', evento: 'E', unidades, noCdas: [], sinKit: [], sinDistributivo: false });
const claves = (j: Jornada, enviados: string[] = [], alertas: AlertaParaAviso[] = []) =>
  avisosJornada(j, AHORA, new Set(enviados), alertas).map((a) => a.clave);

describe('avisosJornada: retrasos', () => {
  it('ida: pasado el tiempo de viaje sin llegar, un aviso con los minutos de retraso y las personas', () => {
    const j = jornada([unidad({ registros: { SALIDA_DPI: r(min(-75)) } })]);
    const [aviso] = avisosJornada(j, AHORA, new Set());
    expect(aviso.clave).toBe('RETRASO_IDA:op-1');
    expect(aviso.texto).toContain('Retraso al recinto</b> · +15 min');
    expect(aviso.texto).toContain('Salió de la DPEI 08:45 · debía llegar 09:45 (60 min)');
    expect(aviso.texto).toContain('UE &lt;Chaltura&gt;');
    expect(aviso.texto).toContain('ANA (Op.)');
  });

  it('dentro del tiempo (o en el primer minuto pasado), sin tiempo configurado o ya avisado: nada', () => {
    expect(claves(jornada([unidad({ registros: { SALIDA_DPI: r(min(-30)) } })]))).toEqual([]);
    expect(claves(jornada([unidad({ registros: { SALIDA_DPI: r(new Date(min(-60).getTime() - 30_000)) } })]))).toEqual([]);
    expect(claves(jornada([unidad({ tiempoViajeMin: null, registros: { SALIDA_DPI: r(min(-300)) } })]))).toEqual([]);
    expect(claves(jornada([unidad({ registros: { SALIDA_DPI: r(min(-75)) } })]), ['RETRASO_IDA:op-1'])).toEqual([]);
  });

  it('al llegar tras un retraso avisado: "llegó" con los minutos tarde, una vez', () => {
    const u = unidad({ registros: { SALIDA_DPI: r(min(-90)), LLEGADA_RECINTO: r(min(-10), true) } });
    const [aviso] = avisosJornada(jornada([u]), AHORA, new Set(['RETRASO_IDA:op-1']));
    expect(aviso.clave).toBe('LLEGO_IDA:op-1');
    expect(aviso.texto).toContain('Llegó al recinto</b> 09:50 · +20 min');
    expect(aviso.texto).toContain('sin señal');
    expect(claves(jornada([u]), ['RETRASO_IDA:op-1', 'LLEGO_IDA:op-1'])).toEqual([]);
    // Sin retraso avisado, llegar no avisa.
    expect(claves(jornada([u]))).toEqual([]);
  });

  it('vuelta: mismo tiempo de viaje desde la salida del recinto', () => {
    const u = unidad({
      registros: { SALIDA_DPI: r(min(-600)), LLEGADA_RECINTO: r(min(-550)), SALIDA_RECINTO: r(min(-61)) },
    });
    const [aviso] = avisosJornada(jornada([u]), AHORA, new Set());
    expect(aviso.clave).toBe('RETRASO_VUELTA:op-1');
    expect(aviso.texto).toContain('Retraso a la DPEI</b> · +1 min');
    expect(aviso.texto).toContain('Salió del recinto');
  });
});

describe('avisosJornada: llegada a la Delegación', () => {
  // Ya hicieron todo el recorrido; solo cambia la llegada a la DPEI.
  const recorrido = { SALIDA_DPI: r(min(-600)), LLEGADA_RECINTO: r(min(-550)), SALIDA_RECINTO: r(min(-50)) };
  const pareja = (operadorId: string, codigoRecinto: string, llegaDpi?: Date, sinSenal = false) =>
    unidad({
      operadorId,
      codigoRecinto,
      nombreRecinto: `Recinto ${codigoRecinto}`,
      registros: { ...recorrido, ...(llegaDpi ? { LLEGADA_DPI: r(llegaDpi, sinSenal) } : {}) },
    });
  const llegadas = (j: Jornada, enviados: string[] = []) =>
    avisosJornada(j, AHORA, new Set(enviados)).filter((a) => a.clave.includes('DPEI'));

  it('cada llegada se anuncia una vez, con quién llegó y cuántos recintos faltan', () => {
    const j = jornada([pareja('op-1', '100', min(-5)), pareja('op-2', '200'), pareja('op-3', '300')]);
    const [aviso, ...resto] = llegadas(j);
    expect(resto).toEqual([]);
    expect(aviso.clave).toBe('LLEGADA_DPEI:op-1');
    expect(aviso.texto).toContain('🏁 <b>Llegó a la DPEI</b> · 09:55');
    expect(aviso.texto).toContain('Recinto 100');
    expect(aviso.texto).toContain('ANA (Op.)');
    expect(aviso.texto).toContain('llegaron <b>1 de 3</b> · faltan 2');
    expect(llegadas(j, ['LLEGADA_DPEI:op-1'])).toEqual([]);
  });

  it('un recinto con dos parejas cuenta cuando llegan las dos', () => {
    const una = jornada([pareja('op-1', '100', min(-5)), pareja('op-2', '100'), pareja('op-3', '300')]);
    expect(llegadas(una)[0].texto).toContain('llegaron <b>0 de 2</b> · faltan 2');
    const dos = jornada([pareja('op-1', '100', min(-5)), pareja('op-2', '100', min(-2)), pareja('op-3', '300')]);
    expect(llegadas(dos, ['LLEGADA_DPEI:op-1'])[0].texto).toContain('llegaron <b>1 de 2</b> · faltan 1');
  });

  it('varias a la vez: en orden de llegada y con el conteo actual (un registro tardío no repite un "faltan" viejo)', () => {
    const j = jornada([pareja('op-2', '200', min(-3)), pareja('op-1', '100', min(-8)), pareja('op-3', '300')]);
    const [primero, segundo] = llegadas(j);
    expect(primero.clave).toBe('LLEGADA_DPEI:op-1');
    expect(segundo.clave).toBe('LLEGADA_DPEI:op-2');
    for (const a of [primero, segundo]) expect(a.texto).toContain('llegaron <b>2 de 3</b> · faltan 1');
  });

  it('con retraso dice los minutos tarde, y marca si fue sin señal; la vuelta ya no manda el "llegó" aparte', () => {
    // Salió del recinto hace 50 min con 30 de viaje: debía llegar hace 20; llegó hace 5 → +15.
    const u = unidad({ tiempoViajeMin: 30, registros: { ...recorrido, LLEGADA_DPI: r(min(-5), true) } });
    const avisos = avisosJornada(jornada([u]), AHORA, new Set(['RETRASO_VUELTA:op-1']));
    expect(avisos.map((a) => a.clave)).not.toContain('LLEGO_VUELTA:op-1');
    const aviso = avisos.find((a) => a.clave === 'LLEGADA_DPEI:op-1')!;
    expect(aviso.texto).toContain('· +15 min');
    expect(aviso.texto).toContain('📴 marcado sin señal');
  });

  it(`no anuncia llegadas con señal de hace más de ${VENTANA_LLEGADA_DPEI_MIN} min (al desplegar no llueven las viejas)`, () => {
    const j = jornada([pareja('op-1', '100', min(-VENTANA_LLEGADA_DPEI_MIN - 1)), pareja('op-2', '200')]);
    expect(llegadas(j)).toEqual([]);
  });

  it('una llegada vieja sin señal (sincronizó tarde) o tras un retraso avisado sí se anuncia', () => {
    const viejo = min(-VENTANA_LLEGADA_DPEI_MIN - 30);
    const sinSenal = jornada([pareja('op-1', '100', viejo, true), pareja('op-2', '200')]);
    expect(llegadas(sinSenal).map((a) => a.clave)).toEqual(['LLEGADA_DPEI:op-1']);
    const conRetraso = jornada([pareja('op-1', '100', viejo), pareja('op-2', '200')]);
    expect(llegadas(conRetraso, ['RETRASO_VUELTA:op-1']).map((a) => a.clave)).toEqual(['LLEGADA_DPEI:op-1']);
  });

  it('el cierre no sale horas después de un despliegue si ya no hay llegadas recientes', () => {
    const viejo = min(-VENTANA_LLEGADA_DPEI_MIN - 30);
    expect(llegadas(jornada([pareja('op-1', '100', viejo), pareja('op-2', '200', viejo)]))).toEqual([]);
  });

  it('las llegadas van antes que retrasos y GPS (no se postergan si hay muchos avisos)', () => {
    const enCamino = unidad({ operadorId: 'op-9', codigoRecinto: '900', registros: { SALIDA_DPI: r(min(-75)) } });
    const j = jornada([enCamino, pareja('op-1', '100', min(-2))]);
    expect(avisosJornada(j, AHORA, new Set()).map((a) => a.clave)).toEqual(['LLEGADA_DPEI:op-1', 'RETRASO_IDA:op-9']);
  });

  it('cuando llega el último recinto: cierre "llegaron todos", una vez', () => {
    const j = jornada([pareja('op-1', '100', min(-20)), pareja('op-2', '200', min(-1))]);
    const avisos = llegadas(j, ['LLEGADA_DPEI:op-1']);
    expect(avisos.map((a) => a.clave)).toEqual(['LLEGADA_DPEI:op-2', 'LLEGARON_TODOS_DPEI:ev']);
    expect(avisos[0].texto).toContain('llegaron <b>2 de 2</b>');
    expect(avisos[0].texto).not.toContain('faltan');
    expect(avisos[1].texto).toContain('Llegaron los 2 recintos CDA a la Delegación');
    expect(llegadas(j, ['LLEGADA_DPEI:op-1', 'LLEGADA_DPEI:op-2', 'LLEGARON_TODOS_DPEI:ev'])).toEqual([]);
  });

  it('el kit entregado al Asistente Transversal cuenta como llegada aunque no la hayan marcado', () => {
    const conKit = unidad({ operadorId: 'op-1', codigoRecinto: '100', registros: recorrido, kitRecibido: min(-4) });
    const j = jornada([conKit, pareja('op-2', '200')]);
    const [aviso] = llegadas(j);
    expect(aviso.clave).toBe('LLEGADA_DPEI:op-1');
    expect(aviso.texto).toContain('Llegó a la DPEI</b> · 09:56');
    expect(aviso.texto).toContain('Kit entregado al Asistente Transversal · falta marcar la llegada en la app');
    expect(aviso.texto).toContain('llegaron <b>1 de 2</b> · faltan 1');
  });

  it('si marcó la llegada y luego entregó el kit: un solo aviso, a la hora de la llegada y sin la nota del kit', () => {
    const u = unidad({ registros: { ...recorrido, LLEGADA_DPI: r(min(-6)) }, kitRecibido: min(-3) });
    const avisos = llegadas(jornada([u]));
    expect(avisos.map((a) => a.clave)).toEqual(['LLEGADA_DPEI:op-1', 'LLEGARON_TODOS_DPEI:ev']);
    expect(avisos[0].texto).toContain('· 09:54');
    expect(avisos[0].texto).not.toContain('Kit entregado');
    // Ya avisada: marcar la llegada después del kit no repite.
    expect(llegadas(jornada([u]), ['LLEGADA_DPEI:op-1', 'LLEGARON_TODOS_DPEI:ev'])).toEqual([]);
  });

  it('el cierre "llegaron todos" también cuenta los recintos con el kit entregado', () => {
    const conKit = unidad({ operadorId: 'op-2', codigoRecinto: '200', registros: recorrido, kitRecibido: min(-1) });
    const avisos = llegadas(jornada([pareja('op-1', '100', min(-10)), conKit]), ['LLEGADA_DPEI:op-1']);
    expect(avisos.map((a) => a.clave)).toEqual(['LLEGADA_DPEI:op-2', 'LLEGARON_TODOS_DPEI:ev']);
  });

  it('un kit recibido antes de la salida del recinto (de madrugada, jornada anterior) no cuenta como llegada', () => {
    const madrugada = unidad({ registros: { SALIDA_DPI: r(min(-600)) }, kitRecibido: min(-30) });
    expect(llegadas(jornada([madrugada]))).toEqual([]);
  });

  it('con la llegada por kit no hay retraso ni "sin GPS" de vuelta, ni "+X min" en el aviso', () => {
    // Salió del recinto hace 50 min con 30 de viaje y sin GPS: sin el kit habría retraso y sin GPS.
    const u = unidad({ tiempoViajeMin: 30, ultimoGps: null, registros: recorrido, kitRecibido: min(-2) });
    const avisos = avisosJornada(jornada([u]), AHORA, new Set());
    expect(avisos.map((a) => a.clave)).toEqual(['LLEGADA_DPEI:op-1', 'LLEGARON_TODOS_DPEI:ev']);
    expect(avisos[0].texto).not.toContain(' min');
  });

  it('si marcó la llegada después de entregar el kit: vale la hora del kit, sin la nota de "falta marcar"', () => {
    const u = unidad({ registros: { ...recorrido, LLEGADA_DPI: r(min(-1), true) }, kitRecibido: min(-5) });
    const [aviso] = llegadas(jornada([u]));
    expect(aviso.texto).toContain('· 09:55');
    expect(aviso.texto).not.toContain('falta marcar');
  });

  it('la llegada que registró sola el escaneo del kit: nota del kit y sin "+X min" (la hora es la de la entrega)', () => {
    const u = unidad({ tiempoViajeMin: 30, registros: { ...recorrido, LLEGADA_DPI: { en: min(-2), sinSenal: false, porKit: true } } });
    const avisos = llegadas(jornada([u]), ['RETRASO_VUELTA:op-1']);
    expect(avisos[0].clave).toBe('LLEGADA_DPEI:op-1');
    expect(avisos[0].texto).toContain('Registrada al entregar el kit al Asistente Transversal');
    expect(avisos[0].texto).not.toContain(' min');
  });

  it('sin unidades no hay cierre', () => {
    expect(llegadas(jornada([]))).toEqual([]);
  });
});

describe('avisosJornada: sin GPS', () => {
  it(`en camino y sin GPS hace ${SIN_GPS_MIN} min o más: aviso con los minutos reales, una vez por tramo`, () => {
    const u = unidad({ tiempoViajeMin: null, registros: { SALIDA_DPI: r(min(-40)) }, ultimoGps: min(-23) });
    const [aviso] = avisosJornada(jornada([u]), AHORA, new Set());
    expect(aviso.clave).toBe('SIN_GPS_IDA:op-1');
    expect(aviso.texto).toContain('último GPS 09:37 (hace 23 min)');
    expect(claves(jornada([u]), ['SIN_GPS_IDA:op-1'])).toEqual([]);
  });

  it('no avisa recién salido aunque el último GPS sea de antes de salir; sí si nunca mandó GPS', () => {
    expect(claves(jornada([unidad({ tiempoViajeMin: null, registros: { SALIDA_DPI: r(min(-5)) }, ultimoGps: min(-90) })]))).toEqual([]);
    const nunca = unidad({ tiempoViajeMin: null, registros: { SALIDA_DPI: r(min(-25)) }, ultimoGps: null });
    expect(avisosJornada(jornada([nunca]), AHORA, new Set())[0].texto).toContain('sin GPS desde que salió 09:35 (hace 25 min)');
  });

  it('ya llegó o no ha salido: sin aviso de GPS', () => {
    const llego = unidad({ tiempoViajeMin: null, registros: { SALIDA_DPI: r(min(-90)), LLEGADA_RECINTO: r(min(-60)) }, ultimoGps: min(-60) });
    expect(claves(jornada([llego, unidad({ operadorId: 'op-2', ultimoGps: null })]))).toEqual([]);
  });
});

describe('avisosJornada: alertas', () => {
  const alerta = (o: Partial<AlertaParaAviso> = {}): AlertaParaAviso => ({
    id: 'a1',
    tipo: 'KIT_NO_CORRESPONDE',
    mensaje: 'Escaneó el kit <K-2>',
    generadaEn: min(-5),
    operadorId: 'op-1',
    ...o,
  });

  it('reenvía cada alerta una vez, por hora, con el recinto de su operador si lo hay', () => {
    const avisos = avisosJornada(jornada([unidad()]), AHORA, new Set(), [
      alerta({ id: 'a2', tipo: 'SIN_SINCRONIZAR', generadaEn: min(-1), operadorId: null }),
      alerta(),
    ]);
    expect(avisos.map((a) => a.clave)).toEqual(['ALERTA:a1', 'ALERTA:a2']);
    // Las alertas van antes que los retrasos.
    const conRetraso = jornada([unidad({ registros: { SALIDA_DPI: r(min(-75)) } })]);
    expect(claves(conRetraso, [], [alerta()])).toEqual(['ALERTA:a1', 'RETRASO_IDA:op-1']);
    expect(avisos[0].texto).toContain('Kit que no corresponde</b> · 09:55');
    expect(avisos[0].texto).toContain('Escaneó el kit &lt;K-2&gt;');
    expect(avisos[0].texto).toContain('971');
    expect(avisos[1].texto).not.toContain('971');
    expect(claves(jornada([unidad()]), ['ALERTA:a1'], [alerta()])).toEqual([]);
  });
});

describe('mensajesDeAvisos', () => {
  it('junta avisos en mensajes sin pasar el máximo y recuerda qué claves lleva cada uno', () => {
    const a = (c: string, n: number) => ({ clave: c, texto: 'x'.repeat(n) });
    expect(mensajesDeAvisos([a('1', 10), a('2', 10), a('3', 30)], 30).map((m) => m.claves)).toEqual([['1', '2'], ['3']]);
  });

  it('un aviso largo no se corta (partir el HTML haría que Telegram lo rechace)', () => {
    const largo = { clave: 'x', texto: `<b>${'a'.repeat(50)}</b>` };
    expect(mensajesDeAvisos([largo], 20)[0].texto).toBe(largo.texto);
  });
});
