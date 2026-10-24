import { clasificarEntrada, horaOficial } from './puntualidad';

const DIA = '2026-10-21';
const CONFIG = { horaEntrada: '08:00', minutosGracia: 10 };
// 08:MM:SS en Ecuador = 13:MM:SS UTC.
const a = (hhmmss: string, dia = DIA) => new Date(`${dia}T${hhmmss}-05:00`);
const DESPUES = new Date('2026-10-22T19:00:00Z');

describe('clasificarEntrada', () => {
  it('la hora oficial es en hora de Ecuador (UTC-5)', () => {
    expect(horaOficial(DIA, '08:00').toISOString()).toBe('2026-10-21T13:00:00.000Z');
  });

  it.each([
    ['07:45:00', 'PUNTUAL', 0],
    ['08:00:00', 'PUNTUAL', 0],
    ['08:10:00', 'PUNTUAL', 0],
    ['08:10:59', 'PUNTUAL', 0],
    ['08:11:00', 'ATRASO', 11],
    ['09:30:20', 'ATRASO', 90],
  ])('entrada %s → %s (%i min)', (hora, estado, minutos) => {
    expect(clasificarEntrada(a(hora), DIA, CONFIG, DESPUES)).toEqual({ estado, minutosAtraso: minutos });
  });

  it('con gracia 0, un minuto tarde ya es atraso', () => {
    const sinGracia = { horaEntrada: '08:00', minutosGracia: 0 };
    expect(clasificarEntrada(a('08:00:59'), DIA, sinGracia, DESPUES).estado).toBe('PUNTUAL');
    expect(clasificarEntrada(a('08:01:00'), DIA, sinGracia, DESPUES)).toEqual({ estado: 'ATRASO', minutosAtraso: 1 });
  });

  it('sin entrada en un día pasado es falta', () => {
    expect(clasificarEntrada(null, DIA, CONFIG, DESPUES)).toEqual({ estado: 'FALTA', minutosAtraso: 0 });
  });

  it('sin entrada hoy: pendiente hasta que termina la gracia, luego falta', () => {
    expect(clasificarEntrada(null, DIA, CONFIG, a('08:10:59')).estado).toBe('PENDIENTE');
    expect(clasificarEntrada(null, DIA, CONFIG, a('08:11:00')).estado).toBe('FALTA');
  });
});
