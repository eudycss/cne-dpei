import type { Jornada, UnidadJornada } from './jornada';
import { etapaPendiente, MAX_RECORDATORIOS, recordatoriosEtapa } from './recordatorios-etapa';

// 15:00 UTC = 10:00 en Ecuador.
const AHORA = new Date('2026-11-29T15:00:00Z');
const min = (n: number) => new Date(AHORA.getTime() + n * 60_000);
const reg = (n: number) => ({ en: min(n), sinSenal: false });

const unidad = (extra: Partial<UnidadJornada> = {}): UnidadJornada => ({
  operadorId: 'op-1',
  codigoRecinto: 'R1',
  nombreRecinto: 'Recinto 1',
  tecnico: { numero: 1, nombre: 'Jairo' },
  canton: { codigo: 30, nombre: 'IBARRA' },
  personas: [],
  registros: {},
  kitRecibido: null,
  kitEscaneado: null,
  actas: null,
  tiempoViajeMin: 60,
  ultimoGps: null,
  ...extra,
});
const jornada = (unidades: UnidadJornada[]): Jornada => ({
  eventoId: 'ev-1',
  evento: 'E',
  unidades,
  noCdas: [],
  sinKit: [],
  sinDistributivo: false,
});

describe('etapaPendiente', () => {
  it('sin kit recibido no hay referencia: nada pendiente', () => {
    expect(etapaPendiente(unidad())).toBeNull();
  });

  it('con el kit recibido espera la salida de la DPEI a los 30 min', () => {
    expect(etapaPendiente(unidad({ kitRecibido: min(-100) }))).toEqual({ etapa: 'SALIDA_DPI', vence: min(-70) });
  });

  it('tras salir de la DPEI espera la llegada al recinto según el tiempo de viaje', () => {
    const u = unidad({ registros: { SALIDA_DPI: reg(-90) } });
    expect(etapaPendiente(u)).toEqual({ etapa: 'LLEGADA_RECINTO', vence: min(-30) });
  });

  it('sin tiempo de viaje configurado no se recuerda la llegada (ni ida ni vuelta)', () => {
    expect(etapaPendiente(unidad({ tiempoViajeMin: null, registros: { SALIDA_DPI: reg(-90) } }))).toBeNull();
    const vuelta = { SALIDA_DPI: reg(-200), LLEGADA_RECINTO: reg(-100), SALIDA_RECINTO: reg(-50) };
    expect(etapaPendiente(unidad({ tiempoViajeMin: null, registros: vuelta }))).toBeNull();
  });

  it('tras llegar al recinto espera la prueba de conexión; con ella, la salida del recinto', () => {
    const llegada = { SALIDA_DPI: reg(-200), LLEGADA_RECINTO: reg(-100) };
    expect(etapaPendiente(unidad({ registros: llegada }))).toEqual({ etapa: 'PRUEBA_CONEXION', vence: min(-70) });
    expect(etapaPendiente(unidad({ registros: llegada, pruebaConexion: reg(-60) }))).toEqual({
      etapa: 'SALIDA_RECINTO',
      vence: min(-30),
    });
  });

  it('una prueba marcada antes de la llegada al recinto no adelanta el aviso de la salida', () => {
    const u = unidad({ registros: { SALIDA_DPI: reg(-200), LLEGADA_RECINTO: reg(-40) }, pruebaConexion: reg(-100) });
    expect(etapaPendiente(u)).toEqual({ etapa: 'SALIDA_RECINTO', vence: min(-10) });
  });

  it('tras salir del recinto espera la llegada a la DPEI; al llegar ya no hay nada pendiente', () => {
    const salio = { SALIDA_DPI: reg(-300), LLEGADA_RECINTO: reg(-200), SALIDA_RECINTO: reg(-90) };
    expect(etapaPendiente(unidad({ registros: salio }))).toEqual({ etapa: 'LLEGADA_DPI', vence: min(-30) });
    expect(etapaPendiente(unidad({ registros: { ...salio, LLEGADA_DPI: reg(-10) } }))).toBeNull();
  });
});

describe('recordatoriosEtapa', () => {
  // La llegada al recinto lleva `minutos` vencida (salió hace 60 + minutos, con 60 de viaje).
  const vencida = (minutos: number) => unidad({ registros: { SALIDA_DPI: reg(-60 - minutos) } });

  it('no avisa antes de que venza la etapa', () => {
    expect(recordatoriosEtapa(jornada([vencida(-1)]), AHORA, new Set())).toEqual([]);
  });

  it('avisa al operador y a su pareja apenas vence', () => {
    const u = { ...vencida(5), destinatarios: ['op-1', 'asis-1'] };
    expect(recordatoriosEtapa(jornada([u]), AHORA, new Set())).toEqual([
      {
        clave: 'ETAPA:LLEGADA_RECINTO:op-1:0',
        etapa: 'LLEGADA_RECINTO',
        operadorId: 'op-1',
        destinatarios: ['op-1', 'asis-1'],
        minutosVencida: 5,
      },
    ]);
  });

  it('sin destinatarios cargados avisa a quien lleva el kit', () => {
    expect(recordatoriosEtapa(jornada([vencida(5)]), AHORA, new Set())[0].destinatarios).toEqual(['op-1']);
  });

  it('no repite el que ya se avisó, y a los 30 min manda el siguiente', () => {
    const enviados = new Set(['ETAPA:LLEGADA_RECINTO:op-1:0']);
    expect(recordatoriosEtapa(jornada([vencida(10)]), AHORA, enviados)).toEqual([]);
    expect(recordatoriosEtapa(jornada([vencida(35)]), AHORA, enviados).map((r) => r.clave)).toEqual([
      'ETAPA:LLEGADA_RECINTO:op-1:1',
    ]);
  });

  it('tras un corte largo manda solo el de esta hora, y nunca pasa del tope', () => {
    expect(recordatoriosEtapa(jornada([vencida(65)]), AHORA, new Set()).map((r) => r.clave)).toEqual([
      'ETAPA:LLEGADA_RECINTO:op-1:2',
    ]);
    const ultima = `ETAPA:LLEGADA_RECINTO:op-1:${MAX_RECORDATORIOS - 1}`;
    expect(recordatoriosEtapa(jornada([vencida(600)]), AHORA, new Set([ultima]))).toEqual([]);
  });

  it('un operador que ya cumplió la etapa no recibe nada', () => {
    const u = unidad({ registros: { SALIDA_DPI: reg(-100), LLEGADA_RECINTO: reg(-10) } });
    expect(recordatoriosEtapa(jornada([u]), AHORA, new Set())).toEqual([]);
  });
});
