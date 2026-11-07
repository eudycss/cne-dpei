import { NotFoundException } from '@nestjs/common';
import type { IntentoReporteSimulador } from '@cne/shared-types';

import {
  compararIntentos,
  filaDe,
  filaPersona,
  mejorIntento,
  ordenarFilas,
  resumirIntento,
  totales,
  type IntentoParaReporte,
  type PersonaParaReporte,
} from './reporte-simulador';

const INICIO = new Date('2026-11-10T14:00:00Z');
const min = (m: number) => new Date(INICIO.getTime() + m * 60_000);

const intento = (o: Partial<IntentoParaReporte> = {}): IntentoParaReporte => ({
  numero: 1,
  cargo: 'Digitadores',
  iniciadoEn: INICIO,
  venceEn: min(30),
  terminadoEn: null,
  actasCompletadas: 0,
  actasPerfectas: 0,
  filasDigitadas: 0,
  filasCorrectas: 0,
  ...o,
});

const resumen = (o: Partial<IntentoReporteSimulador> = {}): IntentoReporteSimulador => ({
  numero: 1,
  cargo: 'Digitadores',
  iniciadoEn: INICIO.toISOString(),
  terminadoEn: min(30).toISOString(),
  motivo: 'TIEMPO',
  minutos: 30,
  segundos: 1800,
  actasFaltantes: 190,
  filasDigitadas: 100,
  filasCorrectas: 90,
  filasConError: 10,
  registrosPorMinuto: 3.3,
  actasCompletadas: 10,
  actasPerfectas: 8,
  actasConError: 2,
  cumplio: false,
  ...o,
});

const persona = (o: Partial<PersonaParaReporte> = {}): PersonaParaReporte => ({
  operadorId: 'p1',
  cedula: '1710034065',
  apellidosNombres: 'ANA PÉREZ',
  telefono: '0991234567',
  cargo: 'Operadores CDA',
  asignada: true,
  ...o,
});

describe('resumirIntento', () => {
  it('se acabó el tiempo: suma el acta a medias, usa todo el plazo y calcula registros por minuto', () => {
    const r = resumirIntento(
      intento({ filasDigitadas: 95, filasCorrectas: 90, actasCompletadas: 9, actasPerfectas: 7 }),
      200,
      min(45),
      { digitadas: 5, correctas: 4 },
    );
    expect(r).toMatchObject({
      motivo: 'TIEMPO',
      minutos: 30,
      segundos: 1800,
      actasFaltantes: 191,
      terminadoEn: min(30).toISOString(),
      filasDigitadas: 100,
      filasCorrectas: 94,
      filasConError: 6,
      registrosPorMinuto: 3.3,
      actasConError: 2,
      cumplio: false,
    });
  });

  it('cumplió la meta: minutos hasta que terminó y el acta a medias no cuenta', () => {
    const r = resumirIntento(
      intento({ actasCompletadas: 20, actasPerfectas: 20, filasDigitadas: 200, filasCorrectas: 200, terminadoEn: min(12.5) }),
      20,
      min(40),
      { digitadas: 3, correctas: 3 },
    );
    expect(r).toMatchObject({ motivo: 'META', cumplio: true, minutos: 12.5, segundos: 750, actasFaltantes: 0, filasDigitadas: 200, registrosPorMinuto: 16 });
  });

  it('en curso: minutos hasta ahora, sin fin ni acta a medias', () => {
    const r = resumirIntento(intento({ filasDigitadas: 10, filasCorrectas: 10 }), 200, min(5), { digitadas: 4, correctas: 4 });
    expect(r).toMatchObject({ motivo: null, terminadoEn: null, minutos: 5, filasDigitadas: 10, registrosPorMinuto: 2 });
  });

  it('cerrado por tiempo antes del vencimiento: minutos hasta el cierre', () => {
    const r = resumirIntento(intento({ terminadoEn: min(20), filasDigitadas: 40 }), 200, min(45));
    expect(r).toMatchObject({ motivo: 'TIEMPO', minutos: 20, registrosPorMinuto: 2, terminadoEn: min(20).toISOString() });
  });

  it('meta sin marca de cierre todavía: hasta ahora, sin pasar del plazo', () => {
    const r = resumirIntento(intento({ actasCompletadas: 20 }), 20, min(90));
    expect(r).toMatchObject({ motivo: 'META', minutos: 30 });
  });

  it('recién empezado: 0 minutos y 0 por minuto (sin dividir por cero)', () => {
    expect(resumirIntento(intento(), 200, INICIO)).toMatchObject({ minutos: 0, registrosPorMinuto: 0 });
  });
});

describe('mejor intento', () => {
  it('primero el que cumplió la meta, aunque otro tenga más correctos', () => {
    const a = resumen({ numero: 1, cumplio: true, motivo: 'META', filasCorrectas: 180 });
    const b = resumen({ numero: 2, filasCorrectas: 190 });
    expect(mejorIntento([b, a])?.numero).toBe(1);
  });

  it('sin meta: más correctos; empate: menos minutos; empate: el primero', () => {
    expect(mejorIntento([resumen({ numero: 1, filasCorrectas: 80 }), resumen({ numero: 2, filasCorrectas: 95 })])?.numero).toBe(2);
    expect(mejorIntento([resumen({ numero: 1 }), resumen({ numero: 2, minutos: 20 })])?.numero).toBe(2);
    expect(compararIntentos(resumen({ numero: 1 }), resumen({ numero: 2 }))).toBeLessThan(0);
  });

  it('sin intentos: null', () => {
    expect(mejorIntento([])).toBeNull();
  });
});

describe('filaPersona', () => {
  it('no se presentó: sin mejor, sin cumplir y con su cargo actual', () => {
    expect(filaPersona(persona(), [])).toMatchObject({ estado: 'NO_SE_PRESENTO', mejor: null, cumplio: false, cargo: 'Operadores CDA', intentos: [] });
  });

  it('terminó: intentos en orden, el mejor y el cargo de ese intento', () => {
    const f = filaPersona(persona(), [resumen({ numero: 2, filasCorrectas: 99, cargo: 'Digitadores' }), resumen({ numero: 1 })]);
    expect(f).toMatchObject({ estado: 'TERMINADO', mejor: 2, cargo: 'Digitadores' });
    expect(f.intentos.map((i) => i.numero)).toEqual([1, 2]);
  });

  it('con un intento abierto: en curso', () => {
    expect(filaPersona(persona(), [resumen(), resumen({ numero: 2, motivo: null })]).estado).toBe('EN_CURSO');
  });
});

describe('ordenarFilas y totales', () => {
  const cumplio = filaPersona(persona({ operadorId: 'a', apellidosNombres: 'ZOILA' }), [resumen({ cumplio: true, motivo: 'META', filasCorrectas: 50 })]);
  const mas = filaPersona(persona({ operadorId: 'b', apellidosNombres: 'BETO' }), [resumen({ filasCorrectas: 120 })]);
  const menos = filaPersona(persona({ operadorId: 'c', apellidosNombres: 'CARLA' }), [resumen({ filasCorrectas: 60, motivo: null })]);
  const falta1 = filaPersona(persona({ operadorId: 'd', apellidosNombres: 'ÚRSULA' }), []);
  const falta2 = filaPersona(persona({ operadorId: 'e', apellidosNombres: 'ANDRÉS' }), []);

  it('quien cumplió, luego por correctos, y al final quien no se presentó por nombre', () => {
    expect(ordenarFilas([falta1, menos, falta2, mas, cumplio]).map((f) => f.operadorId)).toEqual(['a', 'b', 'c', 'e', 'd']);
  });

  it('cuenta personas, presentes, cumplieron, en curso y ausentes', () => {
    expect(totales([cumplio, mas, menos, falta1, falta2])).toEqual({ personas: 5, presentaron: 3, cumplieron: 1, enCurso: 1, noSePresentaron: 2 });
  });

  it('filaDe: la de esa persona o 404', () => {
    const rep = { filas: [cumplio, mas] } as never;
    expect(filaDe(rep, 'b')).toBe(mas);
    expect(() => filaDe(rep, 'x')).toThrow(NotFoundException);
  });
});
