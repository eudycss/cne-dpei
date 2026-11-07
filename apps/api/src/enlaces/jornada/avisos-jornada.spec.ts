import type { Jornada, UnidadJornada } from './jornada';
import { avisosJornada, mensajesDeAvisos, SIN_GPS_MIN, type AlertaParaAviso } from './avisos-jornada';

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
    expect(aviso.texto).toContain('Salió del DPEI 08:45 · debía llegar 09:45 (60 min)');
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
    expect(aviso.texto).toContain('Retraso al DPEI</b> · +1 min');
    expect(aviso.texto).toContain('Salió del recinto');
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
